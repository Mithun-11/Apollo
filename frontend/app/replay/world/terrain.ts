/**
 * The recording's spectrogram as swells on the lake. In its own coordinates x is time, y is
 * pitch and z is loudness. Standing up (tilt 0) it is exactly the sky painted while listening;
 * laid onto the lake (tilt 1) its loudness rises as rolling swells of water, pitch becomes depth,
 * and quiet stretches sink back into the lake itself. The heights are displaced on the GPU from
 * the real spectrogram, so revealing, growing, stretching and roughening it are uniforms, never
 * geometry rebuilds.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
} from "three";
import { MAX_FREQUENCY_HZ, MIN_FREQUENCY_HZ, clamp01 } from "../../sky/geometry";
import { SUN_DIRECTION } from "./scenery";
import { FIELD_BASE, FIELD_DEPTH, FIELD_WIDTH, FOG_GLSL, LINEAR_GLSL, type SharedUniforms, TERRAIN_HEIGHT } from "./shared";

const TERRAIN_VERTEX = /* glsl */ `
uniform sampler2D uLevels;
uniform vec2 uTexel;
uniform float uHeight;
uniform float uGrow;
uniform float uReveal;
uniform float uNoise;
uniform float uTime;
uniform vec2 uMargin;
varying vec3 vWorld;
varying vec3 vWorldNormal;
varying float vLevel;
varying float vMask;
varying float vRise;
varying float vDepth;
varying float vInside;
/** Mesh uv (margins included) to data uv, where 0 to 1 covers the recording. */
vec2 dataUv(vec2 meshUv) { return meshUv * (1.0 + 2.0 * uMargin) - uMargin; }
/** 1 inside the recording, easing to 0 across the margin. */
float edge(vec2 d) {
  return smoothstep(-uMargin.x, 0.02, d.x) * smoothstep(1.0 + uMargin.x, 0.98, d.x)
    * smoothstep(-uMargin.y, 0.1, d.y) * smoothstep(1.0 + uMargin.y, 0.9, d.y);
}
float level(vec2 d) { return texture2D(uLevels, clamp(d, 0.0, 1.0)).r * edge(d); }
float mask(float x) { return smoothstep(uReveal + 0.004, uReveal - 0.004, x); }
float heightAt(vec2 uv) {
  float l = level(uv);
  // Small waves travel across the swells, livelier where the sound is louder.
  float ripple = sin(uv.x * 140.0 - uTime * 1.7) * sin(uv.y * 60.0 + uTime * 1.1) * 0.022 * (0.35 + l)
    + sin(uv.x * 38.0 + uv.y * 21.0 - uTime * 0.9) * 0.018;
  // Storm chop: smooth, fast, choppy waves on top of the swells, never spikes.
  float chop = uNoise * (sin(uv.x * 260.0 + uTime * 5.3) * sin(uv.y * 150.0 - uTime * 4.1) * 0.09
    + sin(uv.x * 97.0 - uv.y * 71.0 + uTime * 3.2) * 0.07);
  return (pow(l, 1.6) * uHeight + (ripple + chop) * edge(uv)) * uGrow * mask(uv.x);
}
void main() {
  vec2 d = dataUv(uv);
  float h = heightAt(d);
  float hx = heightAt(d + vec2(uTexel.x, 0.0)) - heightAt(d - vec2(uTexel.x, 0.0));
  float hy = heightAt(d + vec2(0.0, uTexel.y)) - heightAt(d - vec2(0.0, uTexel.y));
  vec3 localNormal = normalize(vec3(-hx / (2.0 * uTexel.x * ${FIELD_WIDTH.toFixed(1)}), -hy / (2.0 * uTexel.y * ${FIELD_DEPTH.toFixed(1)}), 1.0));
  vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
  vLevel = level(d);
  vMask = mask(d.x);
  vInside = step(0.0, d.x) * step(d.x, 1.0) * step(0.0, d.y) * step(d.y, 1.0);
  vRise = h / max(uHeight, 0.001);
  vec4 world = modelMatrix * vec4(position + vec3(0.0, 0.0, max(h, 0.0)), 1.0);
  vWorld = world.xyz;
  vec4 view = viewMatrix * world;
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`;

const TERRAIN_FRAGMENT = /* glsl */ `
uniform float uSolid;
uniform float uOpacity;
uniform float uNoise;
uniform float uTime;
uniform vec3 uSun;
varying vec3 vWorld;
varying vec3 vWorldNormal;
varying float vLevel;
varying float vMask;
varying float vRise;
varying float vDepth;
varying float vInside;
${FOG_GLSL}
/** The evening sky the water reflects: gold at the horizon, rose, then deep blue. */
vec3 skyAt(float h) {
  vec3 gold = vec3(0.97, 0.73, 0.53);
  vec3 rose = vec3(0.86, 0.52, 0.5);
  vec3 blue = vec3(0.24, 0.32, 0.6);
  vec3 night = vec3(0.05, 0.08, 0.2);
  if (h < 0.05) return mix(gold, rose, h / 0.05);
  if (h < 0.18) return mix(rose, blue, (h - 0.05) / 0.13);
  return mix(blue, night, clamp((h - 0.18) / 0.5, 0.0, 1.0));
}
void main() {
  float level = vLevel;
  // Standing: the live sky's paint (haze, then rose, then warm white at the loudest).
  float warm = min(1.0, level * 1.25);
  vec3 paint = vec3(150.0 + 105.0 * warm, 110.0 + 135.0 * warm * warm, 190.0 + 40.0 * warm) / 255.0;
  float paintAlpha = level <= 0.05 ? 0.0 : min(1.0, level * level * 1.6);

  // Laid down: water. A dark body, the sky mirrored at grazing angles, the sun glinting off crests.
  vec3 n = normalize(vWorldNormal);
  vec3 view = normalize(cameraPosition - vWorld);
  float fresnel = pow(1.0 - max(dot(n, view), 0.0), 3.0);
  vec3 mirrored = reflect(-view, n);
  vec3 sky = skyAt(max(mirrored.y, 0.0)) * mix(1.0, 0.5, uNight);
  vec3 deep = vec3(0.03, 0.06, 0.15);
  vec3 water = mix(deep, sky, 0.12 + 0.7 * fresnel);
  float glint = pow(max(dot(mirrored, normalize(uSun)), 0.0), 70.0);
  water += vec3(1.0, 0.78, 0.55) * glint * 0.9;
  // Loud swells glow from within, cold blue rising to moonlit white, always dimmer than the stars.
  vec3 glowColor = mix(vec3(0.16, 0.34, 0.72), vec3(0.82, 0.9, 1.0), smoothstep(0.55, 0.95, level));
  water += glowColor * pow(level, 1.8) * 0.5;
  water += vec3(0.5, 0.58, 0.8) * uNoise * 0.1;

  vec3 col = mix(paint, water, uSolid);
  // Quiet water sinks back into the lake instead of ending in an edge.
  float emerge = smoothstep(0.01, 0.1, vRise);
  float alpha = mix(paintAlpha * vMask * vInside, 0.95 * emerge, uSolid) * uOpacity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(applyFog(srgbToLinear(col), vDepth), alpha);
  #include <colorspace_fragment>
}`;

const BEAM_VERTEX = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const BEAM_FRAGMENT = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
varying vec3 vLocal;
${LINEAR_GLSL}
void main() {
  float across = 1.0 - smoothstep(0.0, 0.07, abs(vLocal.x));
  float ends = smoothstep(3.5, 2.9, abs(vLocal.y));
  float up = smoothstep(1.4, 0.0, vLocal.z + 0.7);
  gl_FragColor = vec4(srgbToLinear(uColor), uOpacity * across * ends * (0.35 + 0.65 * up));
  #include <colorspace_fragment>
}`;

/** Soften the spectrogram into rolling ridges: a small box blur, twice, across time and pitch. */
function smooth(columns: Float32Array[]): Float32Array[] {
  let current = columns.map((column) => Float32Array.from(column));
  const count = current.length;
  const rows = current[0]?.length ?? 0;
  // The blur spans a fixed share of the field, so a long, busy clip rolls as gently as a short one.
  const across = Math.max(2, Math.round(count / 70));
  for (let pass = 0; pass < 2; pass += 1) {
    const next = current.map((column) => new Float32Array(column.length));
    for (let column = 0; column < count; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        let sum = 0;
        let weight = 0;
        for (let dc = -across; dc <= across; dc += 1) {
          const c = column + dc;
          if (c < 0 || c >= count) continue;
          for (let dr = -5; dr <= 5; dr += 1) {
            const r = row + dr;
            if (r < 0 || r >= rows) continue;
            sum += current[c][r];
            weight += 1;
          }
        }
        next[column][row] = sum / weight;
      }
    }
    current = next;
  }
  // Blurring lowers the peaks; lift them back so the loudest ridges still reach full height.
  let highest = 0;
  for (const column of current) for (const value of column) highest = Math.max(highest, value);
  const gain = highest > 0 ? 0.95 / highest : 1;
  return current.map((column) => column.map((value) => Math.min(1, value * gain)));
}

/** How far the water mesh reaches past the recording, as a fraction of its width and depth. */
const MARGIN_X = 0.14;
const MARGIN_Y = 0.4;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export class SoundField {
  /** Hinged at the lake line: rotation.x = -tilt × 90°. */
  readonly group = new Group();
  readonly terrain: Mesh;
  readonly material: ShaderMaterial;
  readonly beam: Mesh;
  private readonly beamMaterial: ShaderMaterial;
  private readonly texture: DataTexture;
  private readonly levels: Float32Array[];
  private readonly duration: number;
  private readonly light = new Vector3();

  constructor(shared: SharedUniforms, columnLevels: Float32Array[], duration: number) {
    this.levels = smooth(columnLevels);
    this.duration = duration;
    const columns = Math.max(1, columnLevels.length);
    const rows = columnLevels[0]?.length ?? 1;
    // Texture row 0 is the lowest pitch; the painted sky's row 0 is the highest.
    const bytes = new Uint8Array(columns * rows);
    for (let column = 0; column < columnLevels.length; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        bytes[(rows - 1 - row) * columns + column] = Math.round(clamp01(this.levels[column][row]) * 255);
      }
    }
    this.texture = new DataTexture(bytes, columns, rows, RedFormat, UnsignedByteType);
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.needsUpdate = true;

    this.group.position.set(0, FIELD_BASE, 0);
    const geometry = new PlaneGeometry(
      FIELD_WIDTH * (1 + 2 * MARGIN_X),
      FIELD_DEPTH * (1 + 2 * MARGIN_Y),
      Math.round(Math.min(320, columns) * (1 + 2 * MARGIN_X)),
      Math.round(Math.min(200, rows) * (1 + 2 * MARGIN_Y)),
    );
    geometry.translate(0, FIELD_DEPTH / 2, 0);
    this.material = new ShaderMaterial({
      vertexShader: TERRAIN_VERTEX,
      fragmentShader: TERRAIN_FRAGMENT,
      uniforms: {
        ...shared,
        uLevels: { value: this.texture },
        uTexel: { value: new Vector2(1 / columns, 1 / rows) },
        uMargin: { value: new Vector2(MARGIN_X, MARGIN_Y) },
        uHeight: { value: TERRAIN_HEIGHT },
        uGrow: { value: 0 },
        uReveal: { value: 1.01 },
        uNoise: { value: 0 },
        uSolid: { value: 0 },
        uOpacity: { value: 1 },
        uLight: { value: this.light },
        uSun: { value: SUN_DIRECTION },
      },
      transparent: true,
      depthWrite: false,
    });
    this.terrain = new Mesh(geometry, this.material);
    this.terrain.frustumCulled = false;
    this.group.add(this.terrain);

    this.beamMaterial = new ShaderMaterial({
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      uniforms: { uOpacity: { value: 0 }, uColor: { value: new Vector3(1.0, 0.79, 0.54) } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.beam = new Mesh(new BoxGeometry(0.16, FIELD_DEPTH, TERRAIN_HEIGHT + 0.6), this.beamMaterial);
    this.beam.position.set(0, FIELD_DEPTH / 2, (TERRAIN_HEIGHT + 0.6) / 2 - 0.3);
    this.group.add(this.beam);
  }

  // --- Coordinates in the field's own frame ------------------------------------------------------

  x(seconds: number): number {
    return -FIELD_WIDTH / 2 + (FIELD_WIDTH * seconds) / Math.max(this.duration, 0.001);
  }

  y(hz: number): number {
    const low = Math.log(MIN_FREQUENCY_HZ);
    const high = Math.log(MAX_FREQUENCY_HZ);
    const clamped = Math.min(MAX_FREQUENCY_HZ, Math.max(MIN_FREQUENCY_HZ, hz));
    return (FIELD_DEPTH * (Math.log(clamped) - low)) / (high - low);
  }

  /** The terrain's full-grown height (0 to 1 of TERRAIN_HEIGHT) under a moment and a pitch. */
  level(seconds: number, hz: number): number {
    const columns = this.levels.length;
    if (columns === 0) return 0;
    const rows = this.levels[0].length;
    const column = Math.min(columns - 1, Math.max(0, Math.round((seconds / Math.max(this.duration, 0.001)) * (columns - 1))));
    const fromTop = 1 - this.y(hz) / FIELD_DEPTH;
    const row = Math.min(rows - 1, Math.max(0, Math.round(fromTop * (rows - 1))));
    const u = seconds / Math.max(this.duration, 0.001);
    const v = this.y(hz) / FIELD_DEPTH;
    const edge =
      smoothstep(-MARGIN_X, 0.02, u) * smoothstep(1 + MARGIN_X, 0.98, u) * smoothstep(-MARGIN_Y, 0.1, v) * smoothstep(1 + MARGIN_Y, 0.9, v);
    return Math.pow(clamp01(this.levels[column][row] * edge), 1.6);
  }

  // --- State -----------------------------------------------------------------------------------

  /** tilt: 0 standing sky, 1 laid on the lake. grow: how far loudness has risen into height. */
  pose(tilt: number, grow: number) {
    this.group.rotation.x = (-Math.PI / 2) * tilt;
    this.group.position.y = FIELD_BASE * (1 - tilt) + 0.02 * tilt;
    this.material.uniforms.uGrow.value = grow;
    this.material.uniforms.uSolid.value = tilt;
    this.material.depthWrite = tilt > 0.6;
  }

  get grow(): number {
    return this.material.uniforms.uGrow.value as number;
  }

  reveal(fraction: number) {
    this.material.uniforms.uReveal.value = fraction;
  }

  opacity(value: number) {
    this.material.uniforms.uOpacity.value = value;
  }

  noise(value: number) {
    this.material.uniforms.uNoise.value = value;
  }

  beamAt(fraction: number, opacity: number) {
    this.beam.position.x = -FIELD_WIDTH / 2 + FIELD_WIDTH * fraction;
    this.beamMaterial.uniforms.uOpacity.value = opacity;
  }

  /** The light direction in the field's own frame (it turns as the field tilts). */
  lightFrom(world: Vector3) {
    this.light.copy(world).applyQuaternion(this.group.quaternion.clone().invert());
  }

  dispose() {
    this.terrain.geometry.dispose();
    this.material.dispose();
    this.beam.geometry.dispose();
    this.beamMaterial.dispose();
    this.texture.dispose();
  }
}
