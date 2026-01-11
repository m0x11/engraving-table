#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// Configuration
const FONT_JSON_PATH = path.join(__dirname, 'public/fonts/PPRightSerifMono-msdf.json');
const FONT_PNG_PATH = path.join(__dirname, 'public/fonts/PPRightSerifMono-msdf.png');
const OUTPUT_DIR = path.join(__dirname, '..', 'sdfs');

// Default parameters
const DEFAULT_DEPTH = 0.15;
const DEFAULT_RESOLUTION_PER_UNIT = 150;
const MAX_GLYPHS = 32; // Maximum supported glyphs

function loadFontData() {
  const jsonData = JSON.parse(fs.readFileSync(FONT_JSON_PATH, 'utf8'));
  const pngData = fs.readFileSync(FONT_PNG_PATH);
  const png = PNG.sync.read(pngData);

  return {
    json: jsonData,
    png: png,
    atlasWidth: png.width,
    atlasHeight: png.height
  };
}

function getGlyphData(fontData, char) {
  const glyph = fontData.json.glyphs.find(g => String.fromCharCode(g.unicode) === char);
  if (!glyph || !glyph.atlasBounds || !glyph.planeBounds) {
    return null;
  }
  return glyph;
}

function generateGLSL(text, fontData, depth, middleDotCenter = 0.34) {
  const glyphs = [];
  const atlasWidth = fontData.atlasWidth;
  const atlasHeight = fontData.atlasHeight;

  // Process each character
  for (const char of text) {
    let lookupChar = char;
    let verticalOffset = 0;

    // Handle middle dot
    if (char === '·') {
      lookupChar = '.';
      const periodGlyph = getGlyphData(fontData, '.');
      if (periodGlyph) {
        const periodCenter = (periodGlyph.planeBounds.bottom + periodGlyph.planeBounds.top) / 2;
        verticalOffset = middleDotCenter - periodCenter;
      }
    }

    const glyph = getGlyphData(fontData, lookupChar);
    if (!glyph) {
      console.warn(`Warning: Character '${char}' not found in font, skipping`);
      continue;
    }

    // Calculate UV bounds (normalized 0-1, with Y flipped for WebGL)
    const uvLeft = glyph.atlasBounds.left / atlasWidth;
    const uvRight = glyph.atlasBounds.right / atlasWidth;
    // Flip Y: atlas uses bottom origin, WebGL texture uses top origin
    const uvBottom = 1.0 - glyph.atlasBounds.top / atlasHeight;
    const uvTop = 1.0 - glyph.atlasBounds.bottom / atlasHeight;

    glyphs.push({
      char,
      uv: { left: uvLeft, bottom: uvBottom, right: uvRight, top: uvTop },
      plane: {
        left: glyph.planeBounds.left,
        bottom: glyph.planeBounds.bottom + verticalOffset,
        right: glyph.planeBounds.right,
        top: glyph.planeBounds.top + verticalOffset
      },
      advance: glyph.advance
    });
  }

  if (glyphs.length === 0) {
    throw new Error('No valid glyphs found');
  }

  if (glyphs.length > MAX_GLYPHS) {
    throw new Error(`Too many glyphs (${glyphs.length}). Maximum is ${MAX_GLYPHS}`);
  }

  const numGlyphs = glyphs.length;

  // Generate texture declarations (simplified - glyph data is inlined in shader)
  const textureDeclarations = `
uniform sampler2D uMsdfTexture;
`;

  // Generate per-glyph SDF functions with inlined UV/plane data
  // This avoids WebGL 1.0's limitation on dynamic array indexing
  const glyphFunctions = glyphs.map((g, i) => `
float glyphSdf${i}(vec2 p) {
  // Glyph ${i}: '${g.char}'
  vec4 uvBounds = vec4(${g.uv.left.toFixed(6)}, ${g.uv.bottom.toFixed(6)}, ${g.uv.right.toFixed(6)}, ${g.uv.top.toFixed(6)});
  vec4 plane = vec4(${g.plane.left.toFixed(6)}, ${g.plane.bottom.toFixed(6)}, ${g.plane.right.toFixed(6)}, ${g.plane.top.toFixed(6)});

  vec2 planeMin = plane.xy;
  vec2 planeMax = plane.zw;
  vec2 planeSize = planeMax - planeMin;
  vec2 localUV = (p - planeMin) / planeSize;

  if (localUV.x < -0.2 || localUV.x > 1.2 || localUV.y < -0.2 || localUV.y > 1.2) {
    vec2 center = (planeMin + planeMax) * 0.5;
    vec2 halfSize = planeSize * 0.5;
    vec2 d = abs(p - center) - halfSize;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }

  localUV = clamp(localUV, 0.0, 1.0);
  vec2 atlasUV = vec2(
    mix(uvBounds.x, uvBounds.z, localUV.x),
    mix(uvBounds.y, uvBounds.w, localUV.y)
  );

  return sampleMsdf(atlasUV);
}`).join('\n');

  // Generate textSdf2D that calls each glyph function explicitly
  const glyphCalls = glyphs.map((g, i) =>
    `  d = min(d, glyphSdf${i}(p - vec2(xStart + ${i.toFixed(1)} * advance, 0.0)));`
  ).join('\n');

  // Generate GLSL code
  const glsl = `// Auto-generated SDF for text: "${text}"
#define DEPTH ${depth.toFixed(4)}
#define PX_RANGE 8.0
#define GLYPH_SIZE 48.0
#define NUM_GLYPHS ${numGlyphs}

float median(vec3 v) {
  return max(min(v.r, v.g), min(max(v.r, v.g), v.b));
}

float sampleMsdf(vec2 uv) {
  vec3 msdf = texture2D(uMsdfTexture, uv).rgb;
  float sd = median(msdf);
  float pxDist = PX_RANGE * (0.5 - sd);
  return pxDist / GLYPH_SIZE;
}
${glyphFunctions}

float textSdf2D(vec2 p) {
  float d = 1000.0;
  float advance = 0.52;
  float totalWidth = float(NUM_GLYPHS) * advance;
  float xStart = -totalWidth * 0.5 + advance * 0.25;

${glyphCalls}

  return d;
}

float mapDistance(vec3 p) {
  float d2d = textSdf2D(p.xy);
  float dz = abs(p.z) - DEPTH;
  vec2 w = vec2(d2d, dz);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
}
`;

  return { glsl, glyphs, textureDeclarations };
}

function calculateBounds(glyphs, depth) {
  const advance = 0.52;
  const totalWidth = glyphs.length * advance;

  let minY = Infinity, maxY = -Infinity;
  for (const g of glyphs) {
    minY = Math.min(minY, g.plane.bottom);
    maxY = Math.max(maxY, g.plane.top);
  }

  const padding = 0.1;
  const width = totalWidth + padding * 2;
  const height = (maxY - minY) + padding * 2;
  const depthSize = depth * 2 + padding;

  return {
    size: [width, height, depthSize],
    center: [0, (minY + maxY) / 2, 0]
  };
}

function generateUniformsJS(glyphs, fontData) {
  // Generate JavaScript code for setting uniforms
  const uvArrayStr = glyphs.map(g =>
    `[${g.uv.left.toFixed(6)}, ${g.uv.bottom.toFixed(6)}, ${g.uv.right.toFixed(6)}, ${g.uv.top.toFixed(6)}]`
  ).join(',\n    ');

  const planeArrayStr = glyphs.map(g =>
    `[${g.plane.left.toFixed(6)}, ${g.plane.bottom.toFixed(6)}, ${g.plane.right.toFixed(6)}, ${g.plane.top.toFixed(6)}]`
  ).join(',\n    ');

  return `{
  uAtlasSize: [${fontData.atlasWidth}, ${fontData.atlasHeight}],
  uNumGlyphs: ${glyphs.length},
  uGlyphUV: [
    ${uvArrayStr}
  ],
  uGlyphPlane: [
    ${planeArrayStr}
  ]
}`;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log(`
Usage: node generate-text-mesh.js <text> [options]

Options:
  --depth <n>       Extrusion depth (default: ${DEFAULT_DEPTH})
  --resolution <n>  Resolution per unit (default: ${DEFAULT_RESOLUTION_PER_UNIT})
  --name <name>     Output name (default: derived from text)

Examples:
  node generate-text-mesh.js "Hello"
  node generate-text-mesh.js "12·34" --depth 0.2
`);
    process.exit(0);
  }

  // Parse arguments
  const text = args[0];
  let depth = DEFAULT_DEPTH;
  let resolutionPerUnit = DEFAULT_RESOLUTION_PER_UNIT;
  let outputName = text.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--depth' && args[i + 1]) {
      depth = parseFloat(args[++i]);
    } else if (args[i] === '--resolution' && args[i + 1]) {
      resolutionPerUnit = parseInt(args[++i]);
    } else if (args[i] === '--name' && args[i + 1]) {
      outputName = args[++i];
    }
  }

  console.log(`\n📝 Generating SDF for text: "${text}"`);
  console.log(`   Depth: ${depth}`);
  console.log(`   Resolution per unit: ${resolutionPerUnit}`);

  // Load font data
  console.log('\n📂 Loading font data...');
  const fontData = loadFontData();
  console.log(`   Atlas size: ${fontData.atlasWidth}x${fontData.atlasHeight}`);

  // Generate GLSL
  console.log('\n⚙️  Generating GLSL SDF code...');
  const { glsl, glyphs, textureDeclarations } = generateGLSL(text, fontData, depth);
  console.log(`   Generated code for ${glyphs.length} glyphs`);

  // Calculate bounds
  const bounds = calculateBounds(glyphs, depth);
  console.log(`   Bounds: ${bounds.size.map(s => s.toFixed(2)).join(' x ')}`);

  // Calculate resolution
  const resolution = bounds.size.map(s => Math.ceil(s * resolutionPerUnit));
  console.log(`   Resolution: ${resolution.join(' x ')}`);

  // Create output directory
  const sdfDir = path.join(OUTPUT_DIR, `text-${outputName}`);
  if (!fs.existsSync(sdfDir)) {
    fs.mkdirSync(sdfDir, { recursive: true });
  }

  // Write SDF file
  const sdfPath = path.join(sdfDir, 'sdf.txt');
  fs.writeFileSync(sdfPath, glsl);
  console.log(`\n✅ Wrote SDF to: ${sdfPath}`);

  // Write texture declarations file
  const textureDeclarationsPath = path.join(sdfDir, 'texture-declarations.txt');
  fs.writeFileSync(textureDeclarationsPath, textureDeclarations);
  console.log(`✅ Wrote texture declarations to: ${textureDeclarationsPath}`);

  // Write uniforms file
  const uniformsPath = path.join(sdfDir, 'uniforms.js');
  const uniformsJS = generateUniformsJS(glyphs, fontData);
  fs.writeFileSync(uniformsPath, `module.exports = ${uniformsJS};`);
  console.log(`✅ Wrote uniforms to: ${uniformsPath}`);

  // Write params file with all uniforms embedded
  const params = {
    size: bounds.size,
    resolution: resolution,
    hasTexture: true,
    uniforms: {
      uAtlasSize: [fontData.atlasWidth, fontData.atlasHeight],
      uNumGlyphs: glyphs.length,
      uGlyphUV: glyphs.map(g => [g.uv.left, g.uv.bottom, g.uv.right, g.uv.top]),
      uGlyphPlane: glyphs.map(g => [g.plane.left, g.plane.bottom, g.plane.right, g.plane.top])
    }
  };
  const paramsPath = path.join(sdfDir, 'params.json');
  fs.writeFileSync(paramsPath, JSON.stringify(params, null, 2));
  console.log(`✅ Wrote params to: ${paramsPath}`);

  // Copy the MSDF texture to the output dir for convenience
  const textureDest = path.join(sdfDir, 'msdf.png');
  fs.copyFileSync(FONT_PNG_PATH, textureDest);
  console.log(`✅ Copied MSDF texture to: ${textureDest}`);

  console.log(`\n💡 To generate mesh, the sdf-mesher needs to load the texture.`);
  console.log(`   Use the browser-based approach with texture support.`);
}

main().catch(console.error);
