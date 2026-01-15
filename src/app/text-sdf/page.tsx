"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";

const ATLAS_SIZE = 344;
const MAX_GLYPHS = 128;

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

type SceneRefs = {
  material: THREE.ShaderMaterial;
  glyphMap: Map<string, GlyphData>;
};

export default function TextSdfPlayground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const [text, setText] = useState("Hello\nWorld");
  const [textScale, setTextScale] = useState(1.0);
  const [lineHeight, setLineHeight] = useState(0.9);
  const [flatShading, setFlatShading] = useState(false);
  const [orthoView, setOrthoView] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);

  // Update glyph uniforms without rebuilding shader
  const updateTextUniforms = useCallback(
    (
      material: THREE.ShaderMaterial,
      glyphMap: Map<string, GlyphData>,
      inputText: string,
      scale: number,
      lh: number
    ) => {
      const glyphUVs: THREE.Vector4[] = [];
      const glyphPlanes: THREE.Vector4[] = [];
      const glyphPositions: THREE.Vector2[] = [];

      const advance = 0.52 * scale;
      const lineHeightVal = lh * scale;

      // Split into lines
      const lines = inputText.split("\n");
      let maxLineWidth = 0;
      const lineWidths: number[] = [];

      // Calculate line widths for centering
      for (const line of lines) {
        let width = 0;
        for (const char of line) {
          if (char === " ") {
            width += advance;
            continue;
          }
          const lookupChar = char === "·" ? "." : char;
          const glyph = glyphMap.get(lookupChar);
          if (glyph && glyph.atlasBounds && glyph.planeBounds) {
            width += advance;
          }
        }
        lineWidths.push(width);
        maxLineWidth = Math.max(maxLineWidth, width);
      }

      // Total height for vertical centering
      const totalHeight = lines.length * lineHeightVal;
      const startY = totalHeight / 2 - lineHeightVal / 2;

      // Build glyph data
      let lineIdx = 0;
      for (const line of lines) {
        const lineWidth = lineWidths[lineIdx];
        let x = -lineWidth / 2 + advance * 0.25;
        const y = startY - lineIdx * lineHeightVal;

        for (const char of line) {
          if (glyphUVs.length >= MAX_GLYPHS) break;

          if (char === " ") {
            x += advance;
            continue;
          }

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

            glyphUVs.push(new THREE.Vector4(uMin, vMin, uMax, vMax));
            glyphPlanes.push(
              new THREE.Vector4(
                glyph.planeBounds.left * scale,
                (glyph.planeBounds.bottom + verticalOffset) * scale,
                glyph.planeBounds.right * scale,
                (glyph.planeBounds.top + verticalOffset) * scale
              )
            );
            glyphPositions.push(new THREE.Vector2(x, y));

            x += advance;
          }
        }
        lineIdx++;
      }

      // Pad arrays to MAX_GLYPHS
      while (glyphUVs.length < MAX_GLYPHS) {
        glyphUVs.push(new THREE.Vector4(0, 0, 0, 0));
        glyphPlanes.push(new THREE.Vector4(0, 0, 0, 0));
        glyphPositions.push(new THREE.Vector2(0, 0));
      }

      material.uniforms.uGlyphUV.value = glyphUVs;
      material.uniforms.uGlyphPlane.value = glyphPlanes;
      material.uniforms.uGlyphPos.value = glyphPositions;
      material.uniforms.uNumGlyphs.value = Math.min(
        inputText.replace(/[\s\n]/g, "").length,
        MAX_GLYPHS
      );
    },
    []
  );

  // Initialize scene once
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    let animationId: number;

    fetch("/fonts/PPRightSerifMono-msdf.json")
      .then((res) => res.json())
      .then((fontData: FontData) => {
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

        const textureLoader = new THREE.TextureLoader();
        const msdfTexture = textureLoader.load(
          "/fonts/PPRightSerifMono-msdf.png"
        );
        msdfTexture.minFilter = THREE.LinearFilter;
        msdfTexture.magFilter = THREE.LinearFilter;
        msdfTexture.flipY = true;

        const vertexShader = `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
          }
        `;

        const fragmentShader = `
          precision highp float;

          uniform vec2 uResolution;
          uniform float uTime;
          uniform sampler2D uMsdfTexture;
          uniform float uScale;

          uniform vec4 uGlyphUV[${MAX_GLYPHS}];
          uniform vec4 uGlyphPlane[${MAX_GLYPHS}];
          uniform vec2 uGlyphPos[${MAX_GLYPHS}];
          uniform int uNumGlyphs;
          uniform float uFlatShading;
          uniform float uOrthoView;

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

          float glyphSdf2D(vec2 p, int idx) {
            vec4 plane = uGlyphPlane[idx];
            vec4 uv = uGlyphUV[idx];

            vec2 planeMin = plane.xy;
            vec2 planeMax = plane.zw;
            vec2 planeSize = planeMax - planeMin;

            if (planeSize.x < 0.001) return 1000.0;

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
            for (int i = 0; i < ${MAX_GLYPHS}; i++) {
              if (i >= uNumGlyphs) break;
              vec2 pos = uGlyphPos[i];
              d = min(d, glyphSdf2D(p - pos, i));
            }
            return d;
          }

          // ============================================================
          // TEXT SDF 3D - Extruded text
          // ============================================================
          float textSdf(vec3 p, float depth) {
            float d2d = textSdf2D(p.xy);
            float dz = abs(p.z) - depth;
            return max(d2d, dz);
          }

          float starShape(vec3 p) {
            float tri = abs(fract(uTime / 4.) * 2.0 - 1.0);
            float t = sin(tri * PI * 0.5);
            t = 1.0;

            p.xy *= 3.;
            p.xz *= Rot(PI / 2.);
            float pointAngle = atan(p.z, p.y);

            float numSpokes = 8.0;
            float spokeSpacing = 2.0 * PI / numSpokes;
            float closestSpokeAngle = floor((pointAngle / spokeSpacing) + 0.5) * spokeSpacing;

            vec3 spokePt = p;
            spokePt.yz *= Rot(-closestSpokeAngle);

            float rayMix = mix(0., 3.2, t);
            float rayLength = rayMix;

            float rayTMix = mix(-0.001, 0.0055, t);
            float rayThickness = rayTMix;
            float rays = sdCapsule(spokePt, rayThickness, rayLength);

            vec3 torusPos = spokePt - vec3(0.0, 1.4, 0.0);
            float tMix = mix(-0.5, 0.5, t);
            float torus = sdTorusX(torusPos, vec2(tMix, 0.01));
            float result = smin(rays, torus, 0.5);

            return result;
          }

          // ============================================================
          // SCENE SDF - Combine text with other 3D shapes here!
          // ============================================================
          float sceneSdf(vec3 p) {
            float dText = textSdf(p, 0.1);

            float tri = abs(fract(uTime / 4.) * 2.0 - 1.0);
            float t = sin(tri * PI * 0.5);
            float star = starShape(p);
            return mix(star, dText, t);
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

            vec3 ro, rd;
            if (uOrthoView > 0.5) {
              // Orthographic - parallel rays
              ro = vec3(uv, 3.0);
              rd = vec3(0.0, 0.0, -1.0);
            } else {
              // Perspective - rays diverge from center
              ro = vec3(0.0, 0.0, 3.0);
              rd = normalize(vec3(uv, -1.0));
            }

            vec3 col = vec3(1.0);

            float t = rayMarch(ro, rd);

            if (t > 0.0) {
              if (uFlatShading > 0.5) {
                // Pure black, no lighting
                col = vec3(0.0);
              } else {
                vec3 p = ro + rd * t;
                vec3 n = calcNormal(p);

                vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
                float diff = max(dot(n, lightDir), 0.0);
                float amb = 0.2;

                col = vec3(0.0) + vec3(1.0) * (amb + diff * 0.8);
                col = vec3(1.0) - col;
              }
            }

            gl_FragColor = vec4(col, 1.0);
          }
        `;

        // Initialize uniform arrays
        const emptyVec4Array = Array(MAX_GLYPHS)
          .fill(null)
          .map(() => new THREE.Vector4(0, 0, 0, 0));
        const emptyVec2Array = Array(MAX_GLYPHS)
          .fill(null)
          .map(() => new THREE.Vector2(0, 0));

        const uniforms = {
          uResolution: {
            value: new THREE.Vector2(window.innerWidth, window.innerHeight),
          },
          uTime: { value: 0 },
          uMsdfTexture: { value: msdfTexture },
          uScale: { value: 1.0 },
          uGlyphUV: { value: [...emptyVec4Array] },
          uGlyphPlane: { value: [...emptyVec4Array] },
          uGlyphPos: { value: [...emptyVec2Array] },
          uNumGlyphs: { value: 0 },
          uFlatShading: { value: 0.0 },
          uOrthoView: { value: 0.0 },
        };

        const material = new THREE.ShaderMaterial({
          vertexShader,
          fragmentShader,
          uniforms,
        });

        // Store refs for text updates
        sceneRef.current = { material, glyphMap };
        setSceneReady(true);

        const geometry = new THREE.PlaneGeometry(2, 2);
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

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
            if (container.contains(renderer.domElement)) {
              container.removeChild(renderer.domElement);
            }
            renderer.dispose();
            sceneRef.current = null;
            setSceneReady(false);
          };
      });

    return () => {
      const cleanup = (container as HTMLDivElement & { cleanup?: () => void })
        .cleanup;
      if (cleanup) cleanup();
    };
  }, []);

  // Update text uniforms when text/scale/lineHeight changes
  useEffect(() => {
    if (sceneRef.current && sceneReady) {
      updateTextUniforms(
        sceneRef.current.material,
        sceneRef.current.glyphMap,
        text,
        textScale,
        lineHeight
      );
      sceneRef.current.material.uniforms.uFlatShading.value = flatShading ? 1.0 : 0.0;
      sceneRef.current.material.uniforms.uOrthoView.value = orthoView ? 1.0 : 0.0;
    }
  }, [text, textScale, lineHeight, flatShading, orthoView, sceneReady, updateTextUniforms]);

  return (
    <div className="relative w-screen h-screen">
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute top-4 left-4 bg-black/80 p-4 rounded-lg text-white max-w-sm">
        <div className="mb-2 text-sm text-gray-300">Text SDF Playground</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="bg-white/10 text-white px-3 py-2 rounded border border-white/20 outline-none focus:border-white/50 w-full h-24 resize-none"
          placeholder="Enter text (supports line breaks)..."
        />
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 w-20">Text Scale</label>
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.05"
              value={textScale}
              onChange={(e) => setTextScale(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs w-8">{textScale.toFixed(1)}</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 w-20">Line Height</label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              value={lineHeight}
              onChange={(e) => setLineHeight(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs w-8">{lineHeight.toFixed(1)}</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 w-20">Flat Black</label>
            <input
              type="checkbox"
              checked={flatShading}
              onChange={(e) => setFlatShading(e.target.checked)}
              className="w-4 h-4"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 w-20">Ortho View</label>
            <input
              type="checkbox"
              checked={orthoView}
              onChange={(e) => setOrthoView(e.target.checked)}
              className="w-4 h-4"
            />
          </div>
        </div>
        <div className="mt-2 text-xs text-gray-400">
          Scroll to zoom · Max {MAX_GLYPHS} chars
        </div>
      </div>
    </div>
  );
}
