/**
 * The transformations between beats, each driven on the GPU from measured data:
 * the waveform shattering into the sky it becomes, a meteor storm of catalog lookups,
 * glowing volumes of air, and curtains of light standing on the lake.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  type CanvasTexture,
  type Color,
  LineSegments,
  Mesh,
  Points,
  ShaderMaterial,
  type Vector3,
} from "three";
import { hash } from "./shared";

// --- The shatter: each spark leaves the waveform and lands in the sky at its own moment ----------

const SHATTER_VERTEX = /* glsl */ `
attribute vec3 aFrom;
attribute vec3 aTo;
attribute float aLaunch;
attribute float aSeed;
uniform float uClock;
uniform float uFlight;
uniform float uScale;
varying float vAlpha;
void main() {
  float p = clamp((uClock - aLaunch) / uFlight, 0.0, 1.0);
  float eased = p * p * (3.0 - 2.0 * p);
  // A burst outward first, then a curved flight up into place.
  vec3 burst = vec3(sin(aSeed * 91.0), cos(aSeed * 57.0), sin(aSeed * 33.0)) * 0.9;
  vec3 position = mix(aFrom, aTo, eased) + burst * sin(3.14159 * p) + vec3(0.0, sin(3.14159 * p) * 0.8, 0.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.8 + aSeed * 1.2) * uScale / max(0.3, -mv.z);
  // Visible only in flight: waiting sparks are still part of the wave, landed ones are the sky.
  vAlpha = step(0.001, p) * (1.0 - smoothstep(0.85, 1.0, p));
}`;

const SPARK_FRAGMENT = /* glsl */ `
uniform sampler2D uSprite;
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vec4 texel = texture2D(uSprite, gl_PointCoord);
  gl_FragColor = vec4(uColor * texel.rgb, texel.a * vAlpha * uOpacity);
  #include <colorspace_fragment>
}`;

export class Shatter {
  readonly object: Points;
  private readonly material: ShaderMaterial;

  /** `sparks`: where each one starts (on the wave), lands (in the sky) and when it leaves. */
  constructor(sparks: { from: Vector3; to: Vector3; launch: number }[], sprite: CanvasTexture, color: Color) {
    const count = Math.max(1, sparks.length);
    const from = new Float32Array(count * 3);
    const to = new Float32Array(count * 3);
    const launch = new Float32Array(count);
    const seed = new Float32Array(count);
    sparks.forEach((spark, index) => {
      from.set([spark.from.x, spark.from.y, spark.from.z], index * 3);
      to.set([spark.to.x, spark.to.y, spark.to.z], index * 3);
      launch[index] = spark.launch;
      seed[index] = hash(index * 1.7);
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(from.slice(), 3));
    geometry.setAttribute("aFrom", new BufferAttribute(from, 3));
    geometry.setAttribute("aTo", new BufferAttribute(to, 3));
    geometry.setAttribute("aLaunch", new BufferAttribute(launch, 1));
    geometry.setAttribute("aSeed", new BufferAttribute(seed, 1));
    this.material = new ShaderMaterial({
      vertexShader: SHATTER_VERTEX,
      fragmentShader: SPARK_FRAGMENT,
      uniforms: {
        uClock: { value: -1 },
        uFlight: { value: 0.9 },
        uScale: { value: 120 },
        uSprite: { value: sprite },
        uColor: { value: color },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.object = new Points(geometry, this.material);
    this.object.frustumCulled = false;
  }

  /** `clock`: seconds on the sparks' own timeline; `opacity` 0 hides them entirely. */
  update(clock: number, opacity: number) {
    this.material.uniforms.uClock.value = clock;
    this.material.uniforms.uOpacity.value = opacity;
    this.object.visible = opacity > 0.001;
  }

  dispose() {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

// --- The meteor storm: every lookup a streak with a fading tail --------------------------------

const METEOR_VERTEX = /* glsl */ `
attribute vec3 aFrom;
attribute vec3 aTo;
attribute float aDelay;
attribute float aSeed;
attribute float aHead;
uniform float uClock;
uniform float uCycle;
varying float vAlpha;
vec3 path(float p) {
  vec3 point = mix(aFrom, aTo, p * p * (3.0 - 2.0 * p));
  point.x += sin(3.14159 * p) * (aSeed - 0.5) * 34.0;
  point.z += sin(3.14159 * p) * (fract(aSeed * 7.3) - 0.5) * 20.0;
  return point;
}
void main() {
  float cycle = mod(uClock - aDelay, uCycle);
  float p = cycle / 1.5;
  float live = step(0.0, uClock - aDelay) * step(p, 1.0);
  // The tail trails the head along the same path.
  float at = clamp(p - (1.0 - aHead) * 0.09, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(path(at), 1.0);
  gl_Position = projectionMatrix * mv;
  vAlpha = live * mix(0.0, 1.0, aHead) * (1.0 - smoothstep(0.9, 1.0, p));
}`;

const METEOR_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor, vAlpha * uOpacity);
  #include <colorspace_fragment>
}`;

export class Meteors {
  readonly object: LineSegments;
  private readonly material: ShaderMaterial;

  constructor(streaks: { from: Vector3; to: Vector3; delay: number }[], color: Color) {
    const count = Math.max(1, streaks.length);
    const from = new Float32Array(count * 6);
    const to = new Float32Array(count * 6);
    const delay = new Float32Array(count * 2);
    const seed = new Float32Array(count * 2);
    const head = new Float32Array(count * 2);
    streaks.forEach((streak, index) => {
      for (let end = 0; end < 2; end += 1) {
        const vertex = index * 2 + end;
        from.set([streak.from.x, streak.from.y, streak.from.z], vertex * 3);
        to.set([streak.to.x, streak.to.y, streak.to.z], vertex * 3);
        delay[vertex] = streak.delay;
        seed[vertex] = hash(index * 3.9);
        head[vertex] = end;
      }
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(from.slice(), 3));
    geometry.setAttribute("aFrom", new BufferAttribute(from, 3));
    geometry.setAttribute("aTo", new BufferAttribute(to, 3));
    geometry.setAttribute("aDelay", new BufferAttribute(delay, 1));
    geometry.setAttribute("aSeed", new BufferAttribute(seed, 1));
    geometry.setAttribute("aHead", new BufferAttribute(head, 1));
    this.material = new ShaderMaterial({
      vertexShader: METEOR_VERTEX,
      fragmentShader: METEOR_FRAGMENT,
      uniforms: { uClock: { value: -1 }, uCycle: { value: 5 }, uColor: { value: color }, uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.object = new LineSegments(geometry, this.material);
    this.object.frustumCulled = false;
  }

  update(clock: number, opacity: number) {
    this.material.uniforms.uClock.value = clock;
    this.material.uniforms.uOpacity.value = opacity;
    this.object.visible = opacity > 0.001;
  }

  dispose() {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

// --- A glowing volume of air (the fingerprint's target zone) -----------------------------------

const VOLUME_VERTEX = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const VOLUME_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vLocal;
void main() {
  // Brightest along the faces' edges, a faint haze inside: it reads as a lit box of air.
  vec3 d = abs(vLocal) * 2.0;
  float edge = max(max(min(d.x, d.y), min(d.y, d.z)), min(d.x, d.z));
  float glow = 0.12 + 0.88 * smoothstep(0.86, 1.0, edge);
  gl_FragColor = vec4(uColor, glow * uOpacity);
  #include <colorspace_fragment>
}`;

export class GlowVolume {
  readonly object: Mesh;
  private readonly material: ShaderMaterial;

  constructor(color: Color) {
    this.material = new ShaderMaterial({
      vertexShader: VOLUME_VERTEX,
      fragmentShader: VOLUME_FRAGMENT,
      uniforms: { uColor: { value: color }, uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.object = new Mesh(new BoxGeometry(1, 1, 1), this.material);
    this.object.visible = false;
  }

  /** Spans the box between two corners (in the parent's frame). */
  span(a: Vector3, b: Vector3, opacity: number) {
    this.object.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    this.object.scale.set(Math.max(0.001, Math.abs(b.x - a.x)), Math.max(0.001, Math.abs(b.y - a.y)), Math.max(0.001, Math.abs(b.z - a.z)));
    this.material.uniforms.uOpacity.value = opacity;
    this.object.visible = opacity > 0.001;
  }

  dispose() {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

// --- A curtain of light hanging from a line down to a base ---------------------------------------

const CURTAIN_VERTEX = /* glsl */ `
attribute float aTop;
varying float vTop;
void main() {
  vTop = aTop;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CURTAIN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vTop;
void main() {
  gl_FragColor = vec4(uColor, pow(vTop, 2.2) * uOpacity);
  #include <colorspace_fragment>
}`;

export class Curtain {
  readonly object: Mesh;
  private readonly material: ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly capacity: number;

  constructor(color: Color, capacity: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 2 * 3);
    const top = new Float32Array(capacity * 2);
    const indices: number[] = [];
    for (let index = 0; index < capacity; index += 1) {
      top[index * 2] = 1;
      top[index * 2 + 1] = 0;
      if (index < capacity - 1) {
        const a = index * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    geometry.setAttribute("aTop", new BufferAttribute(top, 1));
    geometry.setIndex(indices);
    this.material = new ShaderMaterial({
      vertexShader: CURTAIN_VERTEX,
      fragmentShader: CURTAIN_FRAGMENT,
      uniforms: { uColor: { value: color }, uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: 2,
    });
    this.object = new Mesh(geometry, this.material);
    this.object.frustumCulled = false;
    this.object.visible = false;
  }

  /** Hang the curtain from `line` (x, y, z triples) straight down to height `base`. */
  set(line: number[], base: number, opacity: number) {
    const points = Math.min(this.capacity, Math.floor(line.length / 3));
    for (let index = 0; index < points; index += 1) {
      const [x, y, z] = [line[index * 3], line[index * 3 + 1], line[index * 3 + 2]];
      this.positions.set([x, y, z, x, base, z], index * 6);
    }
    const geometry = this.object.geometry;
    (geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
    geometry.setDrawRange(0, Math.max(0, points - 1) * 6);
    this.material.uniforms.uOpacity.value = opacity;
    this.object.visible = opacity > 0.001 && points > 1;
  }

  dispose() {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
