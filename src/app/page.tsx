"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";

const ATLAS_SIZE = 344;

type GlyphData = {
  unicode: number;
  advance: number;
  planeBounds?: { left: number; bottom: number; right: number; top: number };
  atlasBounds?: { left: number; bottom: number; right: number; top: number };
};

type FontData = {
  atlas: { width: number; height: number };
  glyphs: GlyphData[];
};

type LightingMode = "pbr" | "simple";

type PBRParams = {
  numReflections: number;
  light1Color: [number, number, number];
  light1Intensity: number;
  light2Color: [number, number, number];
  light2Intensity: number;
  ambientIntensity: number;
  metallic: number;
  roughness: number;
};

type SimpleParams = {
  lightDir: [number, number, number];
  diffuseStrength: number;
};

// Parse mm-dd-yyyy to Unix timestamp
function parseDateToUnix(dateStr: string): number | null {
  const match = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) return null;

  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Create date at noon UTC to avoid timezone issues
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (isNaN(date.getTime())) return null;

  return Math.floor(date.getTime() / 1000);
}

// Convert date string to display text with middle dots (MM·DD·YYYY)
function dateToDisplayText(dateStr: string): string {
  const match = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) return "";

  const month = match[1].padStart(2, "0");
  const day = match[2].padStart(2, "0");
  const year = match[3];

  return `${month}·${day}·${year}`;
}

export default function Home() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dateInput, setDateInput] = useState("03-23-1999");
  const [lightingMode, setLightingMode] = useState<LightingMode>("pbr");
  const [pbrParams, setPbrParams] = useState<PBRParams>({
    numReflections: 1,
    light1Color: [1.0, 1.0, 1.0],
    light1Intensity: 20.0,
    light2Color: [1.0, 1.0, 1.0],
    light2Intensity: 4.5,
    ambientIntensity: 0.0,
    metallic: 1.0,
    roughness: 0.47,
  });
  const [simpleParams, setSimpleParams] = useState<SimpleParams>({
    lightDir: [1.0, 2.0, 3.0],
    diffuseStrength: 1.0,
  });
  const [fps, setFps] = useState(0);
  const fpsRef = useRef({ frames: 0, lastTime: performance.now() });

  // Compute derived values
  const unixTimestamp = parseDateToUnix(dateInput);
  const displayText = dateToDisplayText(dateInput);
  const isValidDate = unixTimestamp !== null;

  // Ref to store the material for uniform updates
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  // Update uniforms without recompiling shader
  useEffect(() => {
    if (!materialRef.current) return;
    const m = materialRef.current;

    m.uniforms.uLightingMode.value = lightingMode === "pbr" ? 0 : 1;
    m.uniforms.uLight1Color.value.set(...pbrParams.light1Color);
    m.uniforms.uLight1Intensity.value = pbrParams.light1Intensity;
    m.uniforms.uLight2Color.value.set(...pbrParams.light2Color);
    m.uniforms.uLight2Intensity.value = pbrParams.light2Intensity;
    m.uniforms.uAmbientIntensity.value = pbrParams.ambientIntensity;
    m.uniforms.uMetallic.value = pbrParams.metallic;
    m.uniforms.uRoughness.value = pbrParams.roughness;
    m.uniforms.uLightDir.value.set(...simpleParams.lightDir);
    m.uniforms.uDiffuseStrength.value = simpleParams.diffuseStrength;
  }, [lightingMode, pbrParams, simpleParams]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!isValidDate) return;

    const container = containerRef.current;
    let animationId: number;

    // Load font data and ephemeris SDF
    Promise.all([
      fetch("/fonts/PPRightSerifMono-msdf.json").then((res) => res.json()),
      fetch("/sdfs/ephemeris.glsl").then((res) => res.text()),
    ]).then(([fontData, ephemerisGlsl]: [FontData, string]) => {
      // Process ephemeris GLSL - rename functions and remove conflicting defines
      const processedEphemeris = ephemerisGlsl
        .replace(/mapDistance/g, "ephemerisSdf")
        .replace(/mapScene/g, "ephemerisScene")
        // Remove targetDate hardcoding - we'll inject it as uniform
        .replace(/float targetDate = [^;]+;/g, "// targetDate injected as uniform")
        // Remove conflicting raymarching constants (we define our own)
        .replace(/#define MAX_STEPS \d+/g, "// MAX_STEPS defined above")
        .replace(/#define MAX_DIST[^\n]*/g, "// MAX_DIST defined above")
        .replace(/#define SURF_DIST[^\n]*/g, "// SURF_DIST defined above");

      // Build glyph lookup by character
      const glyphMap = new Map<string, GlyphData>();
      for (const glyph of fontData.glyphs) {
        const char = String.fromCharCode(glyph.unicode);
        glyphMap.set(char, glyph);
      }

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      container.appendChild(renderer.domElement);

      // Load MSDF texture
      const textureLoader = new THREE.TextureLoader();
      const msdfTexture = textureLoader.load(
        "/fonts/PPRightSerifMono-msdf.png"
      );
      msdfTexture.minFilter = THREE.LinearFilter;
      msdfTexture.magFilter = THREE.LinearFilter;
      msdfTexture.flipY = true;

      // Build glyph uniform data for the text
      const glyphUniforms: { uv: THREE.Vector4; plane: THREE.Vector4 }[] = [];
      const validChars: string[] = [];

      for (const char of displayText) {
        // Handle middle dot "·" by using period with vertical offset
        const lookupChar = char === "·" ? "." : char;
        const glyph = glyphMap.get(lookupChar);

        if (glyph && glyph.atlasBounds && glyph.planeBounds) {
          const uMin = glyph.atlasBounds.left / ATLAS_SIZE;
          const uMax = glyph.atlasBounds.right / ATLAS_SIZE;
          const vMin = glyph.atlasBounds.bottom / ATLAS_SIZE;
          const vMax = glyph.atlasBounds.top / ATLAS_SIZE;

          // Calculate vertical offset for middle dot
          let verticalOffset = 0;
          if (char === "·") {
            const periodCenter =
              (glyph.planeBounds.bottom + glyph.planeBounds.top) / 2;
            const targetCenter = 0.34;
            verticalOffset = targetCenter - periodCenter;
          }

          glyphUniforms.push({
            uv: new THREE.Vector4(uMin, vMin, uMax, vMax),
            plane: new THREE.Vector4(
              glyph.planeBounds.left,
              glyph.planeBounds.bottom + verticalOffset,
              glyph.planeBounds.right,
              glyph.planeBounds.top + verticalOffset
            ),
          });
          validChars.push(char);
        }
      }

      const numGlyphs = glyphUniforms.length;
      const hasText = numGlyphs > 0;

      const vertexShader = `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `;

      // Build the getGlyph function dynamically
      let getGlyphCode = "";
      if (hasText) {
        for (let i = 0; i < numGlyphs; i++) {
          if (i === 0) {
            getGlyphCode += `if (idx == 0) { plane = uGlyphPlane[0]; uv = uGlyphUV[0]; }\n`;
          } else {
            getGlyphCode += `        else if (idx == ${i}) { plane = uGlyphPlane[${i}]; uv = uGlyphUV[${i}]; }\n`;
          }
        }
      }

      // Build the textSdf2D function dynamically
      let textSdfCode = "";
      if (hasText) {
        for (let i = 0; i < numGlyphs; i++) {
          textSdfCode += `        d = min(d, glyphSdf2D(p - vec2(xStart + ${i.toFixed(1)} * advance, 0.0), ${i}));\n`;
        }
      }

      const fragmentShader = `
        precision highp float;

        uniform vec2 uResolution;
        uniform float uTime;
        uniform sampler2D uMsdfTexture;
        uniform vec3 uRotation;
        uniform float uZoom;
        uniform float uTargetDate;
        uniform int uLightingMode; // 0 = PBR, 1 = Simple

        // PBR params
        uniform vec3 uLight1Color;
        uniform float uLight1Intensity;
        uniform vec3 uLight2Color;
        uniform float uLight2Intensity;
        uniform float uAmbientIntensity;
        uniform float uMetallic;
        uniform float uRoughness;

        // Simple params
        uniform vec3 uLightDir;
        uniform float uDiffuseStrength;

        ${hasText ? `uniform vec4 uGlyphUV[${numGlyphs}];` : ""}
        ${hasText ? `uniform vec4 uGlyphPlane[${numGlyphs}];` : ""}

        const float TEXT_DEPTH = 0.15;
        const float PX_RANGE = 8.0;
        const float GLYPH_SIZE = 48.0;
        const int MAX_STEPS = 128;
        const float MAX_DIST = 40.0;
        const float SURF_DIST = 0.001;
        const float SURF_HIT = 0.01;

        // Inject targetDate for ephemeris calculations
        float targetDate;

        // ========== EPHEMERIS SDF ==========
        ${processedEphemeris}
        // ========== END EPHEMERIS SDF ==========

        // ========== PBR UTILITIES ==========
        #define S(x, y, z) smoothstep(x, y, z)

        float saturatef(float x) { return clamp(x, 0.0, 1.0); }
        vec3 saturate3(vec3 x) { return clamp(x, vec3(0.0), vec3(1.0)); }
        vec4 saturate4(vec4 x) { return clamp(x, vec4(0.0), vec4(1.0)); }

        mat2 rot2D(float angle) {
            float ca = cos(angle), sa = sin(angle);
            return mat2(ca, -sa, sa, ca);
        }

        mat3 lookAtMatrix(in vec3 lookAtDirection) {
            vec3 ww = normalize(lookAtDirection);
            vec3 uu = cross(ww, vec3(0.0, 1.0, 0.0));
            vec3 vv = cross(uu, ww);
            return mat3(uu, vv, -ww);
        }

        vec4 linearTosRGB(vec4 linearRGB) {
            bvec4 cutoff = lessThan(linearRGB, vec4(0.0031308));
            vec4 higher = vec4(1.055)*pow(linearRGB, vec4(1.0/2.4)) - vec4(0.055);
            vec4 lower = linearRGB * vec4(12.92);
            return mix(higher, lower, cutoff);
        }

        vec4 sRGBToLinear(vec4 sRGB) {
            bvec4 cutoff = lessThan(sRGB, vec4(0.04045));
            vec4 higher = pow((sRGB + vec4(0.055))/vec4(1.055), vec4(2.4));
            vec4 lower = sRGB/vec4(12.92);
            return mix(higher, lower, cutoff);
        }

        vec4 ACESFilm(vec4 x) {
            float a = 2.51;
            float b = 0.03;
            float c = 2.43;
            float d = 0.59;
            float e = 0.14;
            return saturate4((x*(a*x+b))/(x*(c*x+d)+e));
        }

        // PBR Functions
        vec3 F_Schlick(float HoV, vec3 f0) {
            return f0 + (vec3(1.0) - f0) * pow(1.0 - HoV, 5.0);
        }

        float D_GGX(float NoH, float a) {
            float a2 = a * a;
            float f = (NoH * a2 - NoH) * NoH + 1.0;
            return a2 / (PI * f * f);
        }

        float V_SmithGGXCorrelated(float NoV, float NoL, float a) {
            float a2 = a * a;
            float NoV2 = NoV*NoV;
            float NoL2 = NoL*NoL;
            float GGL = NoL * sqrt(NoV2 * (1.0 - a2) + a2);
            float GGV = NoV * sqrt(NoL2 * (1.0 - a2) + a2);
            return 0.5 / (GGL + GGV + 0.0001);
        }

        vec3 BRDF_Light(vec3 N, vec3 V, vec3 L, vec3 lightColor, vec3 albedo, float roughness, float metallic) {
            vec3 H = normalize(V + L);

            float NoV = max(dot(N, V), 0.001);
            float NoL = max(dot(N, L), 0.0);
            float NoH = max(dot(N, H), 0.0);
            float HoV = max(dot(H, V), 0.0);

            float a = roughness * roughness;

            vec3 dielectricSpecular = vec3(0.04);
            vec3 F0 = mix(dielectricSpecular, albedo, metallic);
            vec3 F = F_Schlick(HoV, F0);

            float D = D_GGX(NoH, a);
            float Vis = V_SmithGGXCorrelated(NoV, NoL, a);

            vec3 specular = F * (Vis * D);

            vec3 kD = vec3(1.0) - F;
            vec3 c = mix(albedo * (1.0 - dielectricSpecular.r), vec3(0.0), metallic);
            vec3 diffuse = kD * (c / PI);

            return lightColor * NoL * (diffuse + specular);
        }
        // ========== END PBR UTILITIES ==========

        mat3 rotateX(float a) {
          float s = sin(a), c = cos(a);
          return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
        }

        mat3 rotateY(float a) {
          float s = sin(a), c = cos(a);
          return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
        }

        float median(vec3 v) {
          return max(min(v.r, v.g), min(max(v.r, v.g), v.b));
        }

        float sampleMsdf(vec2 localUV, vec4 uvBounds) {
          vec2 atlasUV = vec2(
            mix(uvBounds.x, uvBounds.z, localUV.x),
            mix(uvBounds.y, uvBounds.w, localUV.y)
          );

          vec3 msdf = texture2D(uMsdfTexture, atlasUV).rgb;
          float sd = median(msdf);

          float pxDist = PX_RANGE * (0.5 - sd);
          return pxDist / GLYPH_SIZE;
        }

        void getGlyph(int idx, out vec4 plane, out vec4 uv) {
          plane = vec4(0.0);
          uv = vec4(0.0);
          ${getGlyphCode}
        }

        float glyphSdf2D(vec2 p, int idx) {
          vec4 plane, uv;
          getGlyph(idx, plane, uv);

          vec2 planeMin = plane.xy;
          vec2 planeMax = plane.zw;
          vec2 planeSize = planeMax - planeMin;

          vec2 localUV = (p - planeMin) / planeSize;

          if (localUV.x < -0.1 || localUV.x > 1.1 || localUV.y < -0.1 || localUV.y > 1.1) {
            vec2 center = (planeMin + planeMax) * 0.5;
            vec2 halfSize = planeSize * 0.5;
            vec2 d = abs(p - center) - halfSize;
            return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
          }

          vec2 sampleUV = clamp(localUV, 0.0, 1.0);
          return sampleMsdf(sampleUV, uv);
        }

        float textSdf2D(vec2 p) {
          float d = 1000.0;
          float advance = 0.52;
          // Center text: place midpoint between first and last glyph at x=0
          // Additional offset to compensate for visual centering (dots are narrower than digits)
          float xStart = -float(${numGlyphs - 1}) * advance * 0.5 - 0.26;

          ${textSdfCode}

          return d;
        }

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

          // Map to text coordinates
          float textScale = 1.5;
          float textX = -angle * cylinderRadius / textScale;
          float textY = -h / textScale + 0.34;  // negative h flips for viewer, +0.34 centers

          // Sample 2D text SDF
          float d2d = textSdf2D(vec2(textX, textY));

          // Extrude radially inward from cylinder surface
          float textDepth = 0.15;  // How deep to engrave
          float surfaceDist = cylinderRadius - r;  // Distance from inner surface

          // Combine 2D text with radial extrusion
          vec2 w = vec2(d2d, abs(surfaceDist) - textDepth);
          return min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
        }

        float sceneSdf(vec3 p) {
          float dEphemeris = ephemerisSdf(p);

          ${hasText ? `
          float dText = textOnInnerCylinder(p);
          return max(dEphemeris, -dText);
          ` : `
          return dEphemeris;
          `}
        }

        vec3 calcNormal(vec3 p) {
          vec2 e = vec2(0.002, 0.0);
          return normalize(vec3(
            sceneSdf(p + e.xyy) - sceneSdf(p - e.xyy),
            sceneSdf(p + e.yxy) - sceneSdf(p - e.yxy),
            sceneSdf(p + e.yyx) - sceneSdf(p - e.yyx)
          ));
        }

        float rayMarch(vec3 ro, vec3 rd) {
          float t = 0.0;
          for (int i = 0; i < MAX_STEPS; i++) {
            vec3 p = ro + rd * t;
            float d = sceneSdf(p);
            if (d < SURF_HIT) return t;
            if (t > MAX_DIST) break;
            t += d;
          }
          return -1.0;
        }

        // Simple lighting function
        vec3 simpleLighting(vec3 p, vec3 n, vec3 rd) {
          vec3 lightDir = normalize(uLightDir);
          float dif = dot(n, lightDir) * 0.5 + 0.5;
          return vec3(dif * uDiffuseStrength);
        }

        // PBR lighting function
        vec3 pbrLighting(vec3 p, vec3 n, vec3 rd) {
          vec3 V = -rd;
          vec3 albedo = vec3(0.1);

          // Two lights
          vec3 L1 = normalize(vec3(1.0, 1.0, 0.0));
          vec3 L2 = normalize(vec3(-1.0, 1.0, 0.0));

          vec3 light1 = uLight1Color * uLight1Intensity;
          vec3 light2 = uLight2Color * uLight2Intensity;
          vec3 ambient = vec3(uAmbientIntensity) * albedo;

          vec3 color = ambient;
          color += BRDF_Light(n, V, L1, light1, albedo, uRoughness, uMetallic);
          color += BRDF_Light(n, V, L2, light2, albedo, uRoughness, uMetallic);

          return color;
        }

        void main() {
          // Set targetDate from uniform
          targetDate = uTargetDate;

          vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

          // Camera setup - use orbit camera style for PBR mode
          float cameraHeight = 0.0;
          float camDist = 6.0 / uZoom;

          mat3 rot = rotateY(uRotation.y) * rotateX(uRotation.x);
          vec3 ro = rot * vec3(0.0, 0.0, camDist);
          vec3 rd = rot * normalize(vec3(uv, -1.0));

          vec3 col = vec3(0.0);

          float t = rayMarch(ro, rd);

          if (t > 0.0) {
            vec3 p = ro + rd * t;
            vec3 n = calcNormal(p);

            if (uLightingMode == 0) {
              // PBR Mode
              col = pbrLighting(p, n, rd);
              col = ACESFilm(vec4(col, 1.0)).rgb;
              col = linearTosRGB(vec4(col, 1.0)).rgb;
            } else {
              // Simple Mode
              col = simpleLighting(p, n, rd);
            }
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `;

      const uniforms: Record<string, { value: unknown }> = {
        uResolution: {
          value: new THREE.Vector2(window.innerWidth, window.innerHeight),
        },
        uTime: { value: 0 },
        uMsdfTexture: { value: msdfTexture },
        uRotation: { value: new THREE.Vector3(0.3, 0.5, 0) },
        uZoom: { value: 1.0 },
        uTargetDate: { value: unixTimestamp },
        uLightingMode: { value: lightingMode === "pbr" ? 0 : 1 },
        // PBR params
        uLight1Color: { value: new THREE.Vector3(...pbrParams.light1Color) },
        uLight1Intensity: { value: pbrParams.light1Intensity },
        uLight2Color: { value: new THREE.Vector3(...pbrParams.light2Color) },
        uLight2Intensity: { value: pbrParams.light2Intensity },
        uAmbientIntensity: { value: pbrParams.ambientIntensity },
        uMetallic: { value: pbrParams.metallic },
        uRoughness: { value: pbrParams.roughness },
        // Simple params
        uLightDir: { value: new THREE.Vector3(...simpleParams.lightDir) },
        uDiffuseStrength: { value: simpleParams.diffuseStrength },
      };

      if (hasText) {
        uniforms.uGlyphUV = { value: glyphUniforms.map((g) => g.uv) };
        uniforms.uGlyphPlane = { value: glyphUniforms.map((g) => g.plane) };
      }

      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
      });

      // Store material ref for uniform updates
      materialRef.current = material;

      // Check for shader compilation errors
      renderer.compile(scene, camera);
      const gl = renderer.getContext();
      const program = (
        material as THREE.ShaderMaterial & {
          program?: { program: WebGLProgram };
        }
      ).program;
      if (program) {
        const programInfo = gl.getProgramInfoLog(program.program);
        if (programInfo) console.warn("Program info:", programInfo);
      }

      const geometry = new THREE.PlaneGeometry(2, 2);
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      // Mouse controls
      let isDragging = false;
      let previousMouse = { x: 0, y: 0 };
      let rotation = { x: 0.3, y: 0.5 };
      let zoom = 1.0;

      const handleMouseDown = (e: MouseEvent) => {
        isDragging = true;
        previousMouse = { x: e.clientX, y: e.clientY };
      };

      const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - previousMouse.x;
        const dy = e.clientY - previousMouse.y;
        rotation.y += dx * 0.005;
        rotation.x += dy * 0.005;
        rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotation.x));
        previousMouse = { x: e.clientX, y: e.clientY };
      };

      const handleMouseUp = () => {
        isDragging = false;
      };

      const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        zoom *= e.deltaY > 0 ? 0.95 : 1.05;
        zoom = Math.max(0.3, Math.min(5.0, zoom));
      };

      container.addEventListener("mousedown", handleMouseDown);
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      container.addEventListener("wheel", handleWheel, { passive: false });

      const handleResize = () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
        material.uniforms.uResolution.value.set(
          window.innerWidth,
          window.innerHeight
        );
      };
      window.addEventListener("resize", handleResize);

      const animate = () => {
        animationId = requestAnimationFrame(animate);
        material.uniforms.uTime.value += 0.016;
        material.uniforms.uRotation.value.set(rotation.x, rotation.y, 0);
        material.uniforms.uZoom.value = zoom;
        renderer.render(scene, camera);

        // FPS calculation
        fpsRef.current.frames++;
        const now = performance.now();
        if (now - fpsRef.current.lastTime >= 1000) {
          setFps(fpsRef.current.frames);
          fpsRef.current.frames = 0;
          fpsRef.current.lastTime = now;
        }
      };
      animate();

      // Store cleanup and material reference
      const containerWithRefs = container as HTMLDivElement & {
        cleanup?: () => void;
        material?: THREE.ShaderMaterial;
      };
      containerWithRefs.material = material;
      containerWithRefs.cleanup = () => {
        container.removeEventListener("mousedown", handleMouseDown);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        container.removeEventListener("wheel", handleWheel);
        window.removeEventListener("resize", handleResize);
        cancelAnimationFrame(animationId);
        container.removeChild(renderer.domElement);
        renderer.dispose();
        materialRef.current = null;
      };
    });

    return () => {
      const cleanup = (container as HTMLDivElement & { cleanup?: () => void })
        .cleanup;
      if (cleanup) cleanup();
    };
  }, [displayText, unixTimestamp, isValidDate]);

  // Slider component
  const Slider = useCallback(({
    label,
    value,
    min,
    max,
    step,
    onChange
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (v: number) => void;
  }) => (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 text-white/70">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-24 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
      />
      <span className="w-12 text-white/50">{value.toFixed(2)}</span>
    </div>
  ), []);

  return (
    <div className="relative w-screen h-screen">
      <div
        ref={containerRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />
      <div className="absolute top-4 left-4 bg-black/70 p-4 rounded-lg max-w-xs">
        {/* FPS Counter */}
        <div className="text-white/50 text-xs mb-3 font-mono">{fps} FPS</div>

        {/* Date Input */}
        <div className="mb-4">
          <label className="block text-white/70 text-xs mb-1">Date (mm-dd-yyyy)</label>
          <input
            type="text"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            placeholder="03-23-1999"
            className={`w-full bg-white/10 text-white px-3 py-2 rounded border outline-none text-sm font-mono ${
              isValidDate ? "border-white/20 focus:border-white/50" : "border-red-500/50"
            }`}
          />
          {isValidDate && (
            <div className="text-white/50 text-xs mt-1">
              Engraving: {displayText}
            </div>
          )}
        </div>

        {/* Lighting Mode Toggle */}
        <div className="mb-4">
          <label className="block text-white/70 text-xs mb-2">Lighting Mode</label>
          <div className="flex gap-2">
            <button
              onClick={() => setLightingMode("pbr")}
              className={`px-3 py-1 text-xs rounded ${
                lightingMode === "pbr"
                  ? "bg-white/30 text-white"
                  : "bg-white/10 text-white/50 hover:bg-white/20"
              }`}
            >
              PBR
            </button>
            <button
              onClick={() => setLightingMode("simple")}
              className={`px-3 py-1 text-xs rounded ${
                lightingMode === "simple"
                  ? "bg-white/30 text-white"
                  : "bg-white/10 text-white/50 hover:bg-white/20"
              }`}
            >
              Simple
            </button>
          </div>
        </div>

        {/* PBR Parameters */}
        {lightingMode === "pbr" && (
          <div className="space-y-2">
            <div className="text-white/70 text-xs mb-2">PBR Settings</div>
            <Slider
              label="Light 1 Intensity"
              value={pbrParams.light1Intensity}
              min={0}
              max={20}
              step={0.1}
              onChange={(v) => setPbrParams((p) => ({ ...p, light1Intensity: v }))}
            />
            <Slider
              label="Light 2 Intensity"
              value={pbrParams.light2Intensity}
              min={0}
              max={50}
              step={0.5}
              onChange={(v) => setPbrParams((p) => ({ ...p, light2Intensity: v }))}
            />
            <Slider
              label="Ambient"
              value={pbrParams.ambientIntensity}
              min={0}
              max={0.5}
              step={0.01}
              onChange={(v) => setPbrParams((p) => ({ ...p, ambientIntensity: v }))}
            />
            <Slider
              label="Metallic"
              value={pbrParams.metallic}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => setPbrParams((p) => ({ ...p, metallic: v }))}
            />
            <Slider
              label="Roughness"
              value={pbrParams.roughness}
              min={0.01}
              max={1}
              step={0.01}
              onChange={(v) => setPbrParams((p) => ({ ...p, roughness: v }))}
            />
          </div>
        )}

        {/* Simple Parameters */}
        {lightingMode === "simple" && (
          <div className="space-y-2">
            <div className="text-white/70 text-xs mb-2">Simple Settings</div>
            <Slider
              label="Diffuse Strength"
              value={simpleParams.diffuseStrength}
              min={0}
              max={2}
              step={0.1}
              onChange={(v) => setSimpleParams((p) => ({ ...p, diffuseStrength: v }))}
            />
            <Slider
              label="Light X"
              value={simpleParams.lightDir[0]}
              min={-3}
              max={3}
              step={0.1}
              onChange={(v) => setSimpleParams((p) => ({ ...p, lightDir: [v, p.lightDir[1], p.lightDir[2]] }))}
            />
            <Slider
              label="Light Y"
              value={simpleParams.lightDir[1]}
              min={-3}
              max={3}
              step={0.1}
              onChange={(v) => setSimpleParams((p) => ({ ...p, lightDir: [p.lightDir[0], v, p.lightDir[2]] }))}
            />
            <Slider
              label="Light Z"
              value={simpleParams.lightDir[2]}
              min={-3}
              max={3}
              step={0.1}
              onChange={(v) => setSimpleParams((p) => ({ ...p, lightDir: [p.lightDir[0], p.lightDir[1], v] }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
