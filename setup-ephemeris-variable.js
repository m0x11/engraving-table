#!/usr/bin/env node

/**
 * Sets up the ephemeris-variable SDF folder with all digit glyphs pre-defined.
 * This only needs to be run once to create the base SDF.
 *
 * The resulting SDF accepts uniforms:
 * - uTargetDate: Unix timestamp for planetary positions
 * - uGlyphIndices[10]: Which glyph to use at each position (0-9 = digits, 10 = middle dot)
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// Configuration
const FONT_JSON_PATH = path.join(__dirname, 'public/fonts/PPRightSerifMono-msdf.json');
const FONT_PNG_PATH = path.join(__dirname, 'public/fonts/PPRightSerifMono-msdf.png');
const EPHEMERIS_PATH = path.join(__dirname, 'public/sdfs/ephemeris.glsl');
const OUTPUT_DIR = path.join(__dirname, '..', 'sdfs', 'ephemeris-variable');

// Characters we need: 0-9 and middle dot (·)
const GLYPH_CHARS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '·'];

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

function generateAllGlyphsGLSL(fontData, middleDotCenter = 0.34) {
  const glyphs = [];
  const atlasWidth = fontData.atlasWidth;
  const atlasHeight = fontData.atlasHeight;

  for (const char of GLYPH_CHARS) {
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
      console.error(`Error: Character '${char}' not found in font`);
      process.exit(1);
    }

    // Calculate UV bounds (normalized 0-1, with Y flipped for WebGL)
    const uvLeft = glyph.atlasBounds.left / atlasWidth;
    const uvRight = glyph.atlasBounds.right / atlasWidth;
    const uvBottom = 1.0 - glyph.atlasBounds.top / atlasHeight;
    const uvTop = 1.0 - glyph.atlasBounds.bottom / atlasHeight;

    glyphs.push({
      char,
      index: glyphs.length,
      uv: { left: uvLeft, bottom: uvBottom, right: uvRight, top: uvTop },
      plane: {
        left: glyph.planeBounds.left,
        bottom: glyph.planeBounds.bottom + verticalOffset,
        right: glyph.planeBounds.right,
        top: glyph.planeBounds.top + verticalOffset
      }
    });
  }

  // Generate individual glyph SDF functions
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

  // Generate dispatcher function that selects glyph by index
  let dispatcherCases = '';
  for (let i = 0; i < glyphs.length; i++) {
    dispatcherCases += `  ${i === 0 ? 'if' : 'else if'} (idx == ${i}) return glyphSdf${i}(p);\n`;
  }

  const textGlsl = `
// ========== TEXT SDF FUNCTIONS ==========
// Glyph indices: 0-9 = digits '0'-'9', 10 = middle dot '·'
// Note: uTargetDate and uGlyphIndices uniforms are injected via textureDeclarations at runtime

#define PX_RANGE 8.0
#define GLYPH_SIZE 48.0
#define NUM_POSITIONS 10

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

float glyphSdfByIndex(vec2 p, int idx) {
${dispatcherCases}
  return 1000.0; // fallback
}

float textSdf2D(vec2 p) {
  float d = 1000.0;
  float advance = 0.52;
  float totalWidth = float(NUM_POSITIONS) * advance;
  float xStart = -totalWidth * 0.5 + advance * 0.25;

  for (int i = 0; i < NUM_POSITIONS; i++) {
    int glyphIdx = uGlyphIndices[i];
    float xPos = xStart + float(i) * advance;
    d = min(d, glyphSdfByIndex(p - vec2(xPos, 0.0), glyphIdx));
  }

  return d;
}

// Rotation matrix for 2D
mat2 Rot2D(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

float textOnInnerCylinder(vec3 p) {
  // Transform to match the drill hole coordinate system
  vec3 q = p;
  q.y += 0.8;   // signet offset
  q.y += 3.7;   // bandPosY offset
  q.xy = Rot2D(PI/2.0) * q.xy;

  float cylinderRadius = 3.9;

  // Convert to cylindrical coordinates
  float angle = atan(q.z, q.x);
  float r = length(q.xz);
  float h = q.y;

  // Map to text coordinates - rotate 180 degrees
  float textScale = 1.0;
  float textX = -angle * cylinderRadius / textScale;
  float textY = h / textScale + 0.34;  // +0.34 centers the glyphs

  float d2d = textSdf2D(vec2(textX, textY));

  float textDepth = 0.15;
  float surfaceDist = cylinderRadius - r;

  vec2 w = vec2(d2d, abs(surfaceDist) - textDepth);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
}
// ========== END TEXT SDF FUNCTIONS ==========
`;

  return textGlsl;
}

function generateCombinedSDF(ephemerisCode, textGlsl) {
  // Replace hardcoded targetDate with uniform reference
  let modifiedEphemeris = ephemerisCode.replace(
    /float targetDate = [\d.-]+;/,
    'float targetDate = uTargetDate;'
  );

  // Insert text GLSL before mapScene function
  const mapSceneIndex = modifiedEphemeris.indexOf('float mapScene(');
  if (mapSceneIndex === -1) {
    throw new Error('Could not find mapScene function in ephemeris code');
  }

  const beforeMapScene = modifiedEphemeris.slice(0, mapSceneIndex);
  const afterMapScene = modifiedEphemeris.slice(mapSceneIndex);

  let combinedCode = beforeMapScene + textGlsl + afterMapScene;

  // Modify mapDistance to engrave text
  combinedCode = combinedCode.replace(
    /float mapDistance\(vec3 p\) \{\s*return mapScene\(p\);\s*\}/,
    `float mapDistance(vec3 p) {
  // Apply Y offset to keep ring in view
  p.y -= 4.0;

  float dRing = mapScene(p);
  float dText = textOnInnerCylinder(p);
  return max(dRing, -dText);
}`
  );

  return combinedCode;
}

async function main() {
  console.log('🔧 Setting up ephemeris-variable SDF...\n');

  // Load font data
  console.log('📂 Loading font data...');
  const fontData = loadFontData();
  console.log(`   Atlas size: ${fontData.atlasWidth}x${fontData.atlasHeight}`);

  // Load ephemeris shader
  console.log('📂 Loading ephemeris shader...');
  const ephemerisCode = fs.readFileSync(EPHEMERIS_PATH, 'utf8');
  console.log(`   Loaded ${ephemerisCode.length} characters`);

  // Generate text GLSL with all digit glyphs
  console.log('⚙️  Generating text SDF code with all glyphs...');
  const textGlsl = generateAllGlyphsGLSL(fontData);
  console.log(`   Generated ${GLYPH_CHARS.length} glyph functions`);

  // Generate combined SDF
  console.log('🔧 Combining ephemeris and text SDFs...');
  const combinedSdf = generateCombinedSDF(ephemerisCode, textGlsl);
  console.log(`   Combined SDF: ${combinedSdf.length} characters`);

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write SDF file
  const sdfPath = path.join(OUTPUT_DIR, 'sdf.txt');
  fs.writeFileSync(sdfPath, combinedSdf);
  console.log(`\n✅ Wrote SDF to: ${sdfPath}`);

  // Write texture declarations
  const textureDeclarationsPath = path.join(OUTPUT_DIR, 'texture-declarations.txt');
  fs.writeFileSync(textureDeclarationsPath, 'uniform sampler2D uMsdfTexture;\n');
  console.log(`✅ Wrote texture declarations to: ${textureDeclarationsPath}`);

  // Write params file
  const params = {
    size: [12, 12, 12],
    resolution: [600, 600, 600],
    hasTexture: true,
    isVariable: true,
    glyphMap: {
      '0': 0, '1': 1, '2': 2, '3': 3, '4': 4,
      '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
      '·': 10
    }
  };
  const paramsPath = path.join(OUTPUT_DIR, 'params.json');
  fs.writeFileSync(paramsPath, JSON.stringify(params, null, 2));
  console.log(`✅ Wrote params to: ${paramsPath}`);

  // Copy the MSDF texture
  const textureDest = path.join(OUTPUT_DIR, 'msdf.png');
  fs.copyFileSync(FONT_PNG_PATH, textureDest);
  console.log(`✅ Copied MSDF texture to: ${textureDest}`);

  console.log(`\n🎉 ephemeris-variable setup complete!`);
  console.log(`\n💡 Use batch-engrave.js to generate meshes:`);
  console.log(`   node batch-engrave.js 07-04-1776 01-01-2000 12-25-2024`);
}

main().catch(console.error);
