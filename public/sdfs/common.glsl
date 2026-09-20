//////////////////////////////////////////////////////////
// Common SDF Utilities
// Shared primitives, smooth operators, and transforms
//////////////////////////////////////////////////////////

#define PI 3.141592653589793

//////////////////////////////////////////////////////////
// Smooth Boolean Operators
//////////////////////////////////////////////////////////

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float smax(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
    return mix(b, a, h) + k * h * (1.0 - h);
}

//////////////////////////////////////////////////////////
// Rotation
//////////////////////////////////////////////////////////

mat2 Rot(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c);
}

//////////////////////////////////////////////////////////
// Basic SDF Primitives
//////////////////////////////////////////////////////////

float sdSphere(vec3 p, float r) {
    return length(p) - r;
}

float sdBox(vec3 p, vec3 s) {
    p = abs(p) - s;
    return length(max(p, 0.0)) + min(max(p.x, max(p.y, p.z)), 0.0);
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

float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

float sdDiamondTorus(vec3 p, float R, float r) {
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

// Box with 45-degree rotation on XZ plane (for diamond shapes)
float sdBoxDiamond(vec3 p, vec3 s) {
    p.xz *= Rot(PI / 4.0);
    p = abs(p) - s;
    return length(max(p, 0.0)) + min(max(p.x, max(p.y, p.z)), 0.0);
}

