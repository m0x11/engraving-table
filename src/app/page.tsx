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

export default function Home() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("Hello");

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    let animationId: number;

    // Load font data and set up scene
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
        const msdfTexture = textureLoader.load("/fonts/PPRightSerifMono-msdf.png");
        msdfTexture.minFilter = THREE.LinearFilter;
        msdfTexture.magFilter = THREE.LinearFilter;
        msdfTexture.flipY = true;

        // Build glyph uniform data for the text
        const glyphUniforms: { uv: THREE.Vector4; plane: THREE.Vector4 }[] = [];
        const validChars: string[] = [];

        for (const char of text) {
          // Handle middle dot "·" by using period with vertical offset
          const lookupChar = char === "·" ? "." : char;
          const glyph = glyphMap.get(lookupChar);

          if (glyph && glyph.atlasBounds && glyph.planeBounds) {
            const uMin = glyph.atlasBounds.left / ATLAS_SIZE;
            const uMax = glyph.atlasBounds.right / ATLAS_SIZE;
            const vMin = glyph.atlasBounds.bottom / ATLAS_SIZE;
            const vMax = glyph.atlasBounds.top / ATLAS_SIZE;

            // Calculate vertical offset for middle dot
            // Period sits near baseline, shift it up to center vs uppercase/numbers
            let verticalOffset = 0;
            if (char === "·") {
              const periodCenter = (glyph.planeBounds.bottom + glyph.planeBounds.top) / 2;
              const targetCenter = 0.34; // Center of uppercase letters (~-0.09 to 0.78)
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
        if (numGlyphs === 0) {
          console.error("No valid glyphs found for text:", text);
          return;
        }

        // Generate shader with dynamic glyph count
        const vertexShader = `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
          }
        `;

        // Build the getGlyph function dynamically
        let getGlyphCode = "";
        for (let i = 0; i < numGlyphs; i++) {
          if (i === 0) {
            getGlyphCode += `if (idx == 0) { plane = uGlyphPlane[0]; uv = uGlyphUV[0]; }\n`;
          } else {
            getGlyphCode += `        else if (idx == ${i}) { plane = uGlyphPlane[${i}]; uv = uGlyphUV[${i}]; }\n`;
          }
        }

        // Build the textSdf2D function dynamically
        let textSdfCode = "";
        for (let i = 0; i < numGlyphs; i++) {
          textSdfCode += `        d = min(d, glyphSdf2D(p - vec2(xStart + ${i.toFixed(1)} * advance, 0.0), ${i}));\n`;
        }

        const fragmentShader = `
          precision highp float;

          uniform vec2 uResolution;
          uniform float uTime;
          uniform sampler2D uMsdfTexture;
          uniform vec3 uRotation;
          uniform float uZoom;

          uniform vec4 uGlyphUV[${numGlyphs}];
          uniform vec4 uGlyphPlane[${numGlyphs}];

          const float DEPTH = 0.15;
          const float PX_RANGE = 8.0;
          const float GLYPH_SIZE = 48.0;
          const int MAX_STEPS = 64;
          const float MAX_DIST = 10.0;
          const float SURF_DIST = 0.001;

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
            float totalWidth = ${numGlyphs.toFixed(1)} * advance;
            float xStart = -totalWidth * 0.5 + advance * 0.25;

            ${textSdfCode}

            return d;
          }

          float sceneSdf(vec3 p) {
            float d2d = textSdf2D(p.xy);
            float dz = abs(p.z) - DEPTH;
            vec2 w = vec2(d2d, dz);
            return min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
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
              if (d < SURF_DIST) return t;
              if (t > MAX_DIST) break;
              t += d * 0.9;
            }
            return -1.0;
          }

          void main() {
            vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

            mat3 rot = rotateY(uRotation.y) * rotateX(uRotation.x);

            vec3 ro = rot * vec3(0.0, 0.0, 2.5 / uZoom);
            vec3 rd = rot * normalize(vec3(uv, -1.0));

            vec3 col = mix(vec3(0.1, 0.1, 0.15), vec3(0.2, 0.2, 0.25), uv.y + 0.5);

            float t = rayMarch(ro, rd);

            if (t > 0.0) {
              vec3 p = ro + rd * t;
              vec3 n = calcNormal(p);

              vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
              vec3 lightDir2 = normalize(vec3(-1.0, 0.5, 0.5));

              float diff = max(dot(n, lightDir), 0.0);
              float diff2 = max(dot(n, lightDir2), 0.0);

              vec3 viewDir = -rd;
              vec3 reflectDir = reflect(-lightDir, n);
              float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);

              float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);

              vec3 baseColor = vec3(0.9, 0.85, 0.8);
              vec3 ambient = vec3(0.15, 0.15, 0.2);

              col = baseColor * (ambient + diff * 0.7 + diff2 * 0.3);
              col += vec3(1.0) * spec * 0.5;
              col += vec3(0.3, 0.4, 0.5) * fresnel * 0.3;
            }

            col = pow(col, vec3(0.4545));
            gl_FragColor = vec4(col, 1.0);
          }
        `;

        const material = new THREE.ShaderMaterial({
          vertexShader,
          fragmentShader,
          uniforms: {
            uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
            uTime: { value: 0 },
            uMsdfTexture: { value: msdfTexture },
            uRotation: { value: new THREE.Vector3(0, 0, 0) },
            uZoom: { value: 1.0 },
            uGlyphUV: { value: glyphUniforms.map((g) => g.uv) },
            uGlyphPlane: { value: glyphUniforms.map((g) => g.plane) },
          },
        });

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
          zoom = Math.max(0.5, Math.min(3.0, zoom));
        };

        container.addEventListener("mousedown", handleMouseDown);
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        container.addEventListener("wheel", handleWheel, { passive: false });

        const handleResize = () => {
          renderer.setSize(window.innerWidth, window.innerHeight);
          material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
        };
        window.addEventListener("resize", handleResize);

        const animate = () => {
          animationId = requestAnimationFrame(animate);
          material.uniforms.uTime.value += 0.016;
          material.uniforms.uRotation.value.set(rotation.x, rotation.y, 0);
          material.uniforms.uZoom.value = zoom;
          renderer.render(scene, camera);
        };
        animate();

        // Store cleanup function
        (container as HTMLDivElement & { cleanup?: () => void }).cleanup = () => {
          container.removeEventListener("mousedown", handleMouseDown);
          window.removeEventListener("mousemove", handleMouseMove);
          window.removeEventListener("mouseup", handleMouseUp);
          container.removeEventListener("wheel", handleWheel);
          window.removeEventListener("resize", handleResize);
          cancelAnimationFrame(animationId);
          container.removeChild(renderer.domElement);
          renderer.dispose();
        };
      });

    return () => {
      const cleanup = (container as HTMLDivElement & { cleanup?: () => void }).cleanup;
      if (cleanup) cleanup();
    };
  }, [text]);

  return (
    <div className="relative w-screen h-screen">
      <div
        ref={containerRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />
      <div className="absolute top-4 left-4 bg-black/50 p-4 rounded-lg">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="bg-white/10 text-white px-3 py-2 rounded border border-white/20 outline-none focus:border-white/50"
          placeholder="Enter text..."
        />
      </div>
    </div>
  );
}
