//////////////////////////////////////////////////////////
// Solar System Visualization SDF
// Uses uTime uniform for animation
//////////////////////////////////////////////////////////

//////////////////////////////////////////////////////////
// Constants and Configurations
//////////////////////////////////////////////////////////
#define DEPTH 2.2

// Visual scale factors
#ifndef systemScale
    #define systemScale 1.32
#endif

#ifndef trailScale
    #define trailScale 1.5
#endif

// Planet IDs
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

float isOrbitEnabled(int planetID) {
    if (planetID == MERCURY) return 1.0;
    else if (planetID == VENUS)   return 0.0;
    else if (planetID == EARTH)   return 1.0;
    else if (planetID == MARS)    return 0.0;
    else if (planetID == JUPITER) return 0.0;
    else if (planetID == SATURN)  return 0.0;
    else if (planetID == URANUS)  return 0.0;
    else if (planetID == NEPTUNE) return 1.0;
    return 0.0;
}

//////////////////////////////////////////////////////////
// Planetary Orbital Parameters
//////////////////////////////////////////////////////////
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

float getEccentricity(int planetID) {
    return 0.0;
}

float getInclination(int planetID) {
    return 0.0;
}

float getAscendingNode(int planetID) {
    if (planetID == MERCURY) return 48.331;
    else if (planetID == VENUS)   return 76.680;
    else if (planetID == EARTH)   return -11.261;
    else if (planetID == MARS)    return 49.558;
    else if (planetID == JUPITER) return 100.464;
    else if (planetID == SATURN)  return 113.665;
    else if (planetID == URANUS)  return 74.006;
    else if (planetID == NEPTUNE) return 131.783;
    return 0.0;
}

float getArgPerihelion(int planetID) {
    if (planetID == MERCURY) return 77.456;
    else if (planetID == VENUS)   return 131.533;
    else if (planetID == EARTH)   return 102.947;
    else if (planetID == MARS)    return 336.041;
    else if (planetID == JUPITER) return 14.331;
    else if (planetID == SATURN)  return 92.432;
    else if (planetID == URANUS)  return 170.964;
    else if (planetID == NEPTUNE) return 44.971;
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

//////////////////////////////////////////////////////////
// Planet Radii
//////////////////////////////////////////////////////////
#define PLANET_SCALE 0.5

float getPlanetRadius(int index, float time) {
    float tri = abs(fract(time / 4.) * 2.0 - 1.0);
    float t = sin(tri * PI * 0.5);
    if (index == -1) {
        return 0.0;
    }
    return mix(-0.5, .32, t);
}

//////////////////////////////////////////////////////////
// Trail thickness
//////////////////////////////////////////////////////////
float getTrailThickness(float time) {
    float tri = abs(fract(time / 4.) * 2.0 - 1.0);
    float t = sin(tri * PI * 0.5);
    return mix(-0.011, 0.002, t);
}

//////////////////////////////////////////////////////////
// Moon configuration
//////////////////////////////////////////////////////////
#ifndef moonOrbitRadius
    #define moonOrbitRadius 0.1
#endif
#ifndef moonRadius
    #define moonRadius 0.1
#endif

const float MOON_ORBITAL_PERIOD = 27.321661;
const float MOON_TRAIL_THICKNESS = 0.01;

//////////////////////////////////////////////////////////
// Planet Orbits
//////////////////////////////////////////////////////////
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
    return vec3(
        -radius * cos(angle),
        0.0,
        radius * sin(angle)
    );
}

//////////////////////////////////////////////////////////
// Bowl transform
//////////////////////////////////////////////////////////
#ifndef sphereRadius
    #define sphereRadius 15.
#endif

#ifndef sphereCenterY
    #define sphereCenterY 15.0
#endif

float getBowlHeight(float r) {
    if (r >= sphereRadius) return 0.0;
    return sphereCenterY - sqrt(sphereRadius*sphereRadius - r*r);
}

vec3 transformToBowl(vec3 p) {
    float r = length(p.xz);
    float bowlY = getBowlHeight(r);
    return vec3(p.x, p.y - bowlY, p.z);
}

float getBowlSphereDistance(vec3 p) {
    vec3 sphereCenter = vec3(0.0, sphereCenterY, 0.0);
    return length(p - sphereCenter) - sphereRadius;
}

float solarRot2D(float a, vec2 v, out vec2 result) {
    float s = sin(a);
    float c = cos(a);
    result = vec2(c * v.x - s * v.y, s * v.x + c * v.y);
    return 0.0;
}

float sdCappedCylinderSolar(vec3 p, float r, float hh) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, hh);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

//////////////////////////////////////////////////////////
// Moon Orbit
//////////////////////////////////////////////////////////
float getMoonOrbitRadius(float time) {
    float earthEffectiveRadius = getPlanetRadius(EARTH, time) * PLANET_SCALE;
    return earthEffectiveRadius - moonRadius;
}

vec3 getMoonPosition(float unixTime, vec3 earthPosOriginal, float time) {
    float daysFromJ2000 = (unixTime - J2000_UNIX) / SECONDS_PER_DAY;
    const float MOON_PERIOD = 27.321661;
    float moonAngle = (2.0 * PI * daysFromJ2000) / MOON_PERIOD + PI;
    float offset = 0.02;
    float orbitRadius = getMoonOrbitRadius(time) + offset;

    vec3 earthPos = transformToBowl(earthPosOriginal);

    float moonX = -cos(moonAngle) * orbitRadius;
    float moonZ = sin(moonAngle) * orbitRadius;
    return earthPos + vec3(moonX, 0.0, moonZ);
}

float ellipsoidDist(vec3 p, vec3 center, float R, float scaleY) {
    vec3 q = p - center;
    q.y /= scaleY;
    return length(q) - R;
}

float getPlanetDistance(vec3 p, int planetIndex, float unixTime, float scaleX, float scaleY, float time) {
    vec3 planetPos = getPlanetPosition(unixTime, planetIndex);
    return ellipsoidDist(
        p,
        planetPos,
        getPlanetRadius(planetIndex, time) * PLANET_SCALE * scaleX,
        scaleY
    );
}

float getPlanetsDistance(vec3 p, float unixTime, float time) {
    p.y += 0.025;
    float minDist = length(p) - getPlanetRadius(-1, time);

    for(int i = 0; i < 8; i++) {
        float planetDist = getPlanetDistance(p, i, unixTime, 1.0, 1., time);
        minDist = min(minDist, planetDist);

        if(i == EARTH) {
            vec3 moonPos = getMoonPosition(unixTime, getPlanetPosition(unixTime, i), time);
            vec3 moonP = p;
            float moonDist = length(moonP - moonPos) - moonRadius;
            minDist = min(minDist, moonDist);
        }
    }

    return minDist;
}

float getOuterPlanetsDistance(vec3 p, float unixTime, float time) {
    p.y += 0.025;
    float minDist = length(p) - getPlanetRadius(-1, time);

    for(int i = 4; i < 8; i++) {
        float planetDist = getPlanetDistance(p, i, unixTime, 1.0, 1., time);
        minDist = min(minDist, planetDist);
    }

    return minDist;
}

float getMoonDistance(vec3 p, float unixTime, float time) {
    float tri = abs(fract(time / 4.) * 2.0 - 1.0);
    float t = sin(tri * PI * 0.5);
    vec3 earthPosOriginal = getPlanetPosition(unixTime, EARTH);
    vec3 moonPos = getMoonPosition(unixTime, earthPosOriginal, time);
    float moonDist = sdCappedCylinderSolar((p - moonPos), mix(-0.15, .11, t), .598);
    return moonDist;
}

float getSmallPlanetsDistance(vec3 p, float unixTime, float time) {
    p.y += 0.025;
    float minDist = length(p) - getPlanetRadius(-1, time);

    for(int i = 0; i < 5; i++) {
        if (i == EARTH) continue;
        float planetDist = getPlanetDistance(p, i, unixTime, 1.0, 1., time);
        minDist = min(minDist, planetDist);
    }

    return minDist;
}

float getEarthDistance(vec3 p, float unixTime, float time) {
    p.y += 0.025;
    float minDist = length(p) - getPlanetRadius(-1, time);
    float planetDist = getPlanetDistance(p, EARTH, unixTime, 1.0, 0.6, time);
    minDist = min(minDist, planetDist);
    return minDist;
}

//////////////////////////////////////////////////////////
// Orbit Path SDF
//////////////////////////////////////////////////////////
float sdCircularOrbit(vec3 p, float radius, float thickness) {
    vec2 q = vec2(length(p.xz), p.y);
    return length(q - vec2(radius, 0.0)) - thickness;
}

float getPlanetOrbitPathDistance(vec3 p, int planetID, float time) {
    p.y /= 1.3;
    float orbitRadius = getSemiMajorAxis(planetID) * systemScale;
    float thickness = getTrailThickness(time) * trailScale;
    return sdCircularOrbit(p, orbitRadius, thickness);
}

float getMoonOrbitPathDistance(vec3 p, float t, float time) {
    vec3 earthPos = getPlanetPosition(t, EARTH);
    vec3 plocal = p - earthPos;
    float orbitRadius = getMoonOrbitRadius(time);
    float dist = length(vec2(length(plocal.xz) - orbitRadius, plocal.y));
    return dist;
}

float getStarOrbitPathDistance(vec3 p) {
    p.y += 0.02;
    float orbitRadius = 0.05;
    return length(p) - orbitRadius;
}

//////////////////////////////////////////////////////////
// Additional geometry
//////////////////////////////////////////////////////////
float solarSmin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float directionalSminY(float d1, float d2, float k, vec3 p) {
    float dSmooth = solarSmin(d1, d2, k);
    float dHard = min(d1, d2);
    if (p.y > -0.5 && p.y < 0.5) {
        return dSmooth;
    } else {
        return dHard;
    }
}

float solarSmax(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
    return mix(b, a, h) + k * h * (1.0 - h);
}

float sdCapsuleSolar(vec3 p, float r, float h) {
    float y = max(0.0, min(h, p.y));
    return length(vec3(p.x, p.y - y, p.z)) - r;
}

float sdTorusXSolar(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.yz) - t.x, p.x);
    return length(q) - t.y;
}

float ringTopSolar(vec3 p) {
    p.y -= 0.4;
    return sdCappedCylinderSolar(p, 3., 2.);
}

float bandPosYSolar = 3.7;

float drillHoleSolar(vec3 p) {
    p.y += bandPosYSolar;
    vec2 rotated;
    solarRot2D(PI/2., p.xy, rotated);
    p.xy = rotated;
    return sdCappedCylinderSolar(p, 3.9, 5.0);
}

float ringBandSolar(vec3 p) {
    p.y += bandPosYSolar;
    p.x /= 2.;
    return sdTorusXSolar(p, vec2(4.0, 0.48));
}

float referenceShapeSolar(vec3 p) {
    p.y += 0.5;
    return sdCappedCylinderSolar(p, 1.2, 0.4);
}

float circularReferenceSolar(vec3 p) {
    p.y -= 0.5;
    return sdCappedCylinderSolar(p, 2.75, .5);
}

float solarStarShape(vec3 p, float targetDate, float time) {
    vec2 rotated;
    solarRot2D(PI / 2.0, p.xy, rotated);
    p.xy = rotated;
    solarRot2D(PI / 2.2, p.yz, rotated);
    p.yz = rotated;

    float pointAngle = atan(p.z, p.y);

    float numSpokes = 8.0;
    float spokeSpacing = 2.0 * PI / numSpokes;
    float closestSpokeAngle = floor((pointAngle / spokeSpacing) + 0.5) * spokeSpacing;

    vec3 earthPosWorld = getPlanetPosition(targetDate, EARTH);
    solarRot2D(PI / 2.0, earthPosWorld.xy, rotated);
    earthPosWorld.xy = rotated;
    solarRot2D(PI, earthPosWorld.yz, rotated);
    earthPosWorld.yz = rotated;
    float earthAngleLocal = atan(earthPosWorld.z, earthPosWorld.y);

    vec3 neptunePosWorld = getPlanetPosition(targetDate, NEPTUNE);
    solarRot2D(PI / 2.0, neptunePosWorld.xy, rotated);
    neptunePosWorld.xy = rotated;
    solarRot2D(PI, neptunePosWorld.yz, rotated);
    neptunePosWorld.yz = rotated;
    float neptuneAngleLocal = atan(neptunePosWorld.z, neptunePosWorld.y);

    float earthAngularDist = PI - abs(PI - abs(
        mod(closestSpokeAngle - earthAngleLocal, 2.0*PI)
    ));

    float neptuneAngularDist = PI - abs(PI - abs(
        mod(closestSpokeAngle - neptuneAngleLocal, 2.0*PI)
    ));

    float maskingSphereRadius = 0.4;
    float earthMaskOffset = 1.0;
    float neptuneMaskOffset = 3.0;

    vec3 spokePt = p;
    solarRot2D(-closestSpokeAngle, spokePt.yz, rotated);
    spokePt.yz = rotated;

    float angleModPI2 = mod(closestSpokeAngle, PI/2.0);
    bool isAxisAligned = angleModPI2 < 0.01 || angleModPI2 > (PI/2.0 - 0.01);

    float tri = abs(fract(time / 4.) * 2.0 - 1.0);
    float t = sin(tri * PI * 0.5);
    float rayLength = mix(0., 3.16, t);
    float rayThickness = mix(0., 0.004, t);
    float rays = sdCapsuleSolar(spokePt, rayThickness, rayLength);

    return rays;
}

float signetSolar(vec3 p) {
    p.y += 0.8;
    float r = referenceShapeSolar(p);
    float drill = drillHoleSolar(p);
    float dTop = ringTopSolar(p);
    float dBand = ringBandSolar(p);

    float smoothedBand = solarSmin(r, dBand, 7.3);
    float ring = solarSmin(dTop, smoothedBand, 0.32);
    float fullForm = max(ring, -drill);

    return fullForm;
}

//////////////////////////////////////////////////////////
// Main Solar System SDF
//////////////////////////////////////////////////////////
float solarSystemSdf(vec3 p, float time) {
    float tri = abs(fract(time / 4.) * 2.0 - 1.0);
    float t = sin(tri * PI * 0.5);

    vec2 rotated;
    solarRot2D(-PI / 2., p.yz, rotated);
    p.yz = rotated;

    float targetDate = mix(972347471., 942347471., t);

    vec3 transformedP = p;
    vec3 starP = transformedP;
    solarRot2D(PI / 1.875, starP.xz, rotated);
    starP.xz = rotated;
    float dStar = solarStarShape(starP, targetDate, time);

    solarRot2D(PI / 2.2, transformedP.xz, rotated);
    transformedP.xz = rotated;

    float dOuterPlanets = getOuterPlanetsDistance(transformedP, targetDate, time);
    float dMoonSphere = getMoonDistance(transformedP, targetDate, time);
    float dEarthSphere = getEarthDistance(transformedP, targetDate, time);
    float dSmallPlanets = getSmallPlanetsDistance(transformedP, targetDate, time);

    float dMerc = getPlanetOrbitPathDistance(transformedP, MERCURY, time);
    float dVenus = getPlanetOrbitPathDistance(transformedP, VENUS, time);
    float dEarth = getPlanetOrbitPathDistance(transformedP, EARTH, time);
    float dNept = getPlanetOrbitPathDistance(transformedP, NEPTUNE, time);
    float dStarOrbit = getStarOrbitPathDistance(transformedP);

    float dOthers = 1e10;
    for(int i = 3; i <= 6; i++) {
        float d = getPlanetOrbitPathDistance(transformedP, i, time);
        if (d < dOthers) {
            dOthers = d;
        }
    }

    float dSignet = signetSolar(p);
    float dBasinSphere = getBowlSphereDistance(p);

    solarRot2D(PI / 2., transformedP.xz, rotated);
    transformedP.xz = rotated;

    float garnish = 1e10;
    garnish = solarSmin(dStar, dStarOrbit, mix(0., 0.16, t));

    float garn = mix(0.4, 0., t);

    garnish = solarSmin(garnish, dMerc, garn);
    garnish = solarSmin(garnish, dVenus, garn);
    garnish = solarSmin(garnish, dEarth, garn);
    garnish = solarSmin(garnish, dNept, 0.2);
    garnish = solarSmin(garnish, dOthers, garn);

    float outers = directionalSminY(dOuterPlanets, garnish, .016, p);
    float small = directionalSminY(dSmallPlanets, garnish, .01, p);
    float earth = directionalSminY(dEarthSphere, garnish, .01, p);
    float moon = dMoonSphere;

    float planetsPlusGarnish = min(earth, min(outers, small));
    float finalDist = planetsPlusGarnish;
    finalDist = max(-moon, finalDist);

    return finalDist;
}
