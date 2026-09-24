"use client";

import { useEffect, useRef } from "react";
import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";
import { HORIZON } from "./geometry";

// A hand-painted dusk: colour laid down in cel bands with wandering edges, clouds with one lit
// and one shadow tone and an inked rim, a still lake that mirrors it all, and fine film grain.
const FRAGMENT = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec2 uResolution;
uniform float uHorizon;
uniform float uCalm;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
vec3 skyRamp(float h) {
  vec3 gold = vec3(0.97, 0.73, 0.53);
  vec3 rose = vec3(0.90, 0.53, 0.55);
  vec3 violet = vec3(0.30, 0.36, 0.62);
  vec3 indigo = vec3(0.10, 0.17, 0.40);
  vec3 night = vec3(0.03, 0.06, 0.18);
  if (h < 0.10) return mix(gold, rose, h / 0.10);
  if (h < 0.22) return mix(rose, violet, (h - 0.10) / 0.12);
  if (h < 0.50) return mix(violet, indigo, (h - 0.22) / 0.28);
  return mix(indigo, night, (h - 0.50) / 0.50);
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  float hy = 1.0 - uHorizon;
  float depth = hy - uv.y;
  bool lake = depth > 0.0;
  vec2 q = uv;
  if (lake) {
    q.y = hy + depth * 1.35;
    q.x += (noise(vec2(uv.x * 7.0, depth * 110.0 + uTime * 0.35)) - 0.5) * 0.014 * (depth * 7.0 + 0.25);
  }
  float h = clamp((q.y - hy) / (1.0 - hy), 0.0, 1.0);
  float t = uTime;

  // Colour laid in bands: stepped, but the edges wander like a brush.
  float wobble = (fbm(vec2(q.x * aspect * 2.2 + t * 0.004, q.y * 6.0)) - 0.5) * 0.09;
  float hb = clamp(h + wobble, 0.0, 1.0);
  float stepped = floor(hb * 10.0) / 10.0;
  vec3 col = skyRamp(mix(hb, stepped, 0.6));

  // The sun has just set behind the hills, left of centre.
  float sunX = 0.34;
  float glow = exp(-pow((q.x - sunX) * aspect * 1.1, 2.0) * 1.6) * exp(-h * 5.5);
  col += vec3(1.0, 0.70, 0.42) * glow * 0.42;

  // Cumulus bank: two tones and a rim, never a smooth gradient.
  vec2 cp = vec2(q.x * aspect * 1.25 + t * 0.005, q.y * 3.0);
  float band = smoothstep(0.04, 0.22, h) * smoothstep(0.78, 0.36, h);
  float dens = (fbm(cp * vec2(1.0, 2.2)) + fbm(cp * 0.45) * 0.3) * band;
  float densBelow = (fbm((cp + vec2(0.0, -0.06)) * vec2(1.0, 2.2)) + fbm((cp + vec2(0.0, -0.06)) * 0.45) * 0.3) * band;
  float cloud = smoothstep(0.50, 0.53, dens);
  float lit = clamp((dens - densBelow) * 7.0 + 0.45, 0.0, 1.0);
  float tone = floor(lit * 3.0) / 3.0;
  vec3 shade = mix(vec3(0.20, 0.22, 0.40), vec3(0.14, 0.20, 0.40), h);
  vec3 light = mix(vec3(1.0, 0.76, 0.56), vec3(0.98, 0.64, 0.56), h);
  vec3 cloudCol = mix(shade, light, tone);
  float cloudStrength = cloud * (1.0 - uCalm * 0.5);
  col = mix(col, cloudCol, cloudStrength);
  float rim = smoothstep(0.495, 0.505, dens) - smoothstep(0.505, 0.515, dens);
  col += light * rim * 0.22 * (1.0 - uCalm * 0.5);

  // High cirrus streaks catching the last light.
  float streak = fbm(vec2(q.x * aspect * 0.8 - t * 0.003, q.y * 26.0));
  float cirrus = smoothstep(0.62, 0.7, streak) * smoothstep(0.45, 0.7, h) * smoothstep(1.0, 0.8, h);
  col = mix(col, vec3(0.95, 0.70, 0.62), cirrus * 0.35 * (1.0 - uCalm * 0.6));

  // First stars of the evening: tiny and faint so the recording's stars always outshine them.
  vec2 grid = vec2(q.x * aspect, q.y) * 150.0;
  vec2 cell = floor(grid);
  float seed = hash(cell);
  float star = step(0.9955, seed) * smoothstep(0.32, 0.12, length(fract(grid) - 0.5));
  float twinkle = 0.55 + 0.45 * sin(t * 1.7 + seed * 80.0);
  col += vec3(1.0, 0.95, 0.88) * star * twinkle * smoothstep(0.4, 0.85, h) * (1.0 - cloud) * (1.0 - uCalm * 0.85) * 0.55;

  if (lake) {
    col *= vec3(0.48, 0.52, 0.66);
    col = mix(col, vec3(0.02, 0.04, 0.12), smoothstep(0.0, 0.26, depth) * 0.85);
    float glint = step(0.93, noise(vec2(uv.x * 90.0 + t * 0.2, depth * 520.0))) * exp(-depth * 14.0);
    col += vec3(1.0, 0.78, 0.56) * glint * 0.28;
  }

  // Calm lets night fall, so the stars and threads drawn over the sky stay the brightest things.
  col *= mix(1.0, 0.5, uCalm);
  col += (hash(uv * uResolution + fract(t) * 91.0) - 0.5) * 0.035;
  float vignette = smoothstep(1.25, 0.25, length((uv - 0.5) * vec2(aspect * 0.75, 1.0)));
  col *= mix(0.74, 1.0, vignette);
  gl_FragColor = vec4(col, 1.0);
}
`;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

type PaintedSkyProps = {
  /** 0 = full evening sky, 1 = quieted so data can lead (clouds and background stars recede). */
  calm: number;
  /** Hold the current frame, so the GPU and CPU stay free while Apollo is listening. */
  paused?: boolean;
};

export default function PaintedSky({ calm, paused = false }: PaintedSkyProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const calmRef = useRef(calm);
  const pausedRef = useRef(paused);
  useEffect(() => {
    calmRef.current = calm;
    pausedRef.current = paused;
  }, [calm, paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    } catch {
      return; // The CSS ground colour stands in when WebGL is unavailable.
    }
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new Vector2(1, 1) },
      uHorizon: { value: HORIZON },
      uCalm: { value: calmRef.current },
    };
    const material = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms });
    const geometry = new PlaneGeometry(2, 2);
    scene.add(new Mesh(geometry, material));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      renderer.setPixelRatio(ratio);
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      uniforms.uResolution.value.set(canvas.clientWidth * ratio, canvas.clientHeight * ratio);
    };
    resize();
    window.addEventListener("resize", resize);

    let frame = 0;
    let last = 0;
    const started = performance.now();
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 33) return; // ~30 fps is plenty for drifting clouds and saves the GPU.
      const settled = Math.abs(calmRef.current - uniforms.uCalm.value) < 0.005;
      if (pausedRef.current && settled && last !== 0) return;
      last = now;
      uniforms.uCalm.value += (calmRef.current - uniforms.uCalm.value) * 0.06;
      uniforms.uTime.value = reducedMotion ? 12 : (now - started) / 1000;
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="painted-sky" aria-hidden="true" />;
}
