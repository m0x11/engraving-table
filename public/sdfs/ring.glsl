//////////////////////////////////////////////////////////
// Ring SDF - Signet ring with solar system engraving
// Uses time parameter for animation
//////////////////////////////////////////////////////////

#define RING_DEPTH 2.5

#ifndef ringSystemScale
    #define ringSystemScale 1.32
#endif

#ifndef ringTrailScale
    #define ringTrailScale 1.5
#endif

#define RING_MERCURY 0
#define RING_VENUS   1
#define RING_EARTH   2
#define RING_MARS    3
#define RING_JUPITER 4
#define RING_SATURN  5
#define RING_URANUS  6
#define RING_NEPTUNE 7

#define RING_J2000_UNIX 946728000.0
#define RING_SECONDS_PER_DAY 86400.0
#define RING_DEG_TO_RAD (PI / 180.0)

float ringIsOrbitEnabled(int planetID) {
    if (planetID == RING_MERCURY) return 1.0;
    else if (planetID == RING_VENUS) return 0.0;
    else if (planetID == RING_EARTH) return 1.0;
    else if (planetID == RING_MARS) return 0.0;
    else if (planetID == RING_JUPITER) return 0.0;
    else if (planetID == RING_SATURN) return 0.0;
    else if (planetID == RING_URANUS) return 0.0;
    else if (planetID == RING_NEPTUNE) return 1.0;
    return 0.0;
}

float ringGetSemiMajorAxis(int planetID) {
    if (planetID == RING_MERCURY) return 0.33;
    else if (planetID == RING_VENUS) return 0.60;
    else if (planetID == RING_EARTH) return 0.87;
    else if (planetID == RING_MARS) return 1.13;
    else if (planetID == RING_JUPITER) return 1.40;
    else if (planetID == RING_SATURN) return 1.67;
    else if (planetID == RING_URANUS) return 1.93;
    else if (planetID == RING_NEPTUNE) return 2.20;
    return 0.0;
}

float ringGetEccentricity(int planetID) {
    return 0.0;
}

float ringGetInclination(int planetID) {
    return 0.0;
}

float ringGetAscendingNode(int planetID) {
    if (planetID == RING_MERCURY) return 48.331;
    else if (planetID == RING_VENUS) return 76.680;
    else if (planetID == RING_EARTH) return -11.261;
    else if (planetID == RING_MARS) return 49.558;
    else if (planetID == RING_JUPITER) return 100.464;
    else if (planetID == RING_SATURN) return 113.665;
    else if (planetID == RING_URANUS) return 74.006;
    else if (planetID == RING_NEPTUNE) return 131.783;
    return 0.0;
}

float ringGetArgPerihelion(int planetID) {
    if (planetID == RING_MERCURY) return 77.456;
    else if (planetID == RING_VENUS) return 131.533;
    else if (planetID == RING_EARTH) return 102.947;
    else if (planetID == RING_MARS) return 336.041;
    else if (planetID == RING_JUPITER) return 14.331;
    else if (planetID == RING_SATURN) return 92.432;
    else if (planetID == RING_URANUS) return 170.964;
    else if (planetID == RING_NEPTUNE) return 44.971;
    return 0.0;
}

float ringGetMeanLongitude(int planetID) {
    if (planetID == RING_MERCURY) return 252.25;
    else if (planetID == RING_VENUS) return 181.98;
    else if (planetID == RING_EARTH) return 100.46;
    else if (planetID == RING_MARS) return 355.45;
    else if (planetID == RING_JUPITER) return 34.40;
    else if (planetID == RING_SATURN) return 49.94;
    else if (planetID == RING_URANUS) return 313.23;
    else if (planetID == RING_NEPTUNE) return 304.88;
    return 0.0;
}

float ringGetOrbitalPeriod(int planetID) {
    if (planetID == RING_MERCURY) return 87.969;
    else if (planetID == RING_VENUS) return 224.701;
    else if (planetID == RING_EARTH) return 365.256;
    else if (planetID == RING_MARS) return 686.980;
    else if (planetID == RING_JUPITER) return 4332.589;
    else if (planetID == RING_SATURN) return 10759.22;
    else if (planetID == RING_URANUS) return 30688.5;
    else if (planetID == RING_NEPTUNE) return 60182.0;
    return 1.0;
}

#define RING_PLANET_SCALE 0.5

float ringGetPlanetRadius(int index) {
    if (index == -1) return 0.0;
    return 0.32;
}

float ringGetTrailThickness(int planetID) {
    return 0.04;
}

#ifndef ringMoonOrbitRadius
    #define ringMoonOrbitRadius 0.1
#endif
#ifndef ringMoonRadius
    #define ringMoonRadius 0.095
#endif

const float RING_MOON_ORBITAL_PERIOD = 27.321661;
const float RING_MOON_TRAIL_THICKNESS = 0.01;

float ringGetPlanetAngle(float unixTime, int planetID) {
    float daysFromJ2000 = (unixTime - RING_J2000_UNIX) / RING_SECONDS_PER_DAY;
    float period = ringGetOrbitalPeriod(planetID);
    float meanMotion = 2.0 * PI / period;
    float angle = (meanMotion * daysFromJ2000) +
                  (ringGetMeanLongitude(planetID) * RING_DEG_TO_RAD);
    return mod(angle, 2.0 * PI);
}

vec3 ringGetPlanetPosition(float unixTime, int planetID) {
    float angle = ringGetPlanetAngle(unixTime, planetID);
    float radius = ringGetSemiMajorAxis(planetID) * ringSystemScale;
    return vec3(
        -radius * cos(angle),
        0.0,
        radius * sin(angle)
    );
}

#ifndef ringSphereRadius
    #define ringSphereRadius 15.
#endif

#ifndef ringSphereCenterY
    #define ringSphereCenterY 15.0
#endif

float ringGetBowlHeight(float r) {
    if (r >= ringSphereRadius) return 0.0;
    return ringSphereCenterY - sqrt(ringSphereRadius*ringSphereRadius - r*r);
}

vec3 ringTransformToBowl(vec3 p) {
    float r = length(p.xz);
    float bowlY = ringGetBowlHeight(r);
    return vec3(p.x, p.y - bowlY, p.z);
}

float ringGetBowlSphereDistance(vec3 p) {
    vec3 sphereCenter = vec3(0.0, ringSphereCenterY, 0.0);
    return length(p - sphereCenter) - ringSphereRadius;
}

mat2 ringRot(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c);
}

float ringSmax(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
    return mix(b, a, h) + k * h * (1.0 - h);
}

float ringSmin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float ringDirectionalSminY(float d1, float d2, float k, vec3 p) {
    float dSmooth = ringSmin(d1, d2, k);
    float dHard = min(d1, d2);
    if (p.y > -0.5 && p.y < 0.5) {
        return dSmooth;
    } else {
        return dHard;
    }
}

float ringsdCappedCylinder(vec3 p, float r, float hh) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, hh);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float ringsdCapsule(vec3 p, float r, float h) {
    float y = max(0.0, min(h, p.y));
    return length(vec3(p.x, p.y - y, p.z)) - r;
}

float ringsdTorusX(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.yz) - t.x, p.x);
    return length(q) - t.y;
}

float ringsdBox(vec3 p, vec3 s) {
    p = abs(p) - s;
    return length(max(p, 0.)) + min(max(p.x, max(p.y, p.z)), 0.);
}

float ringGetMoonOrbitRadius() {
    float earthEffectiveRadius = ringGetPlanetRadius(RING_EARTH) * RING_PLANET_SCALE;
    return earthEffectiveRadius - ringMoonRadius;
}

vec3 ringGetMoonPosition(float unixTime, vec3 earthPosOriginal) {
    float daysFromJ2000 = (unixTime - RING_J2000_UNIX) / RING_SECONDS_PER_DAY;
    const float MOON_PERIOD = 27.321661;
    float moonAngle = (2.0 * PI * daysFromJ2000) / MOON_PERIOD + PI;
    float offset = 0.;
    float orbitRadius = ringGetMoonOrbitRadius() + offset;
    vec3 earthPos = ringTransformToBowl(earthPosOriginal);
    float moonX = -cos(moonAngle) * orbitRadius;
    float moonZ = sin(moonAngle) * orbitRadius;
    return earthPos + vec3(moonX, 0.0, moonZ);
}

float ringEllipsoidDist(vec3 p, vec3 center, float R, float scaleY) {
    vec3 q = p - center;
    q.y /= scaleY;
    return length(q) - R;
}

float ringGetPlanetDistance(vec3 p, int planetIndex, float unixTime, float scaleX, float scaleY) {
    vec3 planetPos = ringGetPlanetPosition(unixTime, planetIndex);
    return ringEllipsoidDist(
        p,
        planetPos,
        ringGetPlanetRadius(planetIndex) * RING_PLANET_SCALE * scaleX,
        scaleY
    );
}

float ringGetPlanetsDistance(vec3 p, float unixTime) {
    p.y += 0.025;
    float minDist = length(p) - ringGetPlanetRadius(-1);
    for(int i = 0; i < 8; i++) {
        float planetDist = ringGetPlanetDistance(p, i, unixTime, 1.0, 0.6);
        minDist = min(minDist, planetDist);
        if(i == RING_EARTH) {
            vec3 moonPos = ringGetMoonPosition(unixTime, ringGetPlanetPosition(unixTime, i));
            float moonDist = length(p - moonPos) - ringMoonRadius;
            minDist = min(minDist, moonDist);
        }
    }
    return minDist;
}

float ringGetOuterPlanetsDistance(vec3 p, float unixTime) {
    p.y += 0.025;
    float minDist = length(p) - ringGetPlanetRadius(-1);
    for(int i = 4; i < 8; i++) {
        float planetDist = ringGetPlanetDistance(p, i, unixTime, 1.0, 0.6);
        minDist = min(minDist, planetDist);
    }
    return minDist;
}

float ringGetMoonDistance(vec3 p, float unixTime) {
    p.y += 0.07;
    p.y *= RING_DEPTH;
    vec3 earthPosOriginal = ringGetPlanetPosition(unixTime, RING_EARTH);
    vec3 moonPos = ringGetMoonPosition(unixTime, earthPosOriginal);
    float moonDist = ringsdCappedCylinder((p - moonPos), .1, .219);
    return moonDist;
}

float ringGetSmallPlanetsDistance(vec3 p, float unixTime) {
    p.y += 0.025;
    float minDist = length(p) - ringGetPlanetRadius(-1);
    for(int i = 0; i < 5; i++) {
        if (i == RING_EARTH) continue;
        float planetDist = ringGetPlanetDistance(p, i, unixTime, 1.0, 0.6);
        minDist = min(minDist, planetDist);
    }
    return minDist;
}

float ringGetEarthDistance(vec3 p, float unixTime) {
    p.y += 0.025;
    float minDist = length(p) - ringGetPlanetRadius(-1);
    float planetDist = ringGetPlanetDistance(p, RING_EARTH, unixTime, 1.0, 0.6);
    minDist = min(minDist, planetDist);
    return minDist;
}

float ringsdCircularOrbit(vec3 p, float radius, float thickness) {
    vec2 q = vec2(length(p.xz), p.y);
    return length(q - vec2(radius, 0.0)) - thickness;
}

float ringGetPlanetOrbitPathDistance(vec3 p, int planetID) {
    p.y /= 1.32;
    float orbitRadius = ringGetSemiMajorAxis(planetID) * ringSystemScale;
    float thickness = ringGetTrailThickness(planetID) * ringTrailScale;
    return ringsdCircularOrbit(p, orbitRadius, thickness);
}

float ringGetMoonOrbitPathDistance(vec3 p, float t) {
    vec3 earthPos = ringGetPlanetPosition(t, RING_EARTH);
    vec3 plocal = p - earthPos;
    float orbitRadius = ringGetMoonOrbitRadius();
    float dist = length(vec2(length(plocal.xz) - orbitRadius, plocal.y));
    return dist;
}

float ringGetStarOrbitPathDistance(vec3 p) {
    p.y += 0.02;
    float orbitRadius = 0.05;
    return length(p) - orbitRadius;
}

float ringReferenceShape(vec3 p) {
    p.y += 0.5;
    return ringsdCappedCylinder(p, 1.2, 0.4);
}

float ringCircularReference(vec3 p) {
    p.y -= 0.5;
    return ringsdCappedCylinder(p, 2.75, .5);
}

float ringStarShape(vec3 p, float targetDate, float stretchFactor) {
    p.xy *= ringRot(PI / 2.0);
    p.yz *= ringRot(PI / 2.0);
    p.x /= stretchFactor;
    float pointAngle = atan(p.z, p.y);

    float numSpokes = 8.0;
    float spokeSpacing = 2.0 * PI / numSpokes;
    float closestSpokeAngle = floor((pointAngle / spokeSpacing) + 0.5) * spokeSpacing;

    vec3 earthPosWorld = ringGetPlanetPosition(targetDate, RING_EARTH);
    earthPosWorld.xy *= ringRot(PI / 2.0);
    earthPosWorld.yz *= ringRot(PI);
    float earthAngleLocal = atan(earthPosWorld.z, earthPosWorld.y);

    vec3 neptunePosWorld = ringGetPlanetPosition(targetDate, RING_NEPTUNE);
    neptunePosWorld.xy *= ringRot(PI / 2.0);
    neptunePosWorld.yz *= ringRot(PI);
    float neptuneAngleLocal = atan(neptunePosWorld.z, neptunePosWorld.y);

    float earthAngularDist = PI - abs(PI - abs(
        mod(closestSpokeAngle - earthAngleLocal, 2.0*PI)
    ));

    float neptuneAngularDist = PI - abs(PI - abs(
        mod(closestSpokeAngle - neptuneAngleLocal, 2.0*PI)
    ));

    float maskingSphereRadius = 0.45;
    float neptuneMaskOffset = 3.0;

    vec3 spokePt = p;
    spokePt.yz *= ringRot(-closestSpokeAngle);

    float rayLength = 3.16;
    float rayThickness = 0.011;

    float rays = ringsdCapsule(spokePt, rayThickness, rayLength);

    if (neptuneAngularDist < PI/24.) {
        vec3 maskPos = vec3(0.0, neptuneMaskOffset, 0.0);
        maskPos.yz *= ringRot(closestSpokeAngle);
        float maskingSphere = length(p - maskPos) - maskingSphereRadius;
        rays = max(-maskingSphere, rays);
    }

    return rays;
}

float ringTop(vec3 p) {
    p.y -= 0.4;
    return ringsdCappedCylinder(p, 3., 2.);
}

float ringBandPosY = 3.7;

float ringDrillHole(vec3 p) {
    p.y += ringBandPosY;
    p.xy *= ringRot(PI/2.);
    return ringsdCappedCylinder(p, 3.9, 5.0);
}

float ringShave(vec3 p) {
    p.x = abs(p.x);
    p.x -= 4.75;
    p.y += ringBandPosY;
    p.xy *= ringRot(PI/2.);
    p.zy *= ringRot(PI/2.);

    float edge = ringsdBox(vec3(p.x - 3.9, p.y, p.z), vec3(3.9, 5., 3.9));

    return min(edge, ringsdCappedCylinder(vec3(p.x/1.11, p.y, p.z), 3.9, 5.0));
}

float ringBand(vec3 p) {
    p.x /= 2.;
    p.y += 3.7;
    return ringsdTorusX(p, vec2(4.0, 0.48));
}

float ringSignet(vec3 p) {
    p.y += 0.8;
    float r = ringReferenceShape(p);
    float drill = ringDrillHole(p);
    float dTop = ringTop(p);
    float dBand = ringBand(p);

    float smoothedBand = ringSmin(r, dBand, 7.3);
    float ring = ringSmin(dTop, smoothedBand, 0.32);
    float fullForm = ring;

    fullForm = ringSmax(fullForm, -(ringShave(p)), .64);
    fullForm = max(-drill, fullForm);

    return fullForm;
}

float ringFractus(vec2 p, vec2 v) {
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

vec3 ringCurveSpace(vec3 p) {
    float strength = -.13;
    float dist = abs(p.y);
    float curveFactor = dist * dist * strength;
    p.z += curveFactor;
    return p;
}

float ringStamp(vec3 p) {
    float thickness = .22;
    p.y += 8.45;
    p.yz *= ringRot(PI/2.);
    p = ringCurveSpace(p);
    p *= 1.4;

    float ftusMain = ringFractus(p.yx, vec2(-1., 0.0));
    p.z = abs(p.z);
    float slice = max(ftusMain, p.z - thickness);

    return slice;
}

//////////////////////////////////////////////////////////
// Main Ring SDF
//////////////////////////////////////////////////////////
float ringSdf(vec3 p, float time) {
    p.xz *= ringRot(-PI / 2.);
    p.xy *= ringRot(PI / 2.);

    float targetDate = time * 1000000.;

    vec3 transformedP = ringTransformToBowl(p);
    transformedP.xz *= ringRot(-PI / 2.);

    //transformedP.xy *= ringRot(PI / 2.);
    

    transformedP.y /= RING_DEPTH;

    float dOuterPlanets = ringGetOuterPlanetsDistance(transformedP, targetDate);
    float dMoonSphere = ringGetMoonDistance(transformedP, targetDate);
    float dEarthSphere = ringGetEarthDistance(transformedP, targetDate);
    float dSmallPlanets = ringGetSmallPlanetsDistance(transformedP, targetDate);

    float dMerc = ringGetPlanetOrbitPathDistance(transformedP, RING_MERCURY);
    float dVenus = ringGetPlanetOrbitPathDistance(transformedP, RING_VENUS);
    float dEarth = ringGetPlanetOrbitPathDistance(transformedP, RING_EARTH);
    float dNept = ringGetPlanetOrbitPathDistance(transformedP, RING_NEPTUNE);
    float dStarOrbit = ringGetStarOrbitPathDistance(transformedP);

    float dOthers = 1e10;
    for(int i = 3; i <= 6; i++) {
        float d = ringGetPlanetOrbitPathDistance(transformedP, i);
        if (d < dOthers) {
            dOthers = d;
        }
    }

    float dSignet = ringSignet(p);
    float dBasinSphere = ringGetBowlSphereDistance(p);
    float dRing = max(-dBasinSphere, dSignet);

    transformedP.xz *= ringRot(PI / 2.);
    float dStar = ringStarShape(transformedP, targetDate, 1.64);

    float garnish = 1e10;

    garnish = ringSmin(dStar, dStarOrbit, 0.18);
    garnish = min(garnish, ringStarShape(transformedP, targetDate, 4.));

    garnish = ringSmin(garnish, dMerc, 0.);
    garnish = ringSmin(garnish, dVenus, 0.0);
    garnish = ringSmin(garnish, dEarth, 0.0);
    garnish = ringSmin(garnish, dNept, 0.2);
    garnish = ringSmin(garnish, dOthers, 0.0);

    float outers = ringDirectionalSminY(dOuterPlanets, garnish, .016, p);
    float small = ringDirectionalSminY(dSmallPlanets, garnish, .01, p);
    float earth = ringDirectionalSminY(dEarthSphere, garnish, .01, p);
    float moon = dMoonSphere;

    float planetsPlusGarnish = min(earth, min(outers, small));
    float finalDist = ringSmax(-planetsPlusGarnish, dRing, 0.0);

    finalDist = ringSmin(moon, finalDist, 0.0);
    finalDist = ringSmax(-dStar, finalDist, 0.0);
    float stampDist = ringStamp(p);
    finalDist = max(finalDist, -stampDist);

    return finalDist;
}
