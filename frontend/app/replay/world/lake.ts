/**
 * The still lake: a real planar reflection of the sky, the hills, the stars and the threads,
 * broken by slow ripples, with room for shockwave rings racing across it. Only objects on the
 * REFLECTED layer are drawn into the reflection, at a reduced resolution, to keep it cheap.
 */

import { Color, type Object3D, PlaneGeometry, type ShaderMaterial, Vector4 } from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { FOG_GLSL, type SharedUniforms } from "./shared";

export const REFLECTED_LAYER = 1;
export const MAX_RINGS = 4;

const WATER_VERTEX = /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vUv;
varying vec3 vWorld;
varying float vDepth;
void main() {
  vUv = textureMatrix * vec4(position, 1.0);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 view = viewMatrix * world;
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`;

const WATER_FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uScene;
uniform vec4 uRings[${MAX_RINGS}];
varying vec4 vUv;
varying vec3 vWorld;
varying float vDepth;
${FOG_GLSL}
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 p = vWorld.xz;
  // Slow ripples: long swells plus a fine shiver, strongest near the viewer.
  float swell = noise(p * vec2(0.25, 0.9) + vec2(uTime * 0.12, 0.0)) - 0.5;
  float shiver = noise(p * vec2(1.6, 5.0) - vec2(0.0, uTime * 0.5)) - 0.5;
  vec2 offset = vec2(swell * 0.8 + shiver * 0.35, shiver * 0.6) * 0.018;
  float rings = 0.0;
  for (int i = 0; i < ${MAX_RINGS}; i++) {
    vec4 ring = uRings[i];
    if (ring.w <= 0.0) continue;
    float d = distance(p, ring.xy) - ring.z;
    float band = exp(-d * d * 1.8) * ring.w;
    rings += band;
    offset += normalize(p - ring.xy + 1e-4) * band * 0.03;
  }
  vec4 uv = vUv;
  uv.xy += offset * uv.w;
  vec3 reflection = texture2DProj(tDiffuse, uv).rgb;
  vec3 view = normalize(cameraPosition - vWorld);
  float fresnel = pow(1.0 - max(view.y, 0.0), 2.2);
  vec3 deep = color * mix(1.0, 0.55, uNight);
  vec3 col = mix(deep, reflection, 0.32 + 0.5 * fresnel);
  // Glints where the ripples catch the last light.
  col += srgbToLinear(vec3(1.0, 0.78, 0.56)) * step(0.92, noise(p * vec2(3.0, 14.0) + uTime * 0.2)) * 0.12 * (1.0 - uNight * 0.6);
  col += vec3(1.0, 0.92, 0.85) * rings * 0.9;
  gl_FragColor = vec4(applyFog(col, vDepth * 0.6), uScene);
  #include <colorspace_fragment>
}`;

export class Lake {
  readonly mesh: Reflector;
  private readonly rings: Vector4[];

  constructor(shared: SharedUniforms, width: number, height: number) {
    this.rings = Array.from({ length: MAX_RINGS }, () => new Vector4(0, 0, 0, 0));
    this.mesh = new Reflector(new PlaneGeometry(1200, 1200), {
      color: new Color("#0b1233"),
      textureWidth: Math.max(256, Math.round(width * 0.5)),
      textureHeight: Math.max(256, Math.round(height * 0.5)),
      clipBias: 0.003,
      multisample: 0,
      shader: {
        name: "ApolloLake",
        uniforms: {
          color: { value: null },
          tDiffuse: { value: null },
          textureMatrix: { value: null },
        },
        vertexShader: WATER_VERTEX,
        fragmentShader: WATER_FRAGMENT,
      },
    });
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = -5;
    // The reflection camera sees only what should shimmer in the water.
    this.mesh.camera.layers.set(REFLECTED_LAYER);
    const material = this.mesh.material as ShaderMaterial;
    material.transparent = true;
    Object.assign(material.uniforms, shared, { uRings: { value: this.rings } });
    // Skip the second render entirely while the 3D world is still hidden.
    const reflect = this.mesh.onBeforeRender.bind(this.mesh);
    this.mesh.onBeforeRender = (...args) => {
      if (shared.uScene.value > 0.01) reflect(...args);
    };
  }

  /** Set a ring racing outward from (x, z): radius in metres, strength 0 to 1 (0 hides it). */
  ring(index: number, x: number, z: number, radius: number, strength: number) {
    this.rings[index]?.set(x, z, radius, strength);
  }

  dispose() {
    this.mesh.dispose();
    this.mesh.geometry.dispose();
  }
}

/** Mark an object (and its children) to appear in the lake's reflection. */
export function reflect(object: Object3D) {
  object.traverse((child) => child.layers.enable(REFLECTED_LAYER));
}
