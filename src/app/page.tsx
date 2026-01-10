"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// Glyph data for "Hello" extracted from the MSDF JSON
const glyphData: Record<string, { atlasBounds: { left: number; bottom: number; right: number; top: number }; planeBounds: { left: number; bottom: number; right: number; top: number }; advance: number }> = {
  H: { atlasBounds: { left: 189.5, bottom: 115.5, right: 220.5, top: 157.5 }, planeBounds: { left: -0.063151041666666616, bottom: -0.09375, right: 0.58268229166666663, top: 0.78125 }, advance: 0.51953125 },
  e: { atlasBounds: { left: 161.5, bottom: 1.5, right: 188.5, top: 35.5 }, planeBounds: { left: -0.021972656249999965, bottom: -0.09375, right: 0.54052734375, top: 0.61458333333333326 }, advance: 0.51953125 },
  l: { atlasBounds: { left: 0.5, bottom: 201.5, right: 30.5, top: 243.5 }, planeBounds: { left: -0.051757812499999958, bottom: -0.09375, right: 0.5732421875, top: 0.78125 }, advance: 0.51953125 },
  o: { atlasBounds: { left: 248.5, bottom: 1.5, right: 275.5, top: 35.5 }, planeBounds: { left: -0.021728515624999958, bottom: -0.09375, right: 0.540771484375, top: 0.61458333333333326 }, advance: 0.51953125 },
};

const ATLAS_SIZE = 344;

export default function Home() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
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
    // Atlas uses yOrigin: "bottom", Three.js flipY=true makes Y=0 at bottom, so they match
    msdfTexture.flipY = true;

    // Build glyph uniform data for "Hello"
    const text = "Hello";
    const glyphUniforms: { uv: THREE.Vector4; plane: THREE.Vector4 }[] = [];

    for (const char of text) {
      const glyph = glyphData[char];
      if (glyph) {
        // Convert atlas bounds to texture UV coordinates
        // Atlas has yOrigin: "bottom" and Three.js flipY=true by default
        // So atlas coordinates map directly: atlasY/ATLAS_SIZE = textureV
        const uMin = glyph.atlasBounds.left / ATLAS_SIZE;
        const uMax = glyph.atlasBounds.right / ATLAS_SIZE;
        const vMin = glyph.atlasBounds.bottom / ATLAS_SIZE;
        const vMax = glyph.atlasBounds.top / ATLAS_SIZE;

        glyphUniforms.push({
          // vec4(uMin, vMin, uMax, vMax)
          uv: new THREE.Vector4(uMin, vMin, uMax, vMax),
          plane: new THREE.Vector4(
            glyph.planeBounds.left,
            glyph.planeBounds.bottom,
            glyph.planeBounds.right,
            glyph.planeBounds.top
          ),
        });
      }
    }

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
      uniform vec3 uRotation;
      uniform float uZoom;

      // Glyph UV bounds in atlas: vec4(uMin, vMin, uMax, vMax) - already in 0-1 texture space
      uniform vec4 uGlyphUV[5];
      // Glyph plane bounds: vec4(left, bottom, right, top) in em space
      uniform vec4 uGlyphPlane[5];

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

      // Sample MSDF and return signed distance (negative inside, positive outside)
      float sampleMsdf(vec2 localUV, vec4 uvBounds) {
        // localUV is 0-1 within the glyph
        // uvBounds is (uMin, vMin, uMax, vMax) in texture space

        // Interpolate to get atlas UV
        vec2 atlasUV = vec2(
          mix(uvBounds.x, uvBounds.z, localUV.x),
          mix(uvBounds.y, uvBounds.w, localUV.y)
        );

        vec3 msdf = texture2D(uMsdfTexture, atlasUV).rgb;
        float sd = median(msdf);

        // Convert to signed distance
        // MSDF: > 0.5 is inside, < 0.5 is outside
        // We want: negative inside, positive outside for raymarching
        float pxDist = PX_RANGE * (0.5 - sd);
        return pxDist / GLYPH_SIZE;
      }

      // Get glyph data by index (unrolled for GLSL compatibility)
      void getGlyph(int idx, out vec4 plane, out vec4 uv) {
        if (idx == 0) { plane = uGlyphPlane[0]; uv = uGlyphUV[0]; }
        else if (idx == 1) { plane = uGlyphPlane[1]; uv = uGlyphUV[1]; }
        else if (idx == 2) { plane = uGlyphPlane[2]; uv = uGlyphUV[2]; }
        else if (idx == 3) { plane = uGlyphPlane[3]; uv = uGlyphUV[3]; }
        else { plane = uGlyphPlane[4]; uv = uGlyphUV[4]; }
      }

      float glyphSdf2D(vec2 p, int idx) {
        vec4 plane, uv;
        getGlyph(idx, plane, uv);

        // plane = (left, bottom, right, top)
        vec2 planeMin = plane.xy;
        vec2 planeMax = plane.zw;
        vec2 planeSize = planeMax - planeMin;

        // Convert world position to local UV (0-1 within glyph bounds)
        vec2 localUV = (p - planeMin) / planeSize;

        // If outside the glyph bounds, return distance to box
        if (localUV.x < -0.1 || localUV.x > 1.1 || localUV.y < -0.1 || localUV.y > 1.1) {
          vec2 center = (planeMin + planeMax) * 0.5;
          vec2 halfSize = planeSize * 0.5;
          vec2 d = abs(p - center) - halfSize;
          return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
        }

        // Clamp UV for sampling
        vec2 sampleUV = clamp(localUV, 0.0, 1.0);
        return sampleMsdf(sampleUV, uv);
      }

      float textSdf2D(vec2 p) {
        float d = 1000.0;
        float advance = 0.52;
        float totalWidth = 5.0 * advance;
        float xStart = -totalWidth * 0.5 + advance * 0.25;

        // H
        d = min(d, glyphSdf2D(p - vec2(xStart + 0.0 * advance, 0.0), 0));
        // e
        d = min(d, glyphSdf2D(p - vec2(xStart + 1.0 * advance, 0.0), 1));
        // l
        d = min(d, glyphSdf2D(p - vec2(xStart + 2.0 * advance, 0.0), 2));
        // l
        d = min(d, glyphSdf2D(p - vec2(xStart + 3.0 * advance, 0.0), 3));
        // o
        d = min(d, glyphSdf2D(p - vec2(xStart + 4.0 * advance, 0.0), 4));

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
          t += d * 0.9; // Slightly conservative step
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

    // Handle resize
    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      material.uniforms.uTime.value += 0.016;
      material.uniforms.uRotation.value.set(rotation.x, rotation.y, 0);
      material.uniforms.uZoom.value = zoom;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("wheel", handleWheel);
      window.removeEventListener("resize", handleResize);
      container.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-screen h-screen cursor-grab active:cursor-grabbing"
    />
  );
}
