"use client";

import { useEffect, useRef, useState } from "react";
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

export default function TextSdfPlayground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("Hello");

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    let animationId: number;

    fetch("/fonts/PPRightSerifMono-msdf.json")
      .then((res) => res.json())
      .then((fontData: FontData) => {
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

        for (const char of text) {
          const lookupChar = char === "·" ? "." : char;
          const glyph = glyphMap.get(lookupChar);

          if (glyph && glyph.atlasBounds && glyph.planeBounds) {
            const uMin = glyph.atlasBounds.left / ATLAS_SIZE;
            const uMax = glyph.atlasBounds.right / ATLAS_SIZE;
            const vMin = glyph.atlasBounds.bottom / ATLAS_SIZE;
            const vMax = glyph.atlasBounds.top / ATLAS_SIZE;

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
            textSdfCode += `        d = min(d, glyphSdf2D(p - vec2(xStart + ${i.toFixed(
              1
            )} * advance, 0.0), ${i}));\n`;
          }
        }

        const fragmentShader = `
          precision highp float;

          uniform vec2 uResolution;
          uniform float uTime;
          uniform sampler2D uMsdfTexture;
          uniform float uScale;

          ${hasText ? `uniform vec4 uGlyphUV[${numGlyphs}];` : ""}
          ${hasText ? `uniform vec4 uGlyphPlane[${numGlyphs}];` : ""}

          const float PX_RANGE = 8.0;
          const float GLYPH_SIZE = 48.0;
          const float PI = 3.14159265359;
          const int MAX_STEPS = 100;
          const float MAX_DIST = 50.0;
          const float SURF_DIST = 0.001;

          mat2 Rot(float a) {
            float s = sin(a), c = cos(a);
            return mat2(c, -s, s, c);
          }

          float sdCapsule(vec3 p, float r, float h) {
            p.y -= clamp(p.y, 0.0, h);
            return length(p) - r;
          }

          float sdTorusX(vec3 p, vec2 t) {
            vec2 q = vec2(length(p.yz) - t.x, p.x);
            return length(q) - t.y;
          }

          float smin(float a, float b, float k) {
            float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
            return mix(b, a, h) - k * h * (1.0 - h);
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

          // ============================================================
          // TEXT SDF 2D - Returns the 2D text distance
          // ============================================================
          float textSdf2D(vec2 p) {
            float d = 1000.0;
            float advance = 0.52;
            float totalWidth = ${numGlyphs.toFixed(1)} * advance;
            float xStart = -totalWidth * 0.5 + advance * 0.25;

            ${textSdfCode}

            return d;
          }

          // ============================================================
          // TEXT SDF 3D - Extruded text (use p.xy for the text, p.z for depth)
          // ============================================================
          float textSdf(vec3 p, float depth) {
            float d2d = textSdf2D(p.xy);
            float dz = abs(p.z) - depth;
            return max(d2d, dz);
          }

          float starShape(vec3 p) 
          {
             
              float tri = abs(fract(uTime / 4.) * 2.0 - 1.0);
              float t = sin(tri * PI * 0.5);
              t = 1.0;
             
              p.xy *= 3.;
              p.xz*= Rot(PI / 2.);
              //p.yz *= Rot(PI / 2.2);
              float pointAngle = atan(p.z, p.y);

              float numSpokes = 8.0;
              float spokeSpacing = 2.0 * PI / numSpokes;
              float closestSpokeAngle = floor((pointAngle / spokeSpacing) + 0.5) * spokeSpacing;
              
              vec3 spokePt = p;
              spokePt.yz *= Rot(-closestSpokeAngle);
              
              // Create the basic ray
              float rayMix = mix(0., 3.2, t);
              float rayLength = rayMix;
              
              float rayTMix = mix(-0.001, 0.0055, t);
              float rayThickness = rayTMix;
              float rays = sdCapsule(spokePt, rayThickness, rayLength);
              
              // Torus at the positive end
              vec3 torusPos = spokePt - vec3(0.0, 1.4, 0.0);

              float tMix = mix(-0.5, 0.5, t);
              float torus = sdTorusX(torusPos, vec2(tMix, 0.01));
              float result = smin(rays, torus, 0.5);

              return result;
          }

          // ============================================================
          // SCENE SDF - Combine text with other 3D shapes here!
          // p is the 3D point being sampled
          // ============================================================
          float sceneSdf(vec3 p) {
            // Get the 3D extruded text SDF (depth = 0.1)
            float dText = textSdf(p, 0.1);

            // === ADD YOUR OWN 3D SHAPES HERE ===
            // Examples:
            // float dSphere = length(p) - 0.5;                    // Sphere
            // float dBox = length(max(abs(p) - vec3(0.3), 0.0));  // Box
            // float dUnion = min(dText, dSphere);                 // Union
            // float dSubtract = max(dText, -dSphere);             // Subtract
            // float dIntersect = max(dText, dSphere);             // Intersection

            float tri = abs(fract(uTime / 4.) * 2.0 - 1.0);
            float t = sin(tri * PI * 0.5);
            float star = starShape(p);
            return mix(star, dText, t);
            //return star;
          }

          vec3 calcNormal(vec3 p) {
            vec2 e = vec2(0.001, 0.0);
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
              if (d < SURF_DIST) return t;
              if (t > MAX_DIST) break;
              t += d;
            }
            return -1.0;
          }

          void main() {
            vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
            uv /= uScale;

            // Fixed camera - straight on
            vec3 ro = vec3(0.0, 0.0, 3.0);  // Camera position
            vec3 rd = normalize(vec3(uv, -1.0));  // Ray direction

            // White background
            vec3 col = vec3(1.0);

            float t = rayMarch(ro, rd);

            if (t > 0.0) {
              vec3 p = ro + rd * t;
              vec3 n = calcNormal(p);

              // Simple lighting
              vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
              float diff = max(dot(n, lightDir), 0.0);
              float amb = 0.2;

              // Black material
              col = vec3(0.0) + vec3(1.0) * (amb + diff * 0.8);
              col = vec3(1.0) - col;  // Invert for black on white
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
          uScale: { value: 1.0 },
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

        const geometry = new THREE.PlaneGeometry(2, 2);
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        // Scroll to zoom
        let scale = 1.0;
        const handleWheel = (e: WheelEvent) => {
          e.preventDefault();
          scale *= e.deltaY > 0 ? 0.95 : 1.05;
          scale = Math.max(0.1, Math.min(10.0, scale));
        };
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
          material.uniforms.uScale.value = scale;
          renderer.render(scene, camera);
        };
        animate();

        (container as HTMLDivElement & { cleanup?: () => void }).cleanup =
          () => {
            container.removeEventListener("wheel", handleWheel);
            window.removeEventListener("resize", handleResize);
            cancelAnimationFrame(animationId);
            container.removeChild(renderer.domElement);
            renderer.dispose();
          };
      });

    return () => {
      const cleanup = (container as HTMLDivElement & { cleanup?: () => void })
        .cleanup;
      if (cleanup) cleanup();
    };
  }, [text]);

  return (
    <div className="relative w-screen h-screen">
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute top-4 left-4 bg-black/80 p-4 rounded-lg text-white">
        <div className="mb-2 text-sm text-gray-300">Text SDF Playground</div>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="bg-white/10 text-white px-3 py-2 rounded border border-white/20 outline-none focus:border-white/50 w-64"
          placeholder="Enter text..."
        />
        <div className="mt-2 text-xs text-gray-400">Scroll to zoom</div>
      </div>
    </div>
  );
}
