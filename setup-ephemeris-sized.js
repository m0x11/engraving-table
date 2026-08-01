#!/usr/bin/env node

/**
 * Sets up the ephemeris-sized SDF folder: the PARAMETRIC ring geometry
 * (ported from product-playground/src/products/ephemeris/shader.ts — the
 * design source of truth), engraving glyphs pre-loaded like the legacy
 * ephemeris-variable setup.
 *
 * Unlike the legacy flow (generate at base scale, uniformly resize the
 * mesh), the size is baked into the FIELD via uniforms, so the band
 * cross-section, dial margin, engraving and stamp hold their designed mm
 * values at every size. The mesh comes out in model units; physical mm =
 * units x 2.3205128 (18.1/7.8) at EVERY size — see resize step.
 *
 * The resulting SDF accepts uniforms:
 * - uTargetDate                Unix timestamp for planetary positions
 * - uGlyphIndices[11]          glyph per engraving slot
 * - uBoreR, uBandDepth, uCapScale, uDialScale, uDetail, uTextScale, uCenterY
 *                              the size dials (sdf-mesher/ring-sizing.js)
 *
 * Run once: node setup-ephemeris-sized.js
 * Then:     cd ../sdf-mesher && node batch-engrave.js --size 13 11-11-1111
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const FONT_JSON_PATH = path.join(__dirname, 'public/fonts/PPRightSerifMono-msdf.json');
const FONT_PNG_PATH = path.join(__dirname, 'public/fonts/PPRightSerifMono-msdf.png');
const COMMON_PATH = path.join(__dirname, 'public/sdfs/common.glsl');
const OUTPUT_DIR = path.join(__dirname, '..', 'sdfs', 'ephemeris-sized');

// Glyphs — identical to setup-ephemeris-variable.js (keep in lockstep)
const GLYPH_CHARS = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '·',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'J', 'L',
  'M', 'N', 'O', 'P', 'R', 'S', 'T', 'U', 'V', 'Y'
];

function loadFontData() {
  const jsonData = JSON.parse(fs.readFileSync(FONT_JSON_PATH, 'utf8'));
  const png = PNG.sync.read(fs.readFileSync(FONT_PNG_PATH));
  return { json: jsonData, atlasWidth: png.width, atlasHeight: png.height };
}

function getGlyphData(fontData, char) {
  const glyph = fontData.json.glyphs.find(g => String.fromCharCode(g.unicode) === char);
  if (!glyph || !glyph.atlasBounds || !glyph.planeBounds) return null;
  return glyph;
}

function generateGlyphGLSL(fontData, middleDotCenter = 0.34) {
  const glyphs = [];
  const { atlasWidth, atlasHeight } = fontData;

  for (const char of GLYPH_CHARS) {
    let lookupChar = char;
    let verticalOffset = 0;
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
    glyphs.push({
      char,
      uv: {
        left: glyph.atlasBounds.left / atlasWidth,
        bottom: 1.0 - glyph.atlasBounds.top / atlasHeight,
        right: glyph.atlasBounds.right / atlasWidth,
        top: 1.0 - glyph.atlasBounds.bottom / atlasHeight,
      },
      plane: {
        left: glyph.planeBounds.left,
        bottom: glyph.planeBounds.bottom + verticalOffset,
        right: glyph.planeBounds.right,
        top: glyph.planeBounds.top + verticalOffset,
      },
    });
  }

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

  let dispatcherCases = '';
  for (let i = 0; i < glyphs.length; i++) {
    dispatcherCases += `  ${i === 0 ? 'if' : 'else if'} (idx == ${i}) return glyphSdf${i}(p);\n`;
  }

  return `
// ========== TEXT SDF FUNCTIONS (sized) ==========
#define PX_RANGE 8.0
#define GLYPH_SIZE 48.0
#define NUM_POSITIONS 11

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

mat2 Rot2D(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

// Date on the bore — the engraving table's layout, parametric: the band
// centre and bore radius come from the size dials. Glyph em is the
// PRODUCTION 1.5 (sdfs/ephemeris-variable/sdf.txt, commit "fix ephemeris
// ring engraving size") riding uTextScale (the old pipeline's uniform
// factor), so the date is engraved as big as the table always cut it,
// at every size.
float textOnInnerCylinder(vec3 p) {
  vec3 q = p;
  q.y -= EPH_BAND_CENTER_Y;
  q.xy = Rot2D(PI/2.0) * q.xy;

  float cylinderRadius = uBoreR;
  float angle = atan(q.z, q.x);
  float r = length(q.xz);
  float h = q.y;

  float textScale = 1.5 * uTextScale;
  float textX = -angle * cylinderRadius / textScale;
  float textY = h / textScale + 0.34;

  float d2d = textSdf2D(vec2(textX, textY)) * textScale;

  float textDepth = 0.172 * uTextScale;
  float surfaceDist = cylinderRadius - r;

  vec2 w = vec2(d2d, abs(surfaceDist) - textDepth);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
}
// ========== END TEXT SDF FUNCTIONS ==========
`;
}

// ---------------------------------------------------------------------------
// The parametric ring — verbatim port of the playground's ephemeris scene
// (product-playground/src/products/ephemeris/shader.ts). Five uniforms drive
// every derived dimension; sizes <= 6 reproduce the legacy geometry exactly.

const SIZED_SCENE_GLSL = `
// ========== SIZED EPHEMERIS SCENE ==========
// (uTargetDate, uGlyphIndices, uMsdfTexture + the size dials are declared
//  via texture-declarations at run time)

float targetDate;

#define DEPTH 2.2

#define BAND_MINOR (0.48 * uDetail)
#define OUTER_R (uBoreR + uBandDepth)
#define BAND_MAJOR (OUTER_R - BAND_MINOR)
#define EPH_BAND_CENTER_Y (-(OUTER_R + 0.02 * uCapScale))
#define SHOULDER_K (7.3 * -(EPH_BAND_CENTER_Y) / 4.5)
#define STAMP_Y (EPH_BAND_CENTER_Y - OUTER_R + 0.53 * uDetail)
#define STAMP_CURVE (-0.13 * 4.48 / OUTER_R)

#define MERCURY 0
#define VENUS   1
#define EARTH   2
#define MARS    3
#define JUPITER 4
#define SATURN  5
#define URANUS  6
#define NEPTUNE 7

#define J2000_UNIX 946728000.0
#define SECONDS_PER_DAY 86400.0
#define systemScale 1.32
#define trailScale 1.5
#define PLANET_SCALE 0.5
#define moonRadius 0.1

float getSemiMajorAxis(int planetID) {
    if (planetID == MERCURY) return 0.33;
    else if (planetID == VENUS)   return 0.60;
    else if (planetID == EARTH)   return 0.87;
    else if (planetID == MARS)    return 1.13;
    else if (planetID == JUPITER) return 1.40;
    else if (planetID == SATURN)  return 1.67;
    else if (planetID == URANUS)  return 1.93;
    else if (planetID == NEPTUNE) return 2.20;
    return 0.0;
}

float getMeanLongitude(int planetID) {
    if (planetID == MERCURY) return 252.25;
    else if (planetID == VENUS)   return 181.98;
    else if (planetID == EARTH)   return 100.46;
    else if (planetID == MARS)    return 355.45;
    else if (planetID == JUPITER) return 34.40;
    else if (planetID == SATURN)  return 49.94;
    else if (planetID == URANUS)  return 313.23;
    else if (planetID == NEPTUNE) return 304.88;
    return 0.0;
}

float getOrbitalPeriod(int planetID) {
    if (planetID == MERCURY) return 87.969;
    else if (planetID == VENUS)   return 224.701;
    else if (planetID == EARTH)   return 365.256;
    else if (planetID == MARS)    return 686.980;
    else if (planetID == JUPITER) return 4332.589;
    else if (planetID == SATURN)  return 10759.22;
    else if (planetID == URANUS)  return 30688.5;
    else if (planetID == NEPTUNE) return 60182.0;
    return 1.0;
}

float getPlanetRadius(int index) {
    if (index == -1) return 0.0;
    return 0.32;
}

float getTrailThickness(int planetID) {
    return 0.04;
}

float getPlanetAngle(float unixTime, int planetID) {
    float daysFromJ2000 = (unixTime - J2000_UNIX) / SECONDS_PER_DAY;
    float period = getOrbitalPeriod(planetID);
    float meanMotion = 2.0 * PI / period;
    float angle = (meanMotion * daysFromJ2000) +
                  (getMeanLongitude(planetID) * (PI / 180.0));
    return mod(angle, 2.0 * PI);
}

vec3 getPlanetPosition(float unixTime, int planetID) {
    float angle = getPlanetAngle(unixTime, planetID);
    float radius = getSemiMajorAxis(planetID) * systemScale;
    return vec3(-radius * cos(angle), 0.0, radius * sin(angle));
}

// bowl (the dish the carvings sit in) — evaluated in CAP space
float getBowlHeight(float r) {
    if (r >= 15.0) return 0.0;
    return 15.0 - sqrt(15.0 * 15.0 - r * r);
}

float getBowlSphereDistanceCap(vec3 p) {
    vec3 sphereCenter = vec3(0.0, 15.0, 0.0);
    return length(p - sphereCenter) - 15.0;
}

float getMoonOrbitRadius() {
    float earthEffectiveRadius = getPlanetRadius(EARTH) * PLANET_SCALE;
    return earthEffectiveRadius - moonRadius;
}

vec3 transformToBowlPattern(vec3 p) {
    float r = length(p.xz);
    return vec3(p.x, p.y - getBowlHeight(r), p.z);
}

vec3 getMoonPositionFlat(float unixTime, vec3 earthPosOriginal) {
    float daysFromJ2000 = (unixTime - J2000_UNIX) / SECONDS_PER_DAY;
    float moonAngle = (2.0 * PI * daysFromJ2000) / 27.321661 + PI;
    float orbitRadius = getMoonOrbitRadius();
    vec3 earthPos = transformToBowlPattern(earthPosOriginal);
    float moonX = -cos(moonAngle) * orbitRadius;
    float moonZ = sin(moonAngle) * orbitRadius;
    return earthPos + vec3(moonX, 0.0, moonZ);
}

float ellipsoidDist(vec3 p, vec3 center, float R, float scaleY) {
    vec3 q = p - center;
    q.y /= scaleY;
    return length(q) - R;
}

float getPlanetDistance(vec3 p, int planetIndex, float unixTime, float scaleX, float scaleY) {
    vec3 planetPos = getPlanetPosition(unixTime, planetIndex);
    return ellipsoidDist(p, planetPos, getPlanetRadius(planetIndex) * PLANET_SCALE * scaleX, scaleY);
}

float getOuterPlanetsDistance(vec3 p, float unixTime) {
    p.y += 0.025;
    float minDist = length(p) - getPlanetRadius(-1);
    for (int i = 4; i < 8; i++) {
        float planetDist = getPlanetDistance(p, i, unixTime, 1.0, 1.0);
        minDist = min(minDist, planetDist);
    }
    return minDist;
}

float getMoonDistance(vec3 p, float unixTime) {
    p.y += 0.07;
    p.y *= DEPTH;
    vec3 earthPosFlat = getPlanetPosition(unixTime, EARTH);
    vec3 moonPos = getMoonPositionFlat(unixTime, earthPosFlat);
    return sdCappedCylinder((p - moonPos), .11, .198);
}

float getSmallPlanetsDistance(vec3 p, float unixTime) {
    p.y += 0.025;
    float minDist = length(p) - getPlanetRadius(-1);
    for (int i = 0; i < 5; i++) {
        if (i == EARTH) continue;
        float planetDist = getPlanetDistance(p, i, unixTime, 1.0, 1.0);
        minDist = min(minDist, planetDist);
    }
    return minDist;
}

float getEarthDistance(vec3 p, float unixTime) {
    p.y += 0.025;
    float minDist = length(p) - getPlanetRadius(-1);
    float planetDist = getPlanetDistance(p, EARTH, unixTime, 1.0, 0.6);
    minDist = min(minDist, planetDist);
    return minDist;
}

float sdCircularOrbit(vec3 p, float radius, float thickness) {
    vec2 q = vec2(length(p.xz), p.y);
    return length(q - vec2(radius, 0.0)) - thickness;
}

float getPlanetOrbitPathDistance(vec3 p, int planetID) {
    p.y /= 1.32;
    float orbitRadius = getSemiMajorAxis(planetID) * systemScale;
    float thickness = getTrailThickness(planetID) * trailScale;
    return sdCircularOrbit(p, orbitRadius, thickness);
}

float getStarOrbitPathDistance(vec3 p) {
    p.y += 0.02;
    float orbitRadius = 0.05;
    return length(p) - orbitRadius;
}

float directionalSminY(float d1, float d2, float k, vec3 p) {
    float dSmooth = smin(d1, d2, k);
    float dHard = min(d1, d2);
    if (p.y > -0.5 && p.y < 0.5) {
        return dSmooth;
    } else {
        return dHard;
    }
}

float referenceShape(vec3 p) {
    p.y += 0.5;
    return sdCappedCylinder(p, 1.2, 0.4);
}

float starShape(vec3 p, float date) {
    p.xy *= Rot(PI / 2.0);
    p.yz *= Rot(PI / 2.0);
    p.x /= 1.64;
    float pointAngle = atan(p.z, p.y);

    float numSpokes = 8.0;
    float spokeSpacing = 2.0 * PI / numSpokes;
    float closestSpokeAngle = floor((pointAngle / spokeSpacing) + 0.5) * spokeSpacing;

    vec3 neptunePosWorld = getPlanetPosition(date, NEPTUNE);
    neptunePosWorld.xy *= Rot(PI / 2.0);
    neptunePosWorld.yz *= Rot(PI);
    float neptuneAngleLocal = atan(neptunePosWorld.z, neptunePosWorld.y);

    float neptuneAngularDist = PI - abs(PI - abs(
        mod(closestSpokeAngle - neptuneAngleLocal, 2.0 * PI)
    ));

    float maskingSphereRadius = 0.45;
    float neptuneMaskOffset = 3.0;

    vec3 spokePt = p;
    spokePt.yz *= Rot(-closestSpokeAngle);

    float rayLength = 3.16;
    float rayThickness = 0.011;
    float rays = sdCapsule(spokePt, rayThickness, rayLength);

    if (neptuneAngularDist < PI / 24.) {
        vec3 maskPos = vec3(0.0, neptuneMaskOffset, 0.0);
        maskPos.yz *= Rot(closestSpokeAngle);
        float maskingSphere = length(p - maskPos) - maskingSphereRadius;
        rays = max(-maskingSphere, rays);
    }

    return rays;
}

float ringTop(vec3 p) {
    p.y -= 0.4;
    return sdCappedCylinder(p, 3., 2.);
}

float drillHole(vec3 p) {
    p.y -= EPH_BAND_CENTER_Y;
    p.xy *= Rot(PI / 2.);
    return sdCappedCylinder(p, uBoreR, 5.0);
}

float shave(vec3 p) {
    float reach = OUTER_R + 1.5;
    p.x = abs(p.x);
    p.x -= uBoreR + 0.85 * uDetail;
    p.y -= EPH_BAND_CENTER_Y;
    p.xy *= Rot(PI / 2.);
    p.zy *= Rot(PI / 2.);
    float edge = sdBox(vec3(p.x - uBoreR, p.y, p.z), vec3(uBoreR, reach, uBoreR));
    return min(edge, sdCappedCylinder(vec3(p.x / 1.11, p.y, p.z), uBoreR, reach));
}

float ringBand(vec3 p) {
    p.y -= EPH_BAND_CENTER_Y;
    p.x /= 2.;
    return sdTorusX(p, vec2(BAND_MAJOR, BAND_MINOR));
}

float signet(vec3 p) {
    // face assembly (the cap) — scaled by the tier's cap size about the
    // scene origin; the band is parametric, never scaled
    vec3 fp = p / uCapScale;
    fp.y += 0.8;
    float r = referenceShape(fp) * uCapScale;
    float dTop = ringTop(fp) * uCapScale;
    float drill = drillHole(p);
    float dBand = ringBand(p);

    float smoothedBand = smin(r, dBand, SHOULDER_K);
    float ring = smin(dTop, smoothedBand, 0.32 * uCapScale);
    float fullForm = ring;

    fullForm = smax(fullForm, -(shave(p)), .64 * uDetail);
    fullForm = max(-drill, fullForm);

    return fullForm;
}

vec3 curveSpace(vec3 p) {
    float strength = STAMP_CURVE;
    float dist = abs(p.y);
    float curveFactor = dist * dist * strength;
    p.z += curveFactor;
    return p;
}

float fractus(vec2 p, vec2 v) {
    vec2 z = p;
    vec2 c = v;
    float k = 1., h = 1.0;
    for (float i = 0.; i < 100.; i++) {
        if (i > 3.) break;
        h *= 4. * k;
        k = dot(z, z);
        if (k > 100.) break;
        z = vec2(z.x * z.x - z.y * z.y, 2. * z.x * z.y) + c;
    }
    return sqrt(k / h) * log(k);
}

float stamp(vec3 p) {
    float thickness = .22;
    p.y -= STAMP_Y;
    p.yz *= Rot(PI / 2.);
    p = curveSpace(p);
    p *= 1.4 / uDetail;

    float s = -1.0;
    float ftusMain = fractus(p.yx, vec2(s, 0.0));
    p.z = abs(p.z);
    return max(ftusMain, p.z - thickness);
}

float ringSolid(vec3 p) {
    float dSignet = signet(p);
    float dBasinSphere = getBowlSphereDistanceCap(p / uCapScale) * uCapScale;
    return max(-dBasinSphere, dSignet);
}

// dish-carve frame: bend by the CAP's bowl, size the pattern by the DIAL
vec3 dialSpace(vec3 p) {
    vec3 cp = p / uCapScale;
    cp.y -= getBowlHeight(length(cp.xz));
    return cp * (uCapScale / uDialScale);
}

float ephemerisSizedScene(vec3 p) {
    vec3 transformedP = dialSpace(p);
    transformedP.xz *= Rot(-PI / 2.);
    transformedP.y /= DEPTH;

    float dOuterPlanets = getOuterPlanetsDistance(transformedP, targetDate);
    float dMoonSphere = getMoonDistance(transformedP, targetDate);
    float dEarthSphere = getEarthDistance(transformedP, targetDate);
    float dSmallPlanets = getSmallPlanetsDistance(transformedP, targetDate);

    float dMerc = getPlanetOrbitPathDistance(transformedP, MERCURY);
    float dVenus = getPlanetOrbitPathDistance(transformedP, VENUS);
    float dEarth = getPlanetOrbitPathDistance(transformedP, EARTH);
    float dNept = getPlanetOrbitPathDistance(transformedP, NEPTUNE);
    float dStarOrbit = getStarOrbitPathDistance(transformedP);

    float dOthers = 1e10;
    for (int i = 3; i <= 6; i++) {
        float d = getPlanetOrbitPathDistance(transformedP, i);
        if (d < dOthers) {
            dOthers = d;
        }
    }

    float dRing = ringSolid(p);

    transformedP.xz *= Rot(PI / 2.);
    float dStar = starShape(transformedP, targetDate);

    float garnish = 1e10;
    garnish = smin(dStar, dStarOrbit, 0.18);
    garnish = smin(garnish, dMerc, 0.0);
    garnish = smin(garnish, dVenus, 0.0);
    garnish = smin(garnish, dEarth, 0.0);
    garnish = smin(garnish, dNept, 0.2);
    garnish = smin(garnish, dOthers, 0.0);

    vec3 sp = p / uDialScale;
    float outers = directionalSminY(dOuterPlanets, garnish, .016, sp);
    float small = directionalSminY(dSmallPlanets, garnish, .01, sp);
    float earth = directionalSminY(dEarthSphere, garnish, .01, sp);
    float moon = dMoonSphere;

    float planetsPlusGarnish = min(earth, min(outers, small));
    float finalDist = smax(-planetsPlusGarnish * uDialScale, dRing, 0.0);

    finalDist = smin(moon * uDialScale, finalDist, 0.0);
    finalDist = smax(-dStar * uDialScale, finalDist, 0.0);
    float dStamp = stamp(p);
    finalDist = max(finalDist, -dStamp);

    return finalDist;
}
// ========== END SIZED EPHEMERIS SCENE ==========
`;

const MAP_DISTANCE_GLSL = `
// ========== MESH GENERATION mapDistance ==========
float mapDistance(vec3 p) {
  targetDate = uTargetDate;
  p.y += uCenterY; // box origin -> scene frame (ring's vertical middle)

  float dRing = ephemerisSizedScene(p);
  float dText = textOnInnerCylinder(p);
  return max(dRing, -dText);
}
`;

async function main() {
  console.log('🔧 Setting up ephemeris-sized SDF...\n');

  const fontData = loadFontData();
  console.log(`   Atlas: ${fontData.atlasWidth}x${fontData.atlasHeight}`);

  const commonCode = fs.readFileSync(COMMON_PATH, 'utf8');
  const textGlsl = generateGlyphGLSL(fontData);

  const combined = commonCode + '\n' + SIZED_SCENE_GLSL + '\n' + textGlsl + '\n' + MAP_DISTANCE_GLSL;
  console.log(`   Combined SDF: ${combined.length} characters`);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  fs.writeFileSync(path.join(OUTPUT_DIR, 'sdf.txt'), combined);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'texture-declarations.txt'),
    'uniform sampler2D uMsdfTexture;\n'
  );

  const params = {
    // bounding box + resolution are overridden per size by batch-engrave
    size: [12, 12, 12],
    resolution: [600, 600, 600],
    hasTexture: true,
    isVariable: true,
    isSized: true,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'params.json'), JSON.stringify(params, null, 2));
  fs.copyFileSync(FONT_PNG_PATH, path.join(OUTPUT_DIR, 'msdf.png'));

  console.log(`\n✅ ephemeris-sized ready at: ${OUTPUT_DIR}`);
  console.log(`\n💡 Generate with: cd ../sdf-mesher && node batch-engrave.js --size 13 11-11-1111`);
}

main().catch(console.error);
