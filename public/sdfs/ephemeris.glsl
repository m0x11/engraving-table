#define MAX_STEPS 100
#define MAX_DIST  100.0
#define SURF_DIST 0.001
#define PI 3.141592653589793
#define DEG_TO_RAD (PI / 180.0)
#define DEPTH 2.2

float smax(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
    return mix(b, a, h) + k * h * (1.0 - h);
}



float sdCappedCylinder(vec3 p, float r, float hh) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, hh);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sdCapsule(vec3 p, float r, float h) {
    float y = max(0.0, min(h, p.y));
    return length(vec3(p.x, p.y - y, p.z)) - r;
}

float sdTorusX(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.yz) - t.x, p.x);
    return length(q) - t.y;
}

float sdBox(vec3 p, vec3 s) {
    p = abs(p)-s;
	return length(max(p, 0.))+min(max(p.x, max(p.y, p.z)), 0.);
}

// Visual scale factors
#ifndef systemScale
    #define systemScale 1.32   // Overall scale factor
#endif

#ifndef trailScale
    #define trailScale 1.5  // Scale factor for trail thickness
#endif


// Planet ID (same indexing style as first version)
#define MERCURY 0
#define VENUS   1
#define EARTH   2
#define MARS    3
#define JUPITER 4
#define SATURN  5
#define URANUS  6
#define NEPTUNE 7


#define J2000_UNIX 946728000.0  // Unix timestamp for J2000
#define SECONDS_PER_DAY 86400.0

 
// Optionally enable or disable orbits (1=on, 0=off)
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
// Planetary Orbital Parameters (second version values)
//////////////////////////////////////////////////////////
// Semi-major axes (scaled for the "second" version)
float getSemiMajorAxis(int planetID) {
    if (planetID == MERCURY) return 0.33;   // Mercury (start)
    else if (planetID == VENUS)   return 0.60;  // (0.33 + 0.267)
    else if (planetID == EARTH)   return 0.87;  // (0.60 + 0.267)
    else if (planetID == MARS)    return 1.13;  // (0.87 + 0.267)
    else if (planetID == JUPITER) return 1.40;  // (1.13 + 0.267)
    else if (planetID == SATURN)  return 1.67;  // (1.40 + 0.267)
    else if (planetID == URANUS)  return 1.93;  // (1.67 + 0.267)
    else if (planetID == NEPTUNE) return 2.20;  // (1.93 + 0.267)
    return 0.0;
}

// For simplicity, keep all eccentricities = 0.0 (as in first version)
float getEccentricity(int planetID) {
    return 0.0;
}

// We'll also set inclinations to 0.0
float getInclination(int planetID) {
    return 0.0;
}

// Ascending nodes
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

// Arguments of perihelion
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

// Mean longitudes
float getMeanLongitude(int planetID) {
    if (planetID == MERCURY) return 252.25;    // Mercury position at J2000
    else if (planetID == VENUS)   return 181.98;
    else if (planetID == EARTH)   return 100.46;
    else if (planetID == MARS)    return 355.45;
    else if (planetID == JUPITER) return 34.40;
    else if (planetID == SATURN)  return 49.94;
    else if (planetID == URANUS)  return 313.23;
    else if (planetID == NEPTUNE) return 304.88;
    return 0.0;
}

// Orbital periods (days)
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
// Planet Radii (index == -1 for Sun). We scale them
// exactly as the second version did.
//////////////////////////////////////////////////////////
#define PLANET_SCALE 0.5

float getPlanetRadius(int index) {
    // -1 => Sun
    if (index == -1) {
        return 0.0; // star radius
    }
    // 0..7 => Mercury..Neptune
    if (index == 0) return 0.32; // Mercury
    else if (index == 1) return 0.32; // Venus
    else if (index == 2) return 0.32; // Earth
    else if (index == 3) return 0.32; // Mars
    else if (index == 4) return 0.32; // Jupiter
    else if (index == 5) return 0.32; // Saturn
    else if (index == 6) return 0.32; // Uranus
    else if (index == 7) return 0.32; // Neptune
    return 0.0;
}

//////////////////////////////////////////////////////////
// Trail thickness (similar to second version but no arrays)
//////////////////////////////////////////////////////////
float getTrailThickness(int planetID) {
    // Example from second version: Mercury=0.01, all else=0.04, etc.
    //if (planetID == EARTH)   return 0.;
    return 0.04;
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

const float MOON_ORBITAL_PERIOD = 27.321661;  // days
const float MOON_TRAIL_THICKNESS = 0.01;      // in second version

//////////////////////////////////////////////////////////
// PLANET ORBITS
//////////////////////////////////////////////////////////


float getPlanetAngle(float unixTime, int planetID) {
    // Temporarily return PI for all planets to line them up

    float daysFromJ2000 = (unixTime - J2000_UNIX) / SECONDS_PER_DAY;
    float period = getOrbitalPeriod(planetID);
    float meanMotion = 2.0 * PI / period;
    float angle = (meanMotion * daysFromJ2000) + 
                  (getMeanLongitude(planetID) * DEG_TO_RAD);
    return mod(angle, 2.0 * PI);
    
}

vec3 getPlanetPosition(float unixTime, int planetID) {
    float angle = getPlanetAngle(unixTime, planetID);
    float radius = getSemiMajorAxis(planetID) * systemScale;
    
    return vec3(
        -radius * cos(angle),  // Added negative sign here
        0.0,
        radius * sin(angle)
    );
}


//////////////////////////////////////////////////////////
// Bowl transform (sphere cutting/warping)
//////////////////////////////////////////////////////////

/*
#ifndef sphereRadius
    #define sphereRadius 11.
#endif

#ifndef sphereCenterY
    #define sphereCenterY 10.82
#endif
*/

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

mat2 Rot(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c);
}

//////////////////////////////////////////////////////////
// MOON ORBIT
//////////////////////////////////////////////////////////



float getMoonOrbitRadius() {
    float earthEffectiveRadius = getPlanetRadius(EARTH) * PLANET_SCALE;
    return earthEffectiveRadius - moonRadius;
}

vec3 getMoonPosition(float unixTime, vec3 earthPosOriginal) {
    earthPosOriginal.y += .0;
    float daysFromJ2000 = (unixTime - J2000_UNIX) / SECONDS_PER_DAY;
    const float MOON_PERIOD = 27.321661;
    float moonAngle = (2.0 * PI * daysFromJ2000) / MOON_PERIOD + PI;
    float offset = 0.;
    float orbitRadius = getMoonOrbitRadius() + offset; // 0.09
    
    // Apply bowl transformation to Earth’s position first
    vec3 earthPos = transformToBowl(earthPosOriginal);
    //earthPos.xz *= Rot(-PI / 2.); // Match mapScene transformation
    
    // Compute Moon’s offset in transformed space
    float moonX = -cos(moonAngle) * orbitRadius;
    float moonZ = sin(moonAngle) * orbitRadius;
    return earthPos + vec3(moonX, 0.0, moonZ);
}

float ellipsoidDist(vec3 p, vec3 center, float R, float scaleY)
{
    // Move into local space of the planet
    vec3 q = p - center;

    // Scale the y coordinate
    q.y /= scaleY;

    // The SDF for an ellipsoid of radius R (on X/Z) and R*scaleY (on Y):
    return length(q) - R;
}

float getPlanetDistance(vec3 p, int planetIndex, float unixTime, float scaleX, float scaleY) {
    vec3 planetPos = getPlanetPosition(unixTime, planetIndex);
    return ellipsoidDist(
        p,
        planetPos,
        getPlanetRadius(planetIndex)*PLANET_SCALE*scaleX,
        scaleY
    );
}

float getPlanetsDistance(vec3 p, float unixTime) {
    p.y += 0.025;
    // Distance to Sun at origin
    float minDist = length(p) - getPlanetRadius(-1);
    
    // Check distance to each planet
    for(int i = 0; i < 8; i++) {
        float planetDist = getPlanetDistance(p, i, unixTime, 1.0, 0.6);
        minDist = min(minDist, planetDist);
        
        // Add Moon if this is Earth
        if(i == EARTH) {
            vec3 moonPos = getMoonPosition(unixTime, getPlanetPosition(unixTime, i));
            vec3 moonP = p;
            moonP.y -= .0;
            float moonDist = length(moonP - moonPos) - moonRadius;
            
            // REMOVE MOON
            minDist = min(minDist, moonDist);
        }
    }
    
    return minDist;
}

float getOuterPlanetsDistance(vec3 p, float unixTime) {
     p.y += 0.025;
    // Distance to Sun at origin
    float minDist = length(p) - getPlanetRadius(-1);
    
    // Check distance to each planet
    for(int i = 4; i < 8; i++) {
        float planetDist = getPlanetDistance(p, i, unixTime, 1.0, 0.6);
        minDist = min(minDist, planetDist);
    }
    
    return minDist;
}


float getMoonDistance(vec3 p, float unixTime) {
 
    p.y += 0.07; // Consistent with Earth
     p.y *= DEPTH;
    vec3 earthPosOriginal = getPlanetPosition(unixTime, EARTH);
    vec3 moonPos = getMoonPosition(unixTime, earthPosOriginal);
    //float moonDist = length(p - moonPos) - moonRadius;
    float moonDist = sdCappedCylinder((p - moonPos), .11, .198);
    //float moonDist = length(p - moonPos) - .15;
    return moonDist;
}

float getSmallPlanetsDistance(vec3 p, float unixTime) {
     p.y += 0.025;
    // Distance to Sun at origin
    float minDist = length(p) - getPlanetRadius(-1);
    
    // Check distance to each planet
    for(int i = 0; i < 5; i++) {
        if (i == EARTH) continue;
        float planetDist = getPlanetDistance(p, i, unixTime, 1.0, 0.6);
        minDist = min(minDist, planetDist);
    }
    
    return minDist;
}

float getEarthDistance(vec3 p, float unixTime) {
    p.y += 0.025;
    // Distance to Sun at origin
    float minDist = length(p) - getPlanetRadius(-1);
    
    // Check distance to each planet

    float planetDist = getPlanetDistance(p, EARTH, unixTime, 1.0, 0.6);
    minDist = min(minDist, planetDist);
    
    return minDist;
}

//////////////////////////////////////////////////////////
// Orbit Path SDF (simple circular arcs, etc.)
//////////////////////////////////////////////////////////
float sdCircularOrbit(vec3 p, float radius, float thickness) {
    // Project onto XZ plane
    vec2 q = vec2(length(p.xz), p.y);
    return length(q - vec2(radius, 0.0)) - thickness;
}

float getPlanetOrbitPathDistance(vec3 p, int planetID) {
    //p.y += 0.025;
    p.y /= 1.32;
    float orbitRadius = getSemiMajorAxis(planetID) * systemScale;
    float thickness   = getTrailThickness(planetID) * trailScale; 
    return sdCircularOrbit(p, orbitRadius, thickness);
}

float getMoonOrbitPathDistance(vec3 p, float t) {
    vec3 earthPos = getPlanetPosition(t, EARTH);
    vec3 plocal = p - earthPos;
    float orbitRadius = getMoonOrbitRadius(); // instead of moonOrbitRadius
    float dist = length(vec2(length(plocal.xz) - orbitRadius, plocal.y));
    return dist;
}

float getStarOrbitPathDistance(vec3 p) {
    p.y += 0.02;
    float thickness = 0.0; // or any
    //float orbitRadius = 0.0; // starRadius from second version was 0.0
    float orbitRadius = 0.05;
    return length(p) - orbitRadius;
    //return sdCircularOrbit(p, orbitRadius * systemScale, thickness);
}

//////////////////////////////////////////////////////////
// Additional geometry (Ring, Signet, Star, Bowl)
//////////////////////////////////////////////////////////
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float sminRate(float a, float b, float k, float rate) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    
    // Apply rate control by adjusting the interpolation factor
    // When rate = 1.0, behavior matches the original smin
    // rate < 1.0: transition happens more abruptly
    // rate > 1.0: transition happens more gradually
    h = pow(h, rate);
    
    return mix(b, a, h) - k * h * (1.0 - h);
}

float directionalSminY(float d1, float d2, float k, vec3 p)
{
    float dSmooth = smin(d1, d2, k);
    float dHard   = min(d1, d2);

    // For instance, define a region in Y where smoothing is allowed:
    // Maybe if -0.5 < p.y < 0.5, we do smoothing, else clamp.
    if (p.y > -0.5 && p.y < 0.5) {
        return dSmooth;
    } else {
        return dHard;
    }
}


// Adjusted ring geometry

float referenceShape(vec3 p) {
    p.y += 0.5;
    return sdCappedCylinder(p, 1.2, 0.4);
}

float circularReference(vec3 p) {
    p.y -= 0.5;
    return sdCappedCylinder(p, 2.75, .5);
}

// planetMaskSDF: returns distance to a sphere (SDF) 
// whose center is at (0, R*cos(spokeAngle), R*sin(spokeAngle))
float planetMaskSDF(vec3 localPt, float spokeAngle, float planetOrbitRadius, float maskRadius)
{
    // The center of the sphere in yz-plane
    float cy = planetOrbitRadius * cos(spokeAngle);
    float cz = planetOrbitRadius * sin(spokeAngle);
    vec3 center = vec3(0.0, cy, cz);
    
    // Standard sphere SDF: length(pt - center) - radius
    return length(localPt - center) - maskRadius;
}



float starShape(vec3 p, float targetDate) 
{
    // --- Apply the same local transform to p ---
    p.xy *= Rot(PI / 2.0);
    p.yz *= Rot(PI / 2.0);
    p.x /= 1.64;    // Spoke angle in the *local yz-plane*
    float pointAngle = atan(p.z, p.y);
    
    float numSpokes = 8.0;
    float spokeSpacing = 2.0 * PI / numSpokes;
    float closestSpokeAngle = floor((pointAngle / spokeSpacing) + 0.5) * spokeSpacing;
    
    //-----------------------------------------------------------
    //     Transform Earth and Neptune to the same local yz-plane!
    //-----------------------------------------------------------
    // Earth positions
    vec3 earthPosWorld = getPlanetPosition(targetDate, EARTH);
    earthPosWorld.xy *= Rot(PI / 2.0);
    earthPosWorld.yz *= Rot(PI);
    float earthAngleLocal = atan(earthPosWorld.z, earthPosWorld.y);
    
    // Neptune positions
    vec3 neptunePosWorld = getPlanetPosition(targetDate, NEPTUNE);
    neptunePosWorld.xy *= Rot(PI / 2.0);
    neptunePosWorld.yz *= Rot(PI);
    float neptuneAngleLocal = atan(neptunePosWorld.z, neptunePosWorld.y);
    
    // Compare angles in the correct space
    float earthAngularDist = PI - abs(PI - abs(
        mod(closestSpokeAngle - earthAngleLocal, 2.0*PI)
    ));
    
    float neptuneAngularDist = PI - abs(PI - abs(
        mod(closestSpokeAngle - neptuneAngleLocal, 2.0*PI)
    ));
    
    // Configuration for masking spheres
    float maskingSphereRadius = 0.45;    // Radius of the masking spheres
    float earthMaskOffset = 1.0;        // Distance for Earth mask
    float neptuneMaskOffset = 3.0;      // Distance for Neptune mask
    
    vec3 spokePt = p;
    spokePt.yz *= Rot(-closestSpokeAngle);
    
    // Create the basic ray
    float rayLength = 3.16;
    //float rayThickness = 0.018;
    float rayThickness = 0.011;
    float rays = sdCapsule(spokePt, rayThickness, rayLength);
    
    // If we're near Earth, create a masking sphere
    
    // If we're near Neptune, create another masking sphere
    if (neptuneAngularDist < PI/24.) {
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

float bandPosY = 3.7;

float drillHole(vec3 p) {
    p.y += bandPosY;
    p.xy *= Rot(PI/2.);
    return sdCappedCylinder(p, 3.9, 5.0);
}


float shave(vec3 p) {
    p.x = abs(p.x);
    p.x -= 4.75;
    p.y += bandPosY;
    p.xy *= Rot(PI/2.);
    p.zy *= Rot(PI/2.);
    
    //float edge = sdBox(p, vec3(5.,5.,3.9));
    //float edge = sdBox(vec3(p.x+ 1.95, p.y, p.z ), vec3(5.,5.,3.9));
    
    float edge = sdBox(vec3(p.x- 3.9, p.y, p.z ), vec3(3.9,5.,3.9));
    
    return min(edge, sdCappedCylinder(vec3(p.x/1.11, p.y, p.z), 3.9, 5.0));
}

/*
float shave(vec3 p) {
    p.y -= 1.25;
    p.x = abs(p.x);
    p.x -= 4.75;
    p.y += bandPosY;
    p.xy *= Rot(PI/2.);
    p.zy *= Rot(PI/2.);
    
    float edge = sdBox(vec3(p.x- 3.9, p.y, p.z ), vec3(3.9,5.,3.9));
    
    return min(edge, sdCappedCylinder(vec3(p.x/.8, p.y, p.z), 3.9, 5.0));
}*/

float ringBand(vec3 p) {
    //p.y += bandPosY;
    p.x /= 2.;
    p.y += 3.7;
    //p.x /= 1.5;
    return sdTorusX(p, vec2(4.0, 0.48));
}


float signet(vec3 p) {
    p.y += 0.8;
    float r = referenceShape(p);
    float drill = drillHole(p);
    float dTop  = ringTop(p);
    float dBand = ringBand(p);
  
    float smoothedBand = smin(r, dBand, 7.3);
    //float smoothedBand = sminRate(r, dBand, 7.3, 1.);
    //float smoothedBand = smin(r, dBand, 4.3);
    float ring = smin(dTop, smoothedBand, 0.32);
    float fullForm = ring;
    
    fullForm = smax(fullForm, -(shave(p)), .64);
    //fullForm = min(fullForm, (shave(p)));
    
    fullForm = max(-drill, fullForm);
    //fullForm = min(fullForm, shave(p));
 
    return fullForm;
}


float fractus(vec2 p, vec2 v)
{
	vec2 z = p;
    vec2 c = v;
	float k = 1., h = 1.0;    
    for (float i=0.;i<100.;i++)
    {
        if (i>3.) break;
		h *= 4.*k;
		k = dot(z,z);
        if(k > 100.) break;
		z = vec2(z.x * z.x - z.y * z.y, 2. * z.x * z.y) + c;
    }
	return sqrt(k/h)*log(k);   
}

vec3 curveSpace(vec3 p) {
    float strength = -.13; 
    float dist = abs(p.y);
    float curveFactor = dist * dist * strength;
    p.z += curveFactor;
    return p;
}


float stamp(vec3 p) {
    float thickness = .11;
    // move into position
    p.y += 8.45;
    p.yz *= Rot(PI/2.);
    p = curveSpace(p);
 
    //scale
    p *= 1.4;
    
    float ftusMain = fractus(p.yx, vec2(-1., 0.0));
    p.z = abs(p.z);
    //float slice = smax(ftusMain, p.z - thickness, 0.02);
    float slice = max(ftusMain, p.z - thickness);
 
    return slice;
}

//////////////////////////////////////////////////////////
// Final Scene Distance
//////////////////////////////////////////////////////////

float mapScene(vec3 p) {
   
    float targetDate = 942347471.;

    // 1) Transform to bowl space
    vec3 transformedP = transformToBowl(p);
    transformedP.xz *= Rot(-PI / 2.);
    
     transformedP.y /= DEPTH;
    
    // 2) Distance to all planets (incl. Moon & Sun)
    //float dPlanets = getPlanetsDistance(transformedP, targetDate);
    float dOuterPlanets = getOuterPlanetsDistance(transformedP, targetDate);
    float dMoonSphere = getMoonDistance(transformedP, targetDate);
    float dEarthSphere = getEarthDistance(transformedP, targetDate);
    float dSmallPlanets = getSmallPlanetsDistance(transformedP, targetDate);
    
    // Some orbit arcs (Mercury, Earth, Neptune, plus the rest)
    float dMerc = getPlanetOrbitPathDistance(transformedP, MERCURY);
    float dVenus = getPlanetOrbitPathDistance(transformedP, VENUS);
    float dEarth = getPlanetOrbitPathDistance(transformedP, EARTH);
    float dNept = getPlanetOrbitPathDistance(transformedP, NEPTUNE);
    float dStarOrbit         = getStarOrbitPathDistance(transformedP);
    
    // Remaining orbits: (Mars=3, Jupiter=4, Saturn=5, Uranus=6)
    float dOthers = 1e10;
    for(int i = 3; i <= 6; i++) {
        float d = getPlanetOrbitPathDistance(transformedP, i);
        if (d < dOthers) {
            dOthers = d;
        }
    }
    
    // The signet ring geometry, plus bowl
    float dSignet = signet(p);
    float dBasinSphere = getBowlSphereDistance(p);
    float dRing = max(-dBasinSphere, dSignet);
    
    // Star shape in bowl space
   
    transformedP.xz *= Rot(PI / 2.);
    float dStar = starShape(transformedP, targetDate);
    

    float garnish = 1e10;
    //garnish = smin(dStar,   dStarOrbit,  0.16);
    garnish = smin(dStar,   dStarOrbit,  0.18);
    
    garnish       = smin(garnish, dMerc, 0.0);
    garnish       = smin(garnish, dVenus, 0.0);
    garnish       = smin(garnish, dEarth,  0.0);
    garnish       = smin(garnish, dNept,   0.2);
    garnish       = smin(garnish, dOthers, 0.0);



    float outers = directionalSminY(dOuterPlanets, garnish, .016, p);
    float small = directionalSminY(dSmallPlanets, garnish, .01, p);
    //float small = directionalSminY(dSmallPlanets, garnish, .01, p);
    float earth = directionalSminY(dEarthSphere, garnish, .01, p);
    //float moon = directionalSminY(dMoonSphere, garnish, .0, p);
    
    float moon = dMoonSphere;
    
    
    //float planetsPlusGarnish = min(moon, min(earth, min(outers, small)));
    
    float planetsPlusGarnish = min(earth, min(outers, small));
    
    float finalDist = smax(-planetsPlusGarnish, dRing, 0.0);
    
    
    
    finalDist = smin(moon, finalDist, 0.0);
    
    finalDist = smax(-dStar,finalDist,0.0);
    
    float stamp = stamp(p);
    
    finalDist = max(finalDist, -stamp);
   
    //finalDist = min(dStar, finalDist);
    
    //float finalDist = smin(dPlanets, max(-garnish, dRing), 0.016);
    //float finalDist = smax(-dPlanets, max(-garnish, dRing), 0.);
    
    //float finalDist = smin(dPlanets, smin(garnish, dRing, 0.01), 0.01);
    
    return finalDist;
}


// Surface extraction
float mapDistance(vec3 p) {
    return mapScene(p);
}
