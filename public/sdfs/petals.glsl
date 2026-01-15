//////////////////////////////////////////////////////////
// Petals SDF - Decorative dial with diamond torus rings
// Uses time parameter for animation
//////////////////////////////////////////////////////////

#define PETALS_DEPTH 2.2

float petalsSmin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float petalsSmax(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
    return mix(b, a, h) + k * h * (1.0 - h);
}

mat2 petalsRot(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c);
}

float petalssdSphere(vec3 p, float r) {
    return length(p) - r;
}

float petalssdCappedCylinder(vec3 p, float r, float hh) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, hh);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float petalssdCapsule(vec3 p, float r, float h) {
    float y = max(0.0, min(h, p.y));
    return length(vec3(p.x, p.y - y, p.z)) - r;
}

float petalssdTorusX(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.yz) - t.x, p.x);
    return length(q) - t.y;
}

float petalssdDiamondTorus(vec3 p, float R, float r) {
    vec2 xz = vec2(length(p.xz), p.y);
    vec2 q = vec2(xz.x - R, xz.y);

    // Rotate by 45 degrees
    float angle = PI / 4.0;
    float c = cos(angle);
    float s = sin(angle);
    q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);

    vec2 d = abs(q) - vec2(r);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float petalssdBox(vec3 p, vec3 s) {
    p.xz *= petalsRot(PI / 4.);
    p = abs(p) - s;
    return length(max(p, 0.)) + min(max(p.x, max(p.y, p.z)), 0.);
}

float petalsPetals(vec3 p, float time) {
    float tri = abs(fract(time / 4.) * 2.0 - 1.0);
    float t = sin(tri * PI * 0.5);
    t = 1.0;

    float rayLength = 1.3;
    float rayThickness = 0.00;
    float pointAngle = atan(p.z, p.y);

    float numSpokes = 8.0;
    float spokeSpacing = 2.0 * PI / numSpokes;

    float spokeIndex = round(pointAngle / spokeSpacing);
    float closestSpokeAngle = spokeIndex * spokeSpacing;

    float size = .55;
    float give = .44;
    vec3 pos = vec3(0.0, 2., 0.0);

    float rL = mix(0., 2.9, t);
    float a = abs(closestSpokeAngle);
    if (a == 0. || a == PI) {
        pos = vec3(0.0, 2., 0.0);
        rayLength = rL;
    }

    if (a == PI / 2.) {
        pos = vec3(0.0, 1., 0.0);
        rL = mix(0., 2.3, t);
        rayLength = rL;
    }

    if (a == PI / 4. || a == 3. * PI / 4.) {
        pos = vec3(0., 2., 0.);
        rayLength = rL;
    }

    vec3 spokePt0 = p;
    spokePt0.yz *= petalsRot(-closestSpokeAngle);
    float rays0 = petalssdBox(spokePt0, vec3(rayThickness, rayLength, rayThickness));
    vec3 torusPos0 = spokePt0 - pos;
    torusPos0.xy *= petalsRot(PI / 2.);
    float torHair = mix(-0.011, 0.03, t);
    float torus0 = petalssdDiamondTorus(torusPos0, size, torHair);
    float spoke0 = petalsSmin(rays0, torus0, give);

    // Evaluate previous spoke
    vec3 spokePt1 = p;
    spokePt1.yz *= petalsRot(-(closestSpokeAngle - spokeSpacing));
    float rays1 = petalssdBox(spokePt1, vec3(rayThickness, rayLength, rayThickness));
    vec3 torusPos1 = spokePt1 - pos;
    torusPos1.xy *= petalsRot(PI / 2.);
    float torus1 = petalssdDiamondTorus(torusPos1, size, torHair);
    float spoke1 = petalsSmin(rays1, torus1, give);

    // Evaluate next spoke
    vec3 spokePt2 = p;
    spokePt2.yz *= petalsRot(-(closestSpokeAngle + spokeSpacing));
    float rays2 = petalssdBox(spokePt2, vec3(rayThickness, rayLength, rayThickness));
    vec3 torusPos2 = spokePt2 - pos;
    torusPos2.xy *= petalsRot(PI / 2.);
    float torus2 = petalssdDiamondTorus(torusPos2, size, torHair);
    float spoke2 = petalsSmin(rays2, torus2, give);

    // Combine all three with smooth min
    float result = petalsSmin(spoke0, spoke1, 0.0);
    result = petalsSmin(result, spoke2, 0.0);

    return result;
}

float petalsDial(vec3 p, float dialSeed) {
    p.xy *= petalsRot(PI / 2.);

    float minDist = 1e10;

    // rings2 inlined: Ring(30.5, 0.11), Ring(2., -0.01)
    float dist0 = petalssdDiamondTorus(p, 30.5, 0.11);
    float dist1 = petalssdDiamondTorus(p, 2., -0.01);

    minDist = min(minDist, dist0);
    minDist = min(minDist, dist1);

    return minDist;
}

float petalsOval(vec3 p, float dialSeed) {
    p.xy *= petalsRot(PI / 2.);
    p.z *= 1.5;

    float minDist = 1e10;

    // rings inlined: Ring(2.22, 0.0)
    float dist0 = petalssdDiamondTorus(p, 2.22, 0.0);
    minDist = min(minDist, dist0);

    return minDist;
}

float petalsSun(vec3 p) {
    return length(p) + 1.;
}

float petalsForm(vec3 p, float seed, float time) {
    float dialDist = petalsDial(p, 1.0);
    float starDist = petalsPetals(p, time);

    float tri = abs(fract(time / 4.) * 2.0 - 1.0);
    float t = sin(tri * PI * 0.5);
    t = 1.0;

    float mixx = mix(-0.011, 0.33, t);

    float form = petalsSmin(dialDist, starDist, mixx);

    // without center - carve out center sphere
    return petalsSmax(form, -(length(p) - .4), 1.);
}

//////////////////////////////////////////////////////////
// Main Petals SDF
//////////////////////////////////////////////////////////
float petalsSdf(vec3 p, float time) {
    float seed = 1.0;
    p.yz *= petalsRot(PI / 2.0);
    p.xy *= petalsRot(PI / 2.0);
    return petalsForm(p, seed, time);
}
