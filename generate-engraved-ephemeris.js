#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// Configuration
const FONT_JSON_PATH = path.join(__dirname, 'public/fonts/PPRightSerifMono-msdf.json');
const FONT_PNG_PATH = path.join(__dirname, 'public/fonts/PPRightSerifMono-msdf.png');
const EPHEMERIS_PATH = path.join(__dirname, 'public/sdfs/ephemeris.glsl');
const OUTPUT_DIR = path.join(__dirname, '..', 'sdfs');

// Default parameters for the ring mesh
const RING_SIZE = [12, 12, 12];  // Bounding box for the ring
const RING_RESOLUTION = [600, 600, 600];  // Resolution for mesh generation

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

function parseDateToUnix(dateStr) {
  // Parse "mm-dd-yyyy" format
  const match = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) {
    throw new Error(`Invalid date format: ${dateStr}. Expected mm-dd-yyyy`);
  }

  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  // Validate
  if (month < 1 || month > 12) throw new Error(`Invalid month: ${month}`);
  if (day < 1 || day > 31) throw new Error(`Invalid day: ${day}`);
  if (year < 1 || year > 3000) throw new Error(`Invalid year: ${year}`);

  // Create date at noon UTC to avoid timezone issues
  // JavaScript Date can handle dates before 1970 (returns negative timestamps)
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return Math.floor(date.getTime() / 1000);
}

function formatDateWithDots(dateStr) {
  // Convert "mm-dd-yyyy" to "mm·dd·yyyy"
  const match = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }

  const month = match[1].padStart(2, '0');
  const day = match[2].padStart(2, '0');
  const year = match[3];

  return `${month}·${day}·${year}`;
}

function generateTextGLSL(text, fontData, middleDotCenter = 0.34) {
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

  const numGlyphs = glyphs.length;

  // Generate per-glyph SDF functions with inlined UV/plane data
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

  const textGlsl = `
// ========== TEXT SDF FUNCTIONS ==========
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

// Rotation matrix for 2D
mat2 Rot2D(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

float textOnInnerCylinder(vec3 p) {
  // Transform to match the drill hole coordinate system
  // From signet: p.y += 0.8
  // From drillHole: p.y += bandPosY (3.7), then rotate
  vec3 q = p;
  q.y += 0.8;   // signet offset
  q.y += 3.7;   // bandPosY offset
  q.xy = Rot2D(PI/2.0) * q.xy;  // Rotate to align with cylinder axis

  // Now cylinder axis is along Y, radius in XZ plane
  // Cylinder radius is 3.9 (from drillHole)
  float cylinderRadius = 3.9;

  // Convert to cylindrical coordinates
  float angle = atan(q.z, q.x);  // Angle around cylinder (-PI to PI)
  float r = length(q.xz);        // Distance from cylinder axis
  float h = q.y;                 // Height along cylinder axis

  // Map cylindrical coords to 2D text coordinates - rotate 180 degrees
  float textScale = 1.0;
  float textX = -angle * cylinderRadius / textScale;
  float textY = h / textScale + 0.34;  // +0.34 centers the glyphs

  // Sample 2D text SDF
  float d2d = textSdf2D(vec2(textX, textY));

  // Extrude radially inward from cylinder surface
  float textDepth = 0.15;  // How deep to engrave
  float surfaceDist = cylinderRadius - r;  // Distance from inner surface

  // Combine 2D text with radial extrusion
  vec2 w = vec2(d2d, abs(surfaceDist) - textDepth);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
}
// ========== END TEXT SDF FUNCTIONS ==========
`;

  return { textGlsl, glyphs };
}

function generateCombinedSDF(ephemerisCode, textGlsl, targetDate) {
  // Replace the hardcoded targetDate in mapScene
  let modifiedEphemeris = ephemerisCode.replace(
    /float targetDate = [\d.-]+;/,
    `float targetDate = ${targetDate.toFixed(1)};`
  );

  // Note: texture uniform declaration is NOT added here - it comes from texture-declarations.txt
  // which is injected by the mesher at runtime

  // Combine the shaders
  // Insert text GLSL before mapScene function
  const mapSceneIndex = modifiedEphemeris.indexOf('float mapScene(');
  if (mapSceneIndex === -1) {
    throw new Error('Could not find mapScene function in ephemeris code');
  }

  const beforeMapScene = modifiedEphemeris.slice(0, mapSceneIndex);
  const afterMapScene = modifiedEphemeris.slice(mapSceneIndex);

  // Modify mapDistance to include text engraving
  let combinedCode = beforeMapScene + textGlsl + afterMapScene;

  // Now modify mapDistance to engrave text
  combinedCode = combinedCode.replace(
    /float mapDistance\(vec3 p\) \{\s*return mapScene\(p\);\s*\}/,
    `float mapDistance(vec3 p) {
  float dRing = mapScene(p);
  float dText = textOnInnerCylinder(p);
  // Engrave text into ring (subtract text from ring)
  return max(dRing, -dText);
}`
  );

  return combinedCode;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log(`
Usage: node generate-engraved-ephemeris.js <date> [options]

Arguments:
  <date>              Date in mm-dd-yyyy format (e.g., 01-15-2024)

Options:
  --resolution <n>    Resolution (default: 600, creates 600x600x600)
  --name <name>       Output folder name (default: ephemeris-<date>)

Examples:
  node generate-engraved-ephemeris.js 01-15-2024
  node generate-engraved-ephemeris.js 12-25-1999 --resolution 400
  node generate-engraved-ephemeris.js 07-04-1776 --name independence-ring
`);
    process.exit(0);
  }

  // Parse arguments
  const dateStr = args[0];
  let resolution = 600;
  let outputName = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--resolution' && args[i + 1]) {
      resolution = parseInt(args[++i]);
    } else if (args[i] === '--name' && args[i + 1]) {
      outputName = args[++i];
    }
  }

  // Parse and validate date
  let unixTime, displayText;
  try {
    unixTime = parseDateToUnix(dateStr);
    displayText = formatDateWithDots(dateStr);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  if (!outputName) {
    outputName = `ephemeris-${dateStr.replace(/-/g, '')}`;
  }

  console.log(`\n📅 Generating engraved ephemeris ring`);
  console.log(`   Date: ${dateStr}`);
  console.log(`   Display text: ${displayText}`);
  console.log(`   Unix timestamp: ${unixTime}`);
  console.log(`   Resolution: ${resolution}x${resolution}x${resolution}`);

  // Load font data
  console.log('\n📂 Loading font data...');
  const fontData = loadFontData();
  console.log(`   Atlas size: ${fontData.atlasWidth}x${fontData.atlasHeight}`);

  // Load ephemeris shader
  console.log('\n📂 Loading ephemeris shader...');
  if (!fs.existsSync(EPHEMERIS_PATH)) {
    console.error(`Error: Ephemeris shader not found: ${EPHEMERIS_PATH}`);
    process.exit(1);
  }
  const ephemerisCode = fs.readFileSync(EPHEMERIS_PATH, 'utf8');
  console.log(`   Loaded ${ephemerisCode.length} characters`);

  // Generate text GLSL
  console.log('\n⚙️  Generating text SDF code...');
  const { textGlsl, glyphs } = generateTextGLSL(displayText, fontData);
  console.log(`   Generated code for ${glyphs.length} glyphs`);

  // Generate combined SDF
  console.log('\n🔧 Combining ephemeris and text SDFs...');
  const combinedSdf = generateCombinedSDF(ephemerisCode, textGlsl, unixTime);
  console.log(`   Combined SDF: ${combinedSdf.length} characters`);

  // Create output directory
  const sdfDir = path.join(OUTPUT_DIR, outputName);
  if (!fs.existsSync(sdfDir)) {
    fs.mkdirSync(sdfDir, { recursive: true });
  }

  // Write SDF file
  const sdfPath = path.join(sdfDir, 'sdf.txt');
  fs.writeFileSync(sdfPath, combinedSdf);
  console.log(`\n✅ Wrote SDF to: ${sdfPath}`);

  // Write texture declarations
  const textureDeclarationsPath = path.join(sdfDir, 'texture-declarations.txt');
  fs.writeFileSync(textureDeclarationsPath, 'uniform sampler2D uMsdfTexture;\n');
  console.log(`✅ Wrote texture declarations to: ${textureDeclarationsPath}`);

  // Write params file
  const params = {
    size: RING_SIZE,
    resolution: [resolution, resolution, resolution],
    hasTexture: true,
    date: dateStr,
    unixTime: unixTime,
    displayText: displayText
  };
  const paramsPath = path.join(sdfDir, 'params.json');
  fs.writeFileSync(paramsPath, JSON.stringify(params, null, 2));
  console.log(`✅ Wrote params to: ${paramsPath}`);

  // Copy the MSDF texture
  const textureDest = path.join(sdfDir, 'msdf.png');
  fs.copyFileSync(FONT_PNG_PATH, textureDest);
  console.log(`✅ Copied MSDF texture to: ${textureDest}`);

  console.log(`\n💡 To generate mesh, run:`);
  console.log(`   cd ../sdf-mesher && node auto-mesh.js ${outputName}`);
  console.log(`\n   Make sure the sdf-mesher server is running:`);
  console.log(`   cd ../sdf-mesher && python3 -m http.server 8000`);
}

main().catch(console.error);
