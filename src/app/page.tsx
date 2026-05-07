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
type AnimationMode = "text" | "form" | "ring";

type PBRParams = {
  numReflections: number;
  light1Dir: [number, number, number];
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

// Convert date string to display text with middle dots
// dateFormat: 'mdy' => MM·DD·YYYY, 'dmy' => DD·MM·YYYY
function dateToDisplayText(dateStr: string, dateFormat: "mdy" | "dmy" = "mdy"): string {
  const match = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) return "";

  const month = match[1].padStart(2, "0");
  const day = match[2].padStart(2, "0");
  const year = match[3];

  if (dateFormat === "dmy") {
    return `${day}·${month}·${year}`;
  }
  return `${month}·${day}·${year}`;
}

// Convert Unix timestamp to display format: "NOV 11 2025"
function unixToDisplayDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  const month = months[date.getUTCMonth()];
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${month} ${day} ${year}`;
}

// Ephemeris constants and computation (mirrors GLSL logic)
const J2000_UNIX = 946728000.0;
const SECONDS_PER_DAY = 86400.0;
const SYSTEM_SCALE = 1.32;

const PLANETS = ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"] as const;

const SEMI_MAJOR_AXES = [0.33, 0.60, 0.87, 1.13, 1.40, 1.67, 1.93, 2.20];
const ASCENDING_NODES = [48.331, 76.680, -11.261, 49.558, 100.464, 113.665, 74.006, 131.783];
const ARG_PERIHELION = [77.456, 131.533, 102.947, 336.041, 14.331, 92.432, 170.964, 44.971];
const MEAN_LONGITUDES = [252.25, 181.98, 100.46, 355.45, 34.40, 49.94, 313.23, 304.88];
const ORBITAL_PERIODS = [87.969, 224.701, 365.256, 686.980, 4332.589, 10759.22, 30688.5, 60182.0];
const ORBITS_ENABLED = [1, 0, 1, 0, 0, 0, 0, 1];

const MOON_ORBITAL_PERIOD = 27.321661;

function computeEphemerisData(unixTimestamp: number) {
  const daysFromJ2000 = (unixTimestamp - J2000_UNIX) / SECONDS_PER_DAY;
  const date = new Date(unixTimestamp * 1000);

  const planets = PLANETS.map((name, i) => {
    const period = ORBITAL_PERIODS[i];
    const meanMotion = (2 * Math.PI) / period;
    const angle = ((meanMotion * daysFromJ2000) + (MEAN_LONGITUDES[i] * Math.PI / 180)) % (2 * Math.PI);
    const angleDeg = ((angle * 180 / Math.PI) % 360 + 360) % 360;
    const radius = SEMI_MAJOR_AXES[i] * SYSTEM_SCALE;
    const x = -radius * Math.cos(angle);
    const z = radius * Math.sin(angle);

    return {
      name,
      semiMajorAxis: SEMI_MAJOR_AXES[i],
      ascendingNode: ASCENDING_NODES[i],
      argPerihelion: ARG_PERIHELION[i],
      meanLongitude: MEAN_LONGITUDES[i],
      orbitalPeriod: period,
      orbitEnabled: ORBITS_ENABLED[i],
      angle: angleDeg,
      posX: x,
      posZ: z,
      radius,
    };
  });

  // Moon
  const earthAngle = ((((2 * Math.PI) / ORBITAL_PERIODS[2]) * daysFromJ2000) + (MEAN_LONGITUDES[2] * Math.PI / 180)) % (2 * Math.PI);
  const moonAngle = ((2 * Math.PI * daysFromJ2000) / MOON_ORBITAL_PERIOD + Math.PI) % (2 * Math.PI);
  const moonAngleDeg = ((moonAngle * 180 / Math.PI) % 360 + 360) % 360;

  return {
    unixTimestamp,
    dateUTC: date.toISOString().replace("T", " ").slice(0, 19) + " UTC",
    daysFromJ2000,
    j2000Unix: J2000_UNIX,
    systemScale: SYSTEM_SCALE,
    planets,
    moonAngle: moonAngleDeg,
    moonPeriod: MOON_ORBITAL_PERIOD,
  };
}

function formatEphemerisText(timestamp: number, compact: boolean): string {
  const data = computeEphemerisData(timestamp);
  const pad = (s: string, n: number) => s.padEnd(n);
  const padN = (n: number, w: number, d: number = 2) => n.toFixed(d).padStart(w);
  const padL = (n: number, w: number, d: number = 2) => n.toFixed(d).padEnd(w);
  const sep = "*".repeat(62);

  const livePositions = `LIVE POSITIONS (target date)
${sep}
${pad("Planet", 9)} ${pad("Angle°", 8)} ${pad("X", 8)} ${pad("Z", 8)}
${sep}
${data.planets.map(p =>
  `${pad(p.name, 9)} ${padL(p.angle, 8)} ${padL(p.posX, 8, 3)} ${padL(p.posZ, 8, 3)}`
).join("\n")}
${sep}
Moon        Angle: ${padN(data.moonAngle, 7)}°`;

  if (compact) return livePositions;

  return `EPHEMERIS DATA
${sep}
Date            ${data.dateUTC}
Unix Timestamp  ${data.unixTimestamp.toFixed(0)}
Days from J2000 ${padN(data.daysFromJ2000, 12, 3)}
J2000 Epoch     ${data.j2000Unix.toFixed(0)} (Jan 1 2000 12:00 UTC)
System Scale    ${data.systemScale}
${sep}

ORBITAL PARAMETERS
${sep}
${pad("Planet", 9)} ${pad("a", 5)} ${pad("Ω°", 8)} ${pad("ω°", 8)} ${pad("L₀°", 8)} ${pad("P(days)", 10)} ${pad("Orb", 3)}
${sep}
${data.planets.map(p =>
  `${pad(p.name, 9)} ${padN(p.semiMajorAxis, 5)} ${padN(p.ascendingNode, 8)} ${padN(p.argPerihelion, 8)} ${padN(p.meanLongitude, 8)} ${padN(p.orbitalPeriod, 10, 1)} ${p.orbitEnabled ? " On" : "Off"}`
).join("\n")}
${sep}

${livePositions}`;
}

const MOON_COUNT = 8;
const MOON_CYCLE_SECONDS = 365.25 * SECONDS_PER_DAY; // one full year

// Update moon phase SVG - single occluder sweeps right-to-left per moon, staggered
// Each moon's occluder position is offset by i/MOON_COUNT of the cycle
function updateMoonPhases(container: HTMLDivElement | null, timestamp: number) {
  if (!container) return;
  // Global phase [0, 1) cycling once per year
  const globalPhase = (((timestamp % MOON_CYCLE_SECONDS) + MOON_CYCLE_SECONDS) % MOON_CYCLE_SECONDS) / MOON_CYCLE_SECONDS;

  const svgs = container.querySelectorAll("svg");
  for (let i = 0; i < svgs.length; i++) {
    const svg = svgs[i];
    const occ = svg.querySelector<SVGCircleElement>("[data-occ='sweep']");
    if (!occ) continue;

    const viewBoxSize = 28;
    const radius = 14;
    const center = viewBoxSize / 2;
    const travel = radius * 2.5; // how far the occluder travels from center

    // Stagger each moon's phase
    const phase = (globalPhase + i / MOON_COUNT) % 1.0;
    // Occluder sweeps from +travel (far right, full moon) through center (new moon) to -travel (full moon)
    const occCx = center + travel * (1 - 2 * phase);
    occ.setAttribute("cx", String(occCx));
  }
}

function ClockView({ planetTimestamp, color, timestampRef }: { planetTimestamp: number; color: string; timestampRef?: React.RefObject<number | null> }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const godrayMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (mountedRef.current) return;
    mountedRef.current = true;

    const container = canvasRef.current;
    let animationId: number;

    Promise.all([
      fetch("/sdfs/common.glsl").then((res) => res.text()),
      fetch("/sdfs/petals.glsl").then((res) => res.text()),
      fetch("/sdfs/ephemeris.glsl").then((res) => res.text()),
    ]).then(([commonGlsl, petalsGlsl, ephemerisGlsl]) => {
      const combinedGlsl = commonGlsl + "\n" + petalsGlsl + "\n" + ephemerisGlsl;
      const processed = combinedGlsl
        .replace(/mapDistance/g, "clockSdf")
        .replace(/mapScene/g, "clockScene")
        .replace(/float targetDate = [^;]+;/g, "// targetDate injected as uniform")
        .replace(/#define MAX_STEPS \d+/g, "// MAX_STEPS defined above")
        .replace(/#define MAX_DIST[^\n]*/g, "// MAX_DIST defined above")
        .replace(/#define SURF_DIST[^\n]*/g, "// SURF_DIST defined above")
        // Freeze showMeT to always return 1.0 (fully grown, no animation)
        .replace(
          /float showMeT\(\)\s*\{[^}]*\}/,
          `float showMeT() { return 1.0; }`,
        )
        // Freeze relicT too
        .replace(
          /float relicT\(\)\s*\{[^}]*\}/,
          `float relicT() { return 1.0; }`,
        )
        // Use global targetDate for planet positions instead of hardcoded internal date
        .replace(
          /float internalTargetDate\s*=[^;]+;/g,
          `float internalTargetDate = targetDate;`,
        )
        // Tilt star spokes in YZ to PI/2.2 for fine-line visibility
        // (matches starShape in reference: p.yz *= Rot(PI / 2.2))
        // The external starP.xz *= Rot(PI / 2.) stays unchanged —
        // the godray post-process rotates the 2D output by -PI/2.2 to straighten visually
        .replace(
          /p\.y \/= 2\.0;\s*\n\s*p\.xy \*= Rot\(PI \/ 2\.0\);\s*\n\s*p\.yz \*= Rot\(PI \/ 2\.0\);/,
          `p.y /= 2.0;\n    p.xy *= Rot(PI / 2.0);\n    p.yz *= Rot(PI / 2.2);`,
        );

      const SIZE = 300;
      const dpr = window.devicePixelRatio;
      const bufferW = SIZE * dpr;
      const bufferH = SIZE * dpr;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(SIZE, SIZE);
      renderer.setPixelRatio(dpr);
      renderer.setClearColor(0x000000, 0);
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // --- Pass 1: Render dial SDF to buffer ---
      const bufferTarget = new THREE.WebGLRenderTarget(bufferW, bufferH, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
      });

      const scene1 = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

      const vertexShader = `
        void main() {
          gl_Position = vec4(position, 1.0);
        }
      `;

      const pass1Fragment = `
        precision highp float;
        uniform vec2 uResolution;
        uniform float uTime;
        uniform float uTargetDate;

        const int MAX_STEPS = 100;
        const float MAX_DIST = 40.0;
        const float SURF_DIST = 0.001;

        float targetDate;

        ${processed}

        float dialSdf(vec3 p) {
          return showMeHow(p);
        }

        float rayMarchDial(vec3 ro, vec3 rd) {
          float t = 0.0;
          for (int i = 0; i < MAX_STEPS; i++) {
            vec3 p = ro + rd * t;
            float d = dialSdf(p);
            if (d < 0.005) return t;
            if (t > MAX_DIST) break;
            t += d;
          }
          return -1.0;
        }

        void main() {
          targetDate = uTargetDate;
          vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

          vec3 ro = vec3(0.0, 8.0, 0.0);
          vec3 rd = normalize(vec3(uv.x, -1.0, uv.y));

          float t = rayMarchDial(ro, rd);

          if (t > 0.0) {
            gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
          } else {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
          }
        }
      `;

      const pass1Uniforms = {
        uResolution: { value: new THREE.Vector2(bufferW, bufferH) },
        uTime: { value: 0 },
        uTargetDate: { value: planetTimestamp },
      };

      const pass1Material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: pass1Fragment,
        uniforms: pass1Uniforms,
        transparent: true,
      });

      materialRef.current = pass1Material;

      const geo = new THREE.PlaneGeometry(2, 2);
      scene1.add(new THREE.Mesh(geo, pass1Material));

      // --- Pass 2: Rotated UV sample + brightness accumulation (no actual rays) ---
      // The 3D tilt (PI/2.2) makes fine lines intersect camera rays at an angle
      // (better for raymarcher detection). This pass rotates UVs by -PI/2.2 to
      // straighten the visual output while preserving the 3D detection benefit.
      const scene2 = new THREE.Scene();

      const pass2Fragment = `
        precision highp float;
        uniform sampler2D uBuffer;
        uniform vec2 uResolution;
        uniform vec3 uSilhouetteColor;

        mat2 rot2(float a) {
          float s = sin(a), c = cos(a);
          return mat2(c, -s, s, c);
        }

        void main() {
          vec2 uv = gl_FragCoord.xy / uResolution;
          vec2 centre = vec2(0.5);

          // Counter-rotate to straighten spokes tilted by p.yz *= Rot(PI/2.2) in 3D
          float aspect = uResolution.x / uResolution.y;
          vec2 p = uv - centre;
          p.x *= aspect;
          const float angle = 3.14159265 / 2.2;
          p = rot2(angle) * p;
          p.x /= aspect;
          uv = centre + p;

          // Accumulation loop (density=0 means no radial movement, just brightness)
          const int NUM_SAMPLES = 55;
          float decay = 0.967;
          float exposure = 0.22;
          float density = 0.0;
          float weight = 0.58767;

          vec4 color = texture2D(uBuffer, uv) * 0.805104;

          vec2 lightPos = vec2(0.5, 0.5);
          vec2 deltaTexCoord = (lightPos - uv);
          deltaTexCoord *= (1.0 / float(NUM_SAMPLES)) * density;

          float illuminationDecay = 1.0;
          for (int i = 0; i < NUM_SAMPLES; i++) {
            uv += deltaTexCoord;
            vec4 sampleTex = texture2D(uBuffer, uv) * 0.305104;
            sampleTex *= illuminationDecay * weight;
            color += sampleTex;
            illuminationDecay *= decay;
          }

          color *= exposure;

          // Colorize with silhouette color
          float intensity = max(color.r, max(color.g, color.b));
          if (intensity < 0.01) discard;
          gl_FragColor = vec4(uSilhouetteColor * intensity, intensity);
        }
      `;

      const pass2Uniforms = {
        uBuffer: { value: bufferTarget.texture },
        uResolution: { value: new THREE.Vector2(bufferW, bufferH) },
        uSilhouetteColor: { value: new THREE.Vector3(0, 0, 0) },
      };

      const pass2Material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: pass2Fragment,
        uniforms: pass2Uniforms,
        transparent: true,
      });

      godrayMaterialRef.current = pass2Material;

      scene2.add(new THREE.Mesh(geo.clone(), pass2Material));

      const tsRef = timestampRef;
      const render = () => {
        animationId = requestAnimationFrame(render);
        // Read timestamp from ref every frame
        if (tsRef?.current != null && pass1Material.uniforms.uTargetDate.value !== tsRef.current) {
          pass1Material.uniforms.uTargetDate.value = tsRef.current;
        }
        // Pass 1: render dial to buffer
        renderer.setRenderTarget(bufferTarget);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene1, camera);
        // Pass 2: godray + colorize to screen
        renderer.setRenderTarget(null);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene2, camera);
      };
      render();
    });

    return () => {
      cancelAnimationFrame(animationId);
      if (rendererRef.current && container.contains(rendererRef.current.domElement)) {
        container.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
      materialRef.current = null;
      godrayMaterialRef.current = null;
      mountedRef.current = false;
    };
  }, []);

  // Update uniforms when props change
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTargetDate.value = planetTimestamp;
    }
    if (godrayMaterialRef.current) {
      const c = parseInt(color.slice(1), 16);
      godrayMaterialRef.current.uniforms.uSilhouetteColor.value.set(
        ((c >> 16) & 0xff) / 255,
        ((c >> 8) & 0xff) / 255,
        (c & 0xff) / 255,
      );
    }
  }, [planetTimestamp, color]);

  return (
    <div
      ref={canvasRef}
      className="mb-3 mx-auto overflow-hidden"
      style={{ width: 300, height: 300 }}
    />
  );
}

export default function Home() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dateInput, setDateInput] = useState("01-01-2000");
  const [planetDateInput, setPlanetDateInput] = useState("01-01-2000");
  const [dateFormat, setDateFormat] = useState<"mdy" | "dmy">("mdy");
  const [livePlanetTimestamp, setLivePlanetTimestamp] = useState<number>(parseDateToUnix("01-01-2000") ?? 0);
  const [animationMode, setAnimationMode] = useState<AnimationMode>("text");
  const [showTorusMorph, setShowTorusMorph] = useState(false);
  const [showDial, setShowDial] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [showCapsuleGrid, setShowCapsuleGrid] = useState(false);
  const [showGrowAnim, setShowGrowAnim] = useState(false);
  const [bgColor, setBgColor] = useState("#d6d6d7");
  const [demoTextColor, setDemoTextColor] = useState("#111111");
  const [lightingMode, setLightingMode] = useState<LightingMode>("pbr");
  const [pbrParams, setPbrParams] = useState<PBRParams>({
    numReflections: 1,
    light1Dir: [1.0, 1.0, 0.0],
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
  const [showSliders, setShowSliders] = useState(true);
  const [demoMode, setDemoMode] = useState(true);
  const [demoDisplayDate, setDemoDisplayDate] = useState("");
  const demoTimeRef = useRef(0);
  const demoModeRef = useRef(false);
  const baseTimestampRef = useRef(0);
  const [showEphemeris, setShowEphemeris] = useState(true);
  const [ephemerisCompact, setEphemerisCompact] = useState(true);
  const [ephemerisColor, setEphemerisColor] = useState("#111111");
  const livePlanetTimestampRef = useRef<number>(parseDateToUnix("01-01-2000") ?? 0);
  const ephemerisPreRef = useRef<HTMLPreElement>(null);
  const demoDateRef = useRef<HTMLDivElement>(null);
  const ephemerisCompactRef = useRef(true);
  const moonPhaseRef = useRef<HTMLDivElement>(null);
  const demoDraggingRef = useRef(false);
  const demoDragPrevXRef = useRef(0);
  const [lightZAnimating, setLightZAnimating] = useState(false);
  const lightZAnimationRef = useRef<{
    startTime: number;
    startValue: number;
  } | null>(null);

  // Toggle sliders with "h" key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "h" && !(e.target instanceof HTMLInputElement)) {
        setShowSliders((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Compute derived values
  const unixTimestamp = parseDateToUnix(dateInput);
  const planetTimestamp = parseDateToUnix(planetDateInput);
  const displayText = dateToDisplayText(dateInput, dateFormat);
  const isValidDate = unixTimestamp !== null;
  const isValidPlanetDate = planetTimestamp !== null;

  // Sync ephemerisCompact to ref for animation loop reads
  useEffect(() => {
    ephemerisCompactRef.current = ephemerisCompact;
  }, [ephemerisCompact]);

  // Sync demo mode to ref and reset demo time when toggled on
  useEffect(() => {
    demoModeRef.current = demoMode;
    if (demoMode && planetTimestamp !== null) {
      demoTimeRef.current = 0;
      baseTimestampRef.current = planetTimestamp;
      livePlanetTimestampRef.current = planetTimestamp;
      setDemoDisplayDate(unixToDisplayDate(planetTimestamp));
      setLivePlanetTimestamp(planetTimestamp);
    }
  }, [demoMode, planetTimestamp]);

  // Keep livePlanetTimestamp in sync when not in demo mode
  useEffect(() => {
    if (!demoMode && planetTimestamp !== null) {
      livePlanetTimestampRef.current = planetTimestamp;
      setLivePlanetTimestamp(planetTimestamp);
    }
  }, [planetTimestamp, demoMode]);

  // Demo date drag-to-scrub: horizontal drag on the date text changes the date
  useEffect(() => {
    const el = demoDateRef.current;
    if (!el) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (!demoModeRef.current) return;
      demoDraggingRef.current = true;
      demoDragPrevXRef.current = e.clientX;
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!demoDraggingRef.current) return;
      const dx = e.clientX - demoDragPrevXRef.current;
      demoDragPrevXRef.current = e.clientX;
      // ~2 days per pixel of drag
      demoTimeRef.current += dx * 2 * 86400;
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!demoDraggingRef.current) return;
      demoDraggingRef.current = false;
      el.releasePointerCapture(e.pointerId);
    };

    el.addEventListener("pointerdown", handlePointerDown);
    el.addEventListener("pointermove", handlePointerMove);
    el.addEventListener("pointerup", handlePointerUp);

    return () => {
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerUp);
    };
  });

  // Light Z animation effect
  useEffect(() => {
    if (!lightZAnimating) return;

    const duration = 3000; // 3 seconds
    let animationId: number;

    const animate = () => {
      if (!lightZAnimationRef.current) return;

      const elapsed = performance.now() - lightZAnimationRef.current.startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out quint for very graceful deceleration
      const eased = 1 - Math.pow(1 - progress, 5);

      const newZ =
        lightZAnimationRef.current.startValue * (1 - eased) + 0 * eased;

      setPbrParams((p) => ({
        ...p,
        light1Dir: [p.light1Dir[0], p.light1Dir[1], newZ],
      }));

      if (progress < 1) {
        animationId = requestAnimationFrame(animate);
      } else {
        setLightZAnimating(false);
        lightZAnimationRef.current = null;
      }
    };

    animationId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [lightZAnimating]);

  // Ref to store the material for uniform updates
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  // Update uniforms without recompiling shader
  useEffect(() => {
    if (!materialRef.current) return;
    const m = materialRef.current;

    m.uniforms.uLightingMode.value = lightingMode === "pbr" ? 0 : 1;
    m.uniforms.uAnimMode.value = animationMode === "text" ? 0 : animationMode === "form" ? 1 : 2;
    m.uniforms.uShowTorusMorph.value = showTorusMorph ? 1 : 0;
    m.uniforms.uShowDial.value = showDial ? 1 : 0;
    m.uniforms.uShowGrid.value = showGrid ? 1 : 0;
    m.uniforms.uShowCapsuleGrid.value = showCapsuleGrid ? 1 : 0;
    m.uniforms.uFreezeGrowth.value = showGrowAnim ? 0 : 1;
    const bg = parseInt(bgColor.slice(1), 16);
    m.uniforms.uBgColor.value.set(((bg >> 16) & 0xff) / 255, ((bg >> 8) & 0xff) / 255, (bg & 0xff) / 255);
    if (planetTimestamp !== null && !demoMode) {
      m.uniforms.uTargetDate.value = planetTimestamp;
    }
    m.uniforms.uLight1Dir.value.set(...pbrParams.light1Dir);
    m.uniforms.uLight1Color.value.set(...pbrParams.light1Color);
    m.uniforms.uLight1Intensity.value = pbrParams.light1Intensity;
    m.uniforms.uLight2Color.value.set(...pbrParams.light2Color);
    m.uniforms.uLight2Intensity.value = pbrParams.light2Intensity;
    m.uniforms.uAmbientIntensity.value = pbrParams.ambientIntensity;
    m.uniforms.uMetallic.value = pbrParams.metallic;
    m.uniforms.uRoughness.value = pbrParams.roughness;
    m.uniforms.uLightDir.value.set(...simpleParams.lightDir);
    m.uniforms.uDiffuseStrength.value = simpleParams.diffuseStrength;
  }, [lightingMode, animationMode, showTorusMorph, showDial, showGrid, showCapsuleGrid, showGrowAnim, bgColor, planetTimestamp, demoMode, pbrParams, simpleParams]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!isValidDate) return;

    const container = containerRef.current;
    let animationId: number;

    // Load font data, common utilities, petals, and ephemeris SDF
    Promise.all([
      fetch("/fonts/PPRightSerifMono-msdf.json").then((res) => res.json()),
      fetch("/sdfs/common.glsl").then((res) => res.text()),
      fetch("/sdfs/petals.glsl").then((res) => res.text()),
      fetch("/sdfs/ephemeris.glsl").then((res) => res.text()),
    ]).then(
      ([fontData, commonGlsl, petalsGlsl, ephemerisGlsl]: [
        FontData,
        string,
        string,
        string,
      ]) => {
        // Combine: common -> petals -> ephemeris (order matters for dependencies)
        const combinedGlsl =
          commonGlsl + "\n" + petalsGlsl + "\n" + ephemerisGlsl;

        // Process combined GLSL - rename functions and remove conflicting defines
        const processedEphemeris = combinedGlsl
          .replace(/mapDistance/g, "ephemerisSdf")
          .replace(/mapScene/g, "ephemerisScene")
          // Remove targetDate hardcoding - we'll inject it as uniform
          .replace(
            /float targetDate = [^;]+;/g,
            "// targetDate injected as uniform",
          )
          // Remove conflicting raymarching constants (we define our own)
          .replace(/#define MAX_STEPS \d+/g, "// MAX_STEPS defined above")
          .replace(/#define MAX_DIST[^\n]*/g, "// MAX_DIST defined above")
          .replace(/#define SURF_DIST[^\n]*/g, "// SURF_DIST defined above")
          // Inject freeze control into showMeT
          .replace(
            /float showMeT\(\)\s*\{[^}]*\}/,
            `float showMeT() {
              if (uFreezeGrowth == 1) return 1.0;
              float tri = abs(fract(uTime / 4.) * 2.0 - 1.0);
              return sin(tri * PI * 0.5);
            }`,
          );

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
          "/fonts/PPRightSerifMono-msdf.png",
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
                glyph.planeBounds.top + verticalOffset,
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
        uniform int uAnimMode; // 0 = text, 1 = form, 2 = ring
        uniform int uShowTorusMorph;
        uniform int uShowDial;
        uniform int uShowGrid;
        uniform int uShowCapsuleGrid;
        uniform int uFreezeGrowth;
        uniform vec3 uBgColor;

        // PBR params
        uniform vec3 uLight1Dir;
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


        float formOnInnerCylinder(vec3 p) {
          // ========== FORM ADJUSTMENTS ==========
          float formScale = 1.55;      // Size of the petal (smaller = larger petal)
          float formOffsetY = 0.34;    // Vertical offset (positive = up)
          float formRotation = 0.0;   // Rotation in radians (around depth axis)
          float formDepth = 0.5;      // How deep the form extends
          // =======================================

          // Animation timer
          float tri = abs(fract(uTime / 4.0) * 2.0 - 1.0);
          float t = sin(tri * PI * 0.5);

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

          // Text SDF - combine 2D text with radial extrusion
          vec2 w = vec2(d2d, abs(surfaceDist) - textDepth);
          float dText = min(max(w.x, w.y), 0.0) + length(max(w, 0.0));

          // Petal SDF - transform to cylinder space with adjustments
          vec2 petalXY = vec2(textX, textY - formOffsetY);  // Apply vertical offset
          petalXY = Rot2D(formRotation) * petalXY;          // Apply rotation
          petalXY *= formScale;                              // Apply scale
          vec3 petalP = vec3(petalXY.x, petalXY.y, surfaceDist / formDepth);
          //float dPetal = petalsSdf(petalP, uTime) / formScale;  // Scale the result back
          float dPetal = Form(petalP, uTime) / formScale;  // Scale the result back

          // Mix between text and petal based on animation
          return mix(dText, dPetal, t);
        }

        float sceneSdf(vec3 p) {
          float t = relicT();

          // Base ring shape: torus morph or full ring
          float base;
          if (uShowTorusMorph == 1) {
            base = mix(alt(p), ephemerisScene(p), t);
          } else {
            base = ephemerisScene(p);
          }

          float dEphemeris = base;

          // Dial (star/orbit/planet grow animation)
          if (uShowDial == 1) {
            dEphemeris = min(dEphemeris, showMeHow(p));
          }

          // Grid morph (intersecting cylinders)
          if (uShowGrid == 1) {
            dEphemeris = mix(dEphemeris, altStars(p), t);
          }

          // Capsule grid morph (intersecting capsules)
          if (uShowCapsuleGrid == 1) {
            dEphemeris = mix(dEphemeris, altStarsCapped(p), t);
          }

          ${
            hasText
              ? `
          if (uAnimMode == 2) return dEphemeris;
          float dText = textOnInnerCylinder(p);
          if (uAnimMode == 1) {
            float dForm = formOnInnerCylinder(p);
            return max(dEphemeris, -dForm);
          }
          return max(dEphemeris, -dText);
          `
              : `
          return dEphemeris;
          `
          }
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
          vec3 L1 = normalize(uLight1Dir);
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
          float cameraHeight = 0.0;  // Vertical offset for camera target
          //float cameraHeight = -3.75;  // Vertical offset for camera target
          float camDist = 6.0 / uZoom;

          mat3 rot = rotateY(uRotation.y) * rotateX(uRotation.x);
          vec3 ro = rot * vec3(0.0, 0.0, camDist) + vec3(0.0, cameraHeight, 0.0);
          vec3 rd = rot * normalize(vec3(uv, -1.0));

          vec3 col = uBgColor;

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
          uTargetDate: { value: planetTimestamp },
          uLightingMode: { value: lightingMode === "pbr" ? 0 : 1 },
          uAnimMode: { value: animationMode === "text" ? 0 : animationMode === "form" ? 1 : 2 },
          uShowTorusMorph: { value: showTorusMorph ? 1 : 0 },
          uShowDial: { value: showDial ? 1 : 0 },
          uShowGrid: { value: showGrid ? 1 : 0 },
          uShowCapsuleGrid: { value: showCapsuleGrid ? 1 : 0 },
          uFreezeGrowth: { value: showGrowAnim ? 0 : 1 },
          uBgColor: { value: (() => { const bg = parseInt(bgColor.slice(1), 16); return new THREE.Vector3(((bg >> 16) & 0xff) / 255, ((bg >> 8) & 0xff) / 255, (bg & 0xff) / 255); })() },
          // PBR params
          uLight1Dir: { value: new THREE.Vector3(...pbrParams.light1Dir) },
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
          rotation.x = Math.max(
            -Math.PI / 2,
            Math.min(Math.PI / 2, rotation.x),
          );
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
            window.innerHeight,
          );
        };
        window.addEventListener("resize", handleResize);

        let lastDemoUpdate = 0;
        const animate = () => {
          animationId = requestAnimationFrame(animate);
          material.uniforms.uTime.value += 0.016;
          material.uniforms.uRotation.value.set(rotation.x, rotation.y, 0);
          material.uniforms.uZoom.value = zoom;

          // Demo mode: rapidly advance the date (paused while dragging)
          if (demoModeRef.current) {
            if (!demoDraggingRef.current) {
              // Advance by ~3 days per frame at 60fps = ~180 days/second
              const daysPerFrame = 0.25;
              const secondsPerDay = 86400;
              demoTimeRef.current += daysPerFrame * secondsPerDay;
            }
            const currentTimestamp =
              baseTimestampRef.current + demoTimeRef.current;
            material.uniforms.uTargetDate.value = currentTimestamp;

            // Write to ref for ClockView to read every frame (zero React cost)
            livePlanetTimestampRef.current = currentTimestamp;

            // Update DOM directly every ~33ms (30 FPS text updates, zero React re-renders)
            const now = performance.now();
            if (now - lastDemoUpdate > 33) {
              if (demoDateRef.current) {
                demoDateRef.current.textContent = unixToDisplayDate(currentTimestamp);
              }
              if (ephemerisPreRef.current) {
                ephemerisPreRef.current.textContent = formatEphemerisText(currentTimestamp, ephemerisCompactRef.current);
              }
              lastDemoUpdate = now;
            }
          }

          renderer.render(scene, camera);

          // Update moon phase indicators from current timestamp
          updateMoonPhases(moonPhaseRef.current, livePlanetTimestampRef.current);

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
      },
    );

    return () => {
      const cleanup = (container as HTMLDivElement & { cleanup?: () => void })
        .cleanup;
      if (cleanup) cleanup();
    };
  }, [displayText, isValidDate]);

  // Slider component
  const Slider = useCallback(
    ({
      label,
      value,
      min,
      max,
      step,
      onChange,
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
    ),
    [],
  );

  return (
    <div className="relative w-screen h-screen">
      <div
        ref={containerRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />
      <div className="absolute top-4 left-4 bg-black/70 p-4 rounded-lg max-w-xs">
        {/* FPS Counter */}
        <div className="text-white/50 text-xs mb-3">{fps} FPS</div>

        {/* Date Input */}
        <div className="mb-4">
          <label className="block text-white/70 text-xs mb-1">
            Date (mm-dd-yyyy)
          </label>
          <input
            type="text"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            placeholder="03-23-1999"
            className={`w-full bg-white/10 text-white px-3 py-2 rounded border outline-none text-sm ${
              isValidDate
                ? "border-white/20 focus:border-white/50"
                : "border-red-500/50"
            }`}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setDateFormat("mdy")}
              className={`px-2 py-1 text-xs rounded ${
                dateFormat === "mdy"
                  ? "bg-white/30 text-white"
                  : "bg-white/10 text-white/50 hover:bg-white/20"
              }`}
            >
              MM·DD·YYYY
            </button>
            <button
              onClick={() => setDateFormat("dmy")}
              className={`px-2 py-1 text-xs rounded ${
                dateFormat === "dmy"
                  ? "bg-white/30 text-white"
                  : "bg-white/10 text-white/50 hover:bg-white/20"
              }`}
            >
              DD·MM·YYYY
            </button>
          </div>
          {isValidDate && (
            <div className="text-white/50 text-xs mt-1">
              Engraving: {displayText}
            </div>
          )}
        </div>

        {/* Planet Date Input */}
        <div className="mb-4">
          <label className="block text-white/70 text-xs mb-1">
            Planet Date (mm-dd-yyyy)
          </label>
          <input
            type="text"
            value={planetDateInput}
            onChange={(e) => setPlanetDateInput(e.target.value)}
            placeholder="03-23-1999"
            className={`w-full bg-white/10 text-white px-3 py-2 rounded border outline-none text-sm ${
              isValidPlanetDate
                ? "border-white/20 focus:border-white/50"
                : "border-red-500/50"
            }`}
          />
          {isValidPlanetDate && (
            <div className="text-white/50 text-xs mt-1">
              Planets set to: {new Date((planetTimestamp ?? 0) * 1000).toISOString().slice(0, 10)}
            </div>
          )}
        </div>

        {/* Demo Mode Toggle */}
        <div className="mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={demoMode}
              onChange={(e) => setDemoMode(e.target.checked)}
              className="w-4 h-4 rounded bg-white/10 border-white/20 text-white accent-white"
            />
            <span className="text-white/70 text-xs">Demo Mode</span>
          </label>
          {demoMode && (
            <button
              onClick={() => {
                lightZAnimationRef.current = {
                  startTime: performance.now(),
                  startValue: pbrParams.light1Dir[2],
                };
                setLightZAnimating(true);
              }}
              disabled={lightZAnimating}
              className={`mt-2 px-3 py-1 text-xs rounded ${
                lightZAnimating
                  ? "bg-white/10 text-white/30 cursor-not-allowed"
                  : "bg-white/20 text-white/70 hover:bg-white/30"
              }`}
            >
              {lightZAnimating ? "Animating..." : "Light Z to 0"}
            </button>
          )}
        </div>

        {/* Engraving Mode */}
        <div className="mb-4">
          <label className="block text-white/70 text-xs mb-2">
            Engraving Mode
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setAnimationMode("text")}
              className={`px-3 py-1 text-xs rounded ${
                animationMode === "text"
                  ? "bg-white/30 text-white"
                  : "bg-white/10 text-white/50 hover:bg-white/20"
              }`}
            >
              Text
            </button>
            <button
              onClick={() => setAnimationMode("form")}
              className={`px-3 py-1 text-xs rounded ${
                animationMode === "form"
                  ? "bg-white/30 text-white"
                  : "bg-white/10 text-white/50 hover:bg-white/20"
              }`}
            >
              Form
            </button>
            <button
              onClick={() => setAnimationMode("ring")}
              className={`px-3 py-1 text-xs rounded ${
                animationMode === "ring"
                  ? "bg-white/30 text-white"
                  : "bg-white/10 text-white/50 hover:bg-white/20"
              }`}
            >
              Ring Only
            </button>
          </div>
        </div>

        {/* Ring Animations */}
        <div className="mb-4">
          <label className="block text-white/70 text-xs mb-2">
            Ring Animations
          </label>
          <div className="space-y-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showTorusMorph}
                onChange={(e) => setShowTorusMorph(e.target.checked)}
                className="w-3 h-3 rounded bg-white/10 border-white/20 accent-white"
              />
              <span className="text-white/70 text-xs">Torus Morph</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showDial}
                onChange={(e) => setShowDial(e.target.checked)}
                className="w-3 h-3 rounded bg-white/10 border-white/20 accent-white"
              />
              <span className="text-white/70 text-xs">Dial</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
                className="w-3 h-3 rounded bg-white/10 border-white/20 accent-white"
              />
              <span className="text-white/70 text-xs">Grid</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showCapsuleGrid}
                onChange={(e) => setShowCapsuleGrid(e.target.checked)}
                className="w-3 h-3 rounded bg-white/10 border-white/20 accent-white"
              />
              <span className="text-white/70 text-xs">Capsule Grid</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showGrowAnim}
                onChange={(e) => setShowGrowAnim(e.target.checked)}
                className="w-3 h-3 rounded bg-white/10 border-white/20 accent-white"
              />
              <span className="text-white/70 text-xs">Grow/Shrink</span>
            </label>
          </div>
        </div>

        {/* Colors */}
        <div className="mb-4">
          <label className="block text-white/70 text-xs mb-2">
            Colors
          </label>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-white/70">
              <span>BG</span>
              <input
                type="color"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="w-6 h-6 rounded border border-white/20 bg-transparent cursor-pointer"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-white/70">
              <span>Demo Text</span>
              <input
                type="color"
                value={demoTextColor}
                onChange={(e) => setDemoTextColor(e.target.value)}
                className="w-6 h-6 rounded border border-white/20 bg-transparent cursor-pointer"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-white/70">
              <span>Table</span>
              <input
                type="color"
                value={ephemerisColor}
                onChange={(e) => setEphemerisColor(e.target.value)}
                className="w-6 h-6 rounded border border-white/20 bg-transparent cursor-pointer"
              />
            </label>
          </div>
        </div>

        {/* Ephemeris Data Toggle */}
        <div className="mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showEphemeris}
              onChange={(e) => setShowEphemeris(e.target.checked)}
              className="w-4 h-4 rounded bg-white/10 border-white/20 text-white accent-white"
            />
            <span className="text-white/70 text-xs">Ephemeris Data</span>
          </label>
          {showEphemeris && (
            <label className="flex items-center gap-2 cursor-pointer mt-1 ml-6">
              <input
                type="checkbox"
                checked={ephemerisCompact}
                onChange={(e) => setEphemerisCompact(e.target.checked)}
                className="w-3 h-3 rounded bg-white/10 border-white/20 accent-white"
              />
              <span className="text-white/50 text-xs">Compact</span>
            </label>
          )}
        </div>

        {/* Lighting Mode Toggle */}
        <div className="mb-4">
          <label className="block text-white/70 text-xs mb-2">
            Lighting Mode
          </label>
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
        {showSliders && lightingMode === "pbr" && (
          <div className="space-y-2">
            <div className="text-white/70 text-xs mb-2">PBR Settings</div>
            <Slider
              label="Light 1 X"
              value={pbrParams.light1Dir[0]}
              min={-3}
              max={3}
              step={0.1}
              onChange={(v) =>
                setPbrParams((p) => ({
                  ...p,
                  light1Dir: [v, p.light1Dir[1], p.light1Dir[2]],
                }))
              }
            />
            <Slider
              label="Light 1 Y"
              value={pbrParams.light1Dir[1]}
              min={-3}
              max={3}
              step={0.1}
              onChange={(v) =>
                setPbrParams((p) => ({
                  ...p,
                  light1Dir: [p.light1Dir[0], v, p.light1Dir[2]],
                }))
              }
            />
            <Slider
              label="Light 1 Z"
              value={pbrParams.light1Dir[2]}
              min={-3}
              max={3}
              step={0.1}
              onChange={(v) =>
                setPbrParams((p) => ({
                  ...p,
                  light1Dir: [p.light1Dir[0], p.light1Dir[1], v],
                }))
              }
            />
            <Slider
              label="Light 1 Intensity"
              value={pbrParams.light1Intensity}
              min={0}
              max={20}
              step={0.1}
              onChange={(v) =>
                setPbrParams((p) => ({ ...p, light1Intensity: v }))
              }
            />
            <Slider
              label="Light 2 Intensity"
              value={pbrParams.light2Intensity}
              min={0}
              max={50}
              step={0.5}
              onChange={(v) =>
                setPbrParams((p) => ({ ...p, light2Intensity: v }))
              }
            />
            <Slider
              label="Ambient"
              value={pbrParams.ambientIntensity}
              min={0}
              max={0.5}
              step={0.01}
              onChange={(v) =>
                setPbrParams((p) => ({ ...p, ambientIntensity: v }))
              }
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
        {showSliders && lightingMode === "simple" && (
          <div className="space-y-2">
            <div className="text-white/70 text-xs mb-2">Simple Settings</div>
            <Slider
              label="Diffuse Strength"
              value={simpleParams.diffuseStrength}
              min={0}
              max={2}
              step={0.1}
              onChange={(v) =>
                setSimpleParams((p) => ({ ...p, diffuseStrength: v }))
              }
            />
            <Slider
              label="Light X"
              value={simpleParams.lightDir[0]}
              min={-3}
              max={3}
              step={0.1}
              onChange={(v) =>
                setSimpleParams((p) => ({
                  ...p,
                  lightDir: [v, p.lightDir[1], p.lightDir[2]],
                }))
              }
            />
            <Slider
              label="Light Y"
              value={simpleParams.lightDir[1]}
              min={-3}
              max={3}
              step={0.1}
              onChange={(v) =>
                setSimpleParams((p) => ({
                  ...p,
                  lightDir: [p.lightDir[0], v, p.lightDir[2]],
                }))
              }
            />
            <Slider
              label="Light Z"
              value={simpleParams.lightDir[2]}
              min={-3}
              max={3}
              step={0.1}
              onChange={(v) =>
                setSimpleParams((p) => ({
                  ...p,
                  lightDir: [p.lightDir[0], p.lightDir[1], v],
                }))
              }
            />
          </div>
        )}
      </div>

      {/* Demo Mode Date Overlay */}
      {demoMode && (
        <div className="absolute top-64 left-1/2 -translate-x-1/2">
          <div
            ref={demoDateRef}
            className="text-7xl tracking-wider font-light select-none"
            style={{
              color: demoTextColor,
              fontFamily: "'PP Right Serif Mono', 'Courier New', monospace",
              cursor: "ew-resize",
            }}
          >
            {demoDisplayDate}
          </div>
        </div>
      )}

      {/* Clock View + Ephemeris Data Table */}
      {showEphemeris && (
          <div
            className="absolute bottom-6 right-6 p-8 rounded-lg pointer-events-none"
            style={{
              color: ephemerisColor,
              fontFamily: "'PP Right Serif Mono', 'Courier New', monospace",
              fontSize: "16px",
              lineHeight: "1.6",
            }}
          >
            {/* Clock View Canvas */}
            <ClockView
              planetTimestamp={livePlanetTimestamp}
              color={ephemerisColor}
              timestampRef={livePlanetTimestampRef}
            />
            <pre ref={ephemerisPreRef} style={{ margin: 0, fontFamily: "inherit", paddingTop: "24px", paddingBottom: "24px" }}>
{formatEphemerisText(livePlanetTimestampRef.current, ephemerisCompact)}
            </pre>
            {/* Moon phase indicator */}
            <div ref={moonPhaseRef} className="flex flex-row gap-3 justify-center" style={{ paddingTop: "64px", paddingBottom: "64px" }}>
              {Array.from({ length: MOON_COUNT }).map((_, i) => {
                const viewBoxSize = 28;
                const radius = 14;
                const center = viewBoxSize / 2;
                const maskId = `moonRotMask-${i}`;
                return (
                  <svg
                    key={i}
                    width={viewBoxSize}
                    height={viewBoxSize}
                    viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
                  >
                    <defs>
                      <mask id={maskId} maskUnits="userSpaceOnUse">
                        <rect x="0" y="0" width={viewBoxSize} height={viewBoxSize} fill="black" />
                        <circle cx={center} cy={center} r={radius} fill="white" />
                        <circle data-occ="sweep" cx={center + radius * 2.5} cy={center} r={radius} fill="black" />
                      </mask>
                    </defs>
                    <rect
                      x="0" y="0"
                      width={viewBoxSize}
                      height={viewBoxSize}
                      fill={ephemerisColor}
                      mask={`url(#${maskId})`}
                      rx={radius}
                    />
                  </svg>
                );
              })}
            </div>
          </div>
      )}
    </div>
  );
}
