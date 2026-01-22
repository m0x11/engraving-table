//////////////////////////////////////////////////////////
// Petals SDF - Decorative dial with diamond torus rings
// Uses time parameter for animation
// Requires: common.glsl to be loaded first
//////////////////////////////////////////////////////////

#define PETALS_DEPTH 2.2

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
    spokePt0.yz *= Rot(-closestSpokeAngle);
    float rays0 = sdBoxDiamond(spokePt0, vec3(rayThickness, rayLength, rayThickness));
    vec3 torusPos0 = spokePt0 - pos;
    torusPos0.xy *= Rot(PI / 2.);
    float torHair = mix(-0.011, 0.03, t);
    float torus0 = sdDiamondTorus(torusPos0, size, torHair);
    float spoke0 = smin(rays0, torus0, give);

    // Evaluate previous spoke
    vec3 spokePt1 = p;
    spokePt1.yz *= Rot(-(closestSpokeAngle - spokeSpacing));
    float rays1 = sdBoxDiamond(spokePt1, vec3(rayThickness, rayLength, rayThickness));
    vec3 torusPos1 = spokePt1 - pos;
    torusPos1.xy *= Rot(PI / 2.);
    float torus1 = sdDiamondTorus(torusPos1, size, torHair);
    float spoke1 = smin(rays1, torus1, give);

    // Evaluate next spoke
    vec3 spokePt2 = p;
    spokePt2.yz *= Rot(-(closestSpokeAngle + spokeSpacing));
    float rays2 = sdBoxDiamond(spokePt2, vec3(rayThickness, rayLength, rayThickness));
    vec3 torusPos2 = spokePt2 - pos;
    torusPos2.xy *= Rot(PI / 2.);
    float torus2 = sdDiamondTorus(torusPos2, size, torHair);
    float spoke2 = smin(rays2, torus2, give);

    // Combine all three with smooth min
    float result = smin(spoke0, spoke1, 0.0);
    result = smin(result, spoke2, 0.0);

    return result;
}

float petalsDial(vec3 p, float dialSeed) {
    p.xy *= Rot(PI / 2.);

    float minDist = 1e10;

    // rings2 inlined: Ring(30.5, 0.11), Ring(2., -0.01)
    float dist0 = sdDiamondTorus(p, 30.5, 0.11);
    float dist1 = sdDiamondTorus(p, 2., -0.01);

    minDist = min(minDist, dist0);
    minDist = min(minDist, dist1);

    return minDist;
}

float petalsOval(vec3 p, float dialSeed) {
    p.xy *= Rot(PI / 2.);
    p.z *= 1.5;

    float minDist = 1e10;

    // rings inlined: Ring(2.22, 0.0)
    float dist0 = sdDiamondTorus(p, 2.22, 0.0);
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

    float form = smin(dialDist, starDist, mixx);

    // without center - carve out center sphere
    return smax(form, -(length(p) - .4), 1.);
}

//////////////////////////////////////////////////////////
// Main Petals SDF
//////////////////////////////////////////////////////////
float petalsSdf(vec3 p, float time) {
    float seed = 1.0;
    p.yz *= Rot(PI / 2.0);
    p.xy *= Rot(PI / 2.0);
    return petalsForm(p, seed, time);
}


float vineSdf(vec3 p, float time) {
    p.yz *= Rot(PI / 2.0);
    p.xy *= Rot(PI / 2.0);
    return petalsForm(p, 1.0, time);
}


float petalsStarShape(vec3 p, float targetDate)
{
    float result = 1e10;

    float spokeAngles[8];
    spokeAngles[0] = 0.0;
    spokeAngles[1] = PI / 4.0 / 1.11;
    spokeAngles[2] = PI / 2.0;
    spokeAngles[3] = 3.0 * PI / 4.0 * 1.033;
    spokeAngles[4] = PI;
    spokeAngles[5] = -3.0 * PI / 4.0 * 1.033;
    spokeAngles[6] = -PI / 2.0;
    spokeAngles[7] = -PI / 4.0 / 1.11;

    for (int i = 0; i < 8; i++) {
        float angle = spokeAngles[i];

        float rayLength = 1.3;
        float rayThickness = 0.022;
        vec3 torusPos = vec3(0.0, 2.0, 0.0);
        float torusSize = 0.5;
        float blendAmount = 0.5;

        if (i == 0 || i == 4) {
            torusPos.y = 1.85;
            rayLength = 3.9;
        }
        else if (i == 2 || i == 6) {
            torusPos.y = 1.22;
            rayLength = 2.64;
        }
        else {
            torusPos.y = 1.5;
            rayLength = 3.18;
        }

        vec3 spokePt = p;
        spokePt.yz *= Rot(-angle);

        // ONE-SIDED RAY: offset box so it only extends in +Y direction
        vec3 rayPt = spokePt;
        rayPt.y -= rayLength * 0.5;  // shift box center up
        float ray = sdBox(rayPt, vec3(rayThickness, rayLength * 0.5, rayThickness));

        // Adjust torus position to match (it's now relative to the one-sided ray)
        vec3 tPt = spokePt - torusPos;
        tPt.xy *= Rot(PI / 2.0);
        float torus = sdDiamondTorus(tPt, torusSize, 0.02);

        float spoke = smin(ray, torus, blendAmount);
        result = min(result, spoke);
    }

    return result;
}

struct Ring {
    float radius;
    float thickness;
};

Ring rings[1] = Ring[1](
    Ring(3.55, 0.044)
);

Ring rings2[2] = Ring[2](
    Ring(1.5, 0.11),
    Ring(2., -0.01)
);

float dial(vec3 p, float dialSeed) {
    p.xy *= Rot(PI/2.);

    float minDist = 1e10;

    for (int i = 0; i < 3; i++) {
        float dist = sdDiamondTorus(p, rings2[i].radius, rings2[i].thickness);
        minDist = min(minDist, dist);
    }

    return minDist;
}

float oval(vec3 p, float dialSeed) {
    p.xy *= Rot(PI/2.);
    p.z *= 1.5;

    float minDist = 1e10;

    for (int i = 0; i < 3; i++) {
        float dist = sdDiamondTorus(p, rings[i].radius, rings[i].thickness);
        minDist = min(minDist, dist);
    }

    return minDist;
}


float sun (vec3 p) {
    return length(p) + 1.;
}

float Form (vec3 p, float seed) {
        p.yz *= Rot(PI / 2.0);
    p.xy *= Rot(PI / 2.0);
    float oval = oval(p, 1.0);
    float dial = dial(p, 1.0);

    float star = petalsStarShape(p, 1.0);
    float form = smin(oval, star, 0.3);
    return smin(form, sun(p), 1.8);
}
