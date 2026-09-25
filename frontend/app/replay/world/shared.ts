/**
 * Shared pieces of the replay world: its dimensions, the colour of each meaning, the uniforms
 * every shader reads (time, night, fog, the fade-in of the scenery), and the two primitives most
 * objects are drawn with: a field of star sprites and a set of fat line strokes.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  InterleavedBufferAttribute,
  Points,
  SRGBColorSpace,
  ShaderMaterial,
  Vector3,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

/**
 * The sound field in its own coordinates: x is time (-8 to 8), y is pitch (0 to 7, log scale),
 * z is loudness (0 up to TERRAIN_HEIGHT). Standing up it is the painted sky; laid down on the
 * lake it is a mountain range whose depth is pitch.
 */
export const FIELD_WIDTH = 16;
export const FIELD_DEPTH = 7;
export const FIELD_BASE = 0.2;
export const TERRAIN_HEIGHT = 1.7;

export const COLORS = {
  star: new Color("#fff6e6"),
  comet: new Color("#9fe3e0"),
  thread: new Color("#e2323f"),
  lantern: new Color("#ffc98a"),
  horizon: new Color("#f3b58a"),
  night: new Color("#070b22"),
};

/** One object shared by every material, so one write updates the whole world. */
export type SharedUniforms = {
  uTime: { value: number };
  /** 0 = evening, 1 = night has fallen (the data takes the stage). */
  uNight: { value: number };
  /** 0 = only the 2D painting behind shows, 1 = the 3D world is fully in. */
  uScene: { value: number };
  uFogColor: { value: Color };
  uFogDensity: { value: number };
};

export function sharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uNight: { value: 0.4 },
    uScene: { value: 0 },
    uFogColor: { value: new Color("#26345e") },
    uFogDensity: { value: 0.0052 },
  };
}

/**
 * Hand-written colours in these shaders are sRGB, as a painter picks them. They are converted to
 * linear light, and three's <colorspace_fragment> encodes the result once for the screen, so the
 * picture is identical whether it goes straight to the canvas or through post-processing.
 */
export const LINEAR_GLSL = /* glsl */ `
vec3 srgbToLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }`;

/** Exponential fog toward the horizon colour, in linear light; `depth` is the view distance. */
export const FOG_GLSL = /* glsl */ `
${LINEAR_GLSL}
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uNight;
vec3 applyFog(vec3 color, float depth) {
  float fog = 1.0 - exp(-pow(uFogDensity * depth, 1.6));
  vec3 fogColor = uFogColor * mix(1.0, 0.45, uNight);
  return mix(color, fogColor, clamp(fog, 0.0, 1.0));
}`;

/** Toon light: two or three flat tones and a lit rim, never a smooth gradient. */
export const TOON_GLSL = /* glsl */ `
vec3 toon(vec3 shade, vec3 mid, vec3 lit, float light) {
  if (light > 0.62) return lit;
  if (light > 0.28) return mid;
  return shade;
}`;

export function hash(index: number): number {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

export function starSprite(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const middle = size / 2;
    const halo = context.createRadialGradient(middle, middle, 0, middle, middle, middle);
    halo.addColorStop(0, "rgba(255,255,255,1)");
    halo.addColorStop(0.1, "rgba(255,255,255,0.95)");
    halo.addColorStop(0.28, "rgba(255,255,255,0.28)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = halo;
    context.fillRect(0, 0, size, size);
    context.globalCompositeOperation = "lighter";
    for (const horizontal of [true, false]) {
      const spike = horizontal
        ? context.createLinearGradient(0, middle, size, middle)
        : context.createLinearGradient(middle, 0, middle, size);
      spike.addColorStop(0, "rgba(255,255,255,0)");
      spike.addColorStop(0.5, "rgba(255,255,255,0.9)");
      spike.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = spike;
      if (horizontal) context.fillRect(0, middle - 1.2, size, 2.4);
      else context.fillRect(middle - 1.2, 0, 2.4, size);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

const POINT_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute float aLift;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
uniform float uLiftScale;
void main() {
  vec3 p = position;
  p.z += aLift * uLiftScale;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.2, -mv.z);
  vAlpha = aAlpha;
  vColor = aColor;
}`;

const POINT_FRAGMENT = /* glsl */ `
uniform sampler2D uSprite;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 texel = texture2D(uSprite, gl_PointCoord);
  gl_FragColor = vec4(vColor * texel.rgb, texel.a * vAlpha);
  #include <colorspace_fragment>
}`;

/**
 * Sprites with a size, colour and brightness each. `aLift` raises a point along local z by
 * `liftScale`: stars ride the terrain as it grows without rewriting their positions.
 */
export class StarField {
  readonly object: Points;
  readonly material: ShaderMaterial;
  readonly count: number;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly sizes: Float32Array;
  private readonly colors: Float32Array;
  private readonly lifts: Float32Array;

  constructor(count: number, sprite: CanvasTexture, scale: number) {
    this.count = count;
    const safe = Math.max(1, count);
    this.positions = new Float32Array(safe * 3);
    this.alphas = new Float32Array(safe);
    this.sizes = new Float32Array(safe);
    this.colors = new Float32Array(safe * 3);
    this.lifts = new Float32Array(safe);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    geometry.setAttribute("aAlpha", new BufferAttribute(this.alphas, 1));
    geometry.setAttribute("aSize", new BufferAttribute(this.sizes, 1));
    geometry.setAttribute("aColor", new BufferAttribute(this.colors, 3));
    geometry.setAttribute("aLift", new BufferAttribute(this.lifts, 1));
    this.material = new ShaderMaterial({
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      uniforms: { uSprite: { value: sprite }, uScale: { value: scale }, uLiftScale: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.object = new Points(geometry, this.material);
    this.object.frustumCulled = false;
  }

  set(index: number, position: Vector3 | [number, number, number], size: number, color: Color, alpha: number, lift = 0) {
    const [x, y, z] = Array.isArray(position) ? position : [position.x, position.y, position.z];
    this.positions[index * 3] = x;
    this.positions[index * 3 + 1] = y;
    this.positions[index * 3 + 2] = z;
    this.sizes[index] = size;
    this.colors[index * 3] = color.r;
    this.colors[index * 3 + 1] = color.g;
    this.colors[index * 3 + 2] = color.b;
    this.alphas[index] = alpha;
    this.lifts[index] = lift;
  }

  alpha(index: number, value: number) {
    this.alphas[index] = value;
  }

  size(index: number, value: number) {
    this.sizes[index] = value;
  }

  move(index: number, x: number, y: number, z: number) {
    this.positions[index * 3] = x;
    this.positions[index * 3 + 1] = y;
    this.positions[index * 3 + 2] = z;
  }

  x(index: number): number {
    return this.positions[index * 3];
  }

  y(index: number): number {
    return this.positions[index * 3 + 1];
  }

  z(index: number): number {
    return this.positions[index * 3 + 2];
  }

  lift(index: number): number {
    return this.lifts[index];
  }

  /** Where the point is drawn now, in the object's own coordinates (lift included). */
  position(index: number, out = new Vector3()): Vector3 {
    const liftScale = this.material.uniforms.uLiftScale.value as number;
    return out.set(this.x(index), this.y(index), this.z(index) + this.lifts[index] * liftScale);
  }

  commit(positions = false) {
    const geometry = this.object.geometry;
    (geometry.getAttribute("aAlpha") as BufferAttribute).needsUpdate = true;
    (geometry.getAttribute("aSize") as BufferAttribute).needsUpdate = true;
    if (positions) (geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

/** Fat lines with a fixed capacity: segments are written in place each frame. */
export class Strokes {
  readonly object: LineSegments2;
  readonly material: LineMaterial;
  private readonly geometry: LineSegmentsGeometry;
  private readonly buffer: Float32Array;
  private readonly capacity: number;

  constructor(color: Color, width: number, opacity = 1, capacity = 64) {
    this.capacity = capacity;
    this.buffer = new Float32Array(capacity * 6);
    this.geometry = new LineSegmentsGeometry();
    this.geometry.setPositions(this.buffer);
    this.material = new LineMaterial({
      color: color.getHex(),
      linewidth: width,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    this.object = new LineSegments2(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.set([]);
  }

  /** Flat list of segment endpoints: x1,y1,z1,x2,y2,z2 per segment. */
  set(segments: number[]) {
    const count = Math.min(this.capacity, Math.floor(segments.length / 6));
    for (let index = 0; index < count * 6; index += 1) this.buffer[index] = segments[index];
    this.geometry.instanceCount = count;
    (this.geometry.getAttribute("instanceStart") as InterleavedBufferAttribute).data.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** A curve that sags (or arcs, with a negative sag) between two points, as segments. */
export function pushCurve(out: number[], from: Vector3, to: Vector3, sag: number, steps = 8) {
  let px = from.x;
  let py = from.y;
  let pz = from.z;
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * sag;
    const z = from.z + (to.z - from.z) * t;
    out.push(px, py, pz, x, y, z);
    px = x;
    py = y;
    pz = z;
  }
}
