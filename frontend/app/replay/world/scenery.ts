/**
 * The evening the replay flies through: a sky dome painted in bands, ridges and a near hill with
 * real volume, a line of utility poles with sagging wires, and layers of cel-shaded clouds at
 * many depths so the camera can pass between them. All procedural, all original.
 */

import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  LineSegments,
  Mesh,
  type PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FOG_GLSL, LINEAR_GLSL, type SharedUniforms, TOON_GLSL, hash } from "./shared";

/** The sun has just set behind the far ridge, a little left of straight ahead. */
export const SUN_DIRECTION = new Vector3(-0.32, 0.06, -1).normalize();

const DOME_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = clip.xyww;
}`;

const DOME_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform float uScene;
uniform vec3 uSun;
varying vec3 vDir;
${LINEAR_GLSL}
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 ramp(float h) {
  vec3 gold = vec3(0.97, 0.73, 0.53);
  vec3 rose = vec3(0.90, 0.53, 0.55);
  vec3 blue = vec3(0.30, 0.36, 0.62);
  vec3 indigo = vec3(0.10, 0.17, 0.40);
  vec3 night = vec3(0.03, 0.06, 0.18);
  if (h < 0.04) return mix(gold, rose, h / 0.04);
  if (h < 0.10) return mix(rose, blue, (h - 0.04) / 0.06);
  if (h < 0.30) return mix(blue, indigo, (h - 0.10) / 0.20);
  return mix(indigo, night, clamp((h - 0.30) / 0.45, 0.0, 1.0));
}
void main() {
  vec3 dir = normalize(vDir);
  float h = max(dir.y, 0.0);
  // Laid in bands like a painting, with edges that wander a little.
  float wobble = (hash21(floor(vec2(atan(dir.z, dir.x) * 40.0, 0.0))) - 0.5) * 0.004;
  float stepped = floor((h + wobble) * 60.0) / 60.0;
  vec3 col = ramp(mix(h, stepped, 0.55));
  float sun = max(dot(dir, uSun), 0.0);
  col += vec3(1.0, 0.68, 0.42) * pow(sun, 18.0) * 0.55 * exp(-h * 9.0);
  col += vec3(1.0, 0.62, 0.45) * pow(sun, 3.0) * 0.12 * exp(-h * 4.0);
  // The first stars, only high up.
  vec2 grid = vec2(atan(dir.z, dir.x), asin(dir.y)) * 180.0;
  vec2 cell = floor(grid);
  float seed = hash21(cell);
  // Round points, not square cells, however close the camera comes.
  float round = smoothstep(0.32, 0.08, length(fract(grid) - 0.5));
  float star = step(0.996, seed) * round * smoothstep(0.18, 0.5, h);
  col += vec3(1.0, 0.95, 0.88) * star * (0.5 + 0.5 * sin(uTime * 1.3 + seed * 90.0)) * (0.35 + uNight);
  col *= mix(1.0, 0.45, uNight);
  if (dir.y < 0.0) col = ramp(0.0) * mix(1.0, 0.45, uNight) * 0.6;
  gl_FragColor = vec4(srgbToLinear(col), uScene);
  #include <colorspace_fragment>
}`;

const LAND_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
varying float vDepth;
varying float vHeight;
uniform float uTop;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vHeight = position.y / uTop;
  vec4 view = viewMatrix * world;
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`;

const LAND_FRAGMENT = /* glsl */ `
uniform vec3 uShade;
uniform vec3 uMid;
uniform vec3 uLit;
uniform vec3 uRim;
uniform vec3 uSun;
uniform float uScene;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vDepth;
varying float vHeight;
${FOG_GLSL}
${TOON_GLSL}
void main() {
  vec3 n = normalize(vNormal);
  vec3 view = normalize(cameraPosition - vWorld);
  float light = dot(n, normalize(vec3(uSun.x, 0.55, uSun.z))) * 0.5 + 0.5;
  vec3 col = toon(uShade, uMid, uLit, light * 0.8 + vHeight * 0.25);
  // The sun behind the hills lights their crests: a thin warm rim.
  float rim = pow(1.0 - max(dot(n, view), 0.0), 3.0) * smoothstep(0.55, 0.95, vHeight);
  col += uRim * step(0.35, rim) * 0.6;
  col *= mix(1.0, 0.6, uNight);
  gl_FragColor = vec4(applyFog(srgbToLinear(col), vDepth), uScene);
  #include <colorspace_fragment>
}`;

const FLAT_VERTEX = /* glsl */ `
varying float vDepth;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`;

const FLAT_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uScene;
varying float vDepth;
${FOG_GLSL}
void main() {
  gl_FragColor = vec4(applyFog(srgbToLinear(uColor), vDepth), uScene);
  #include <colorspace_fragment>
}`;

const CLOUD_VERTEX = /* glsl */ `
varying vec2 vUv;
varying float vDepth;
void main() {
  vUv = uv;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`;

const CLOUD_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uScene;
uniform float uPush;
varying vec2 vUv;
varying float vDepth;
${FOG_GLSL}
void main() {
  vec4 texel = texture2D(uMap, vUv);
  // As night falls the lit tops cool toward moonlight instead of darkening into brown.
  float luma = dot(texel.rgb, vec3(0.3, 0.55, 0.15));
  vec3 col = mix(texel.rgb, srgbToLinear(vec3(0.3, 0.4, 0.66)) * (0.3 + luma), uNight * 0.7) * mix(0.85, 0.42, uNight);
  // Clouds the camera is about to pass through thin out instead of filling the lens.
  float near = smoothstep(1.5, 9.0, vDepth);
  gl_FragColor = vec4(applyFog(col, vDepth * 0.7), texel.a * 0.72 * near * uScene * (1.0 - uPush));
  #include <colorspace_fragment>
}`;

function ridgeProfile(x: number, seed: number, detail: number): number {
  return (
    Math.sin(x * 0.011 + seed) * 0.5 +
    Math.sin(x * 0.027 + seed * 2.3) * 0.28 +
    Math.sin(x * 0.071 + seed * 4.1) * 0.12 * detail +
    Math.sin(x * 0.19 + seed * 7.7) * 0.05 * detail +
    1
  ) / 2;
}

/** A band of land with real slopes: it rises from the lake to a crest, then falls behind. */
function ridge(width: number, depth: number, top: number, seed: number, detail: number): BufferGeometry {
  const geometry = new PlaneGeometry(width, depth, 220, 10);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position") as BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const across = (z / depth + 0.5); // 0 at the back edge, 1 at the front edge
    const crest = Math.sin(Math.PI * Math.min(1, Math.max(0, across * 1.15)));
    position.setY(index, Math.max(0, top * (0.35 + 0.65 * ridgeProfile(x, seed, detail)) * crest - 0.4));
  }
  geometry.computeVertexNormals();
  return geometry;
}

function landMaterial(shared: SharedUniforms, top: number, shade: string, mid: string, lit: string): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: LAND_VERTEX,
    fragmentShader: LAND_FRAGMENT,
    uniforms: {
      ...shared,
      uTop: { value: top },
      uShade: { value: new Vector3(...hex(shade)) },
      uMid: { value: new Vector3(...hex(mid)) },
      uLit: { value: new Vector3(...hex(lit)) },
      uRim: { value: new Vector3(1.0, 0.72, 0.5) },
      uSun: { value: SUN_DIRECTION },
    },
    transparent: true,
  });
}

function hex(value: string): [number, number, number] {
  const number = parseInt(value.slice(1), 16);
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
}

/** A cumulus in three flat tones: slate underside, a middle band, warm lit tops, and a rim. */
function cloudTexture(seed: number): CanvasTexture {
  const width = 256;
  const height = 128;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) {
    const puffs: [number, number, number][] = [];
    const count = 9 + Math.floor(hash(seed) * 6);
    for (let index = 0; index < count; index += 1) {
      const t = index / (count - 1);
      const x = 30 + t * (width - 60) + (hash(seed * 7 + index) - 0.5) * 24;
      const radius = 18 + Math.sin(Math.PI * t) * 30 + hash(seed * 3 + index) * 14;
      const y = height - 22 - radius * 0.55 - hash(seed * 5 + index) * 10;
      puffs.push([x, y, radius]);
    }
    const draw = (color: string, dy: number, grow = 0) => {
      context.fillStyle = color;
      context.beginPath();
      for (const [x, y, radius] of puffs) {
        context.moveTo(x + radius + grow, y + dy);
        context.arc(x, y + dy, radius + grow, 0, Math.PI * 2);
      }
      context.fill();
    };
    // The flat base keeps cumulus bottoms level, as they are in the sky.
    draw("#1f2850", 0);
    context.fillRect(28, height - 40, width - 56, 18);
    context.globalCompositeOperation = "source-atop";
    draw("#4a5680", -10);
    draw("#d4a07c", -24);
    draw("#edc49c", -32, -8);
    context.globalCompositeOperation = "destination-in";
    context.fillStyle = "#fff";
    const fade = context.createLinearGradient(0, 0, width, 0);
    fade.addColorStop(0, "rgba(255,255,255,0)");
    fade.addColorStop(0.1, "rgba(255,255,255,1)");
    fade.addColorStop(0.9, "rgba(255,255,255,1)");
    fade.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = fade;
    context.fillRect(0, 0, width, height);
  }
  // A soft pass so the tone bands read as paint, not as stacked cut-outs.
  const soft = document.createElement("canvas");
  soft.width = width;
  soft.height = height;
  const softContext = soft.getContext("2d");
  if (softContext) {
    softContext.filter = "blur(1.2px)";
    softContext.drawImage(canvas, 0, 0);
  }
  const texture = new CanvasTexture(soft);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

type Cloud = { mesh: Mesh; home: Vector3 };

export class Scenery {
  readonly group = new Group();
  readonly clouds: Cloud[] = [];
  readonly cloudGroup = new Group();
  private readonly cloudMaterials: ShaderMaterial[] = [];
  private readonly textures: CanvasTexture[] = [];

  constructor(shared: SharedUniforms) {
    // --- The sky dome, drawn behind everything.
    const dome = new Mesh(
      new SphereGeometry(450, 48, 24),
      new ShaderMaterial({
        vertexShader: DOME_VERTEX,
        fragmentShader: DOME_FRAGMENT,
        uniforms: { ...shared, uSun: { value: SUN_DIRECTION } },
        side: BackSide,
        depthWrite: false,
        transparent: true,
      }),
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);

    // --- Land at two distances around the whole shore: parallax comes from the gap between them.
    const far = new Mesh(ridge(900, 60, 26, 1.3, 1), landMaterial(shared, 26, "#141d45", "#1d2957", "#2c3a6e"));
    far.position.set(0, 0, -230);
    const mid = new Mesh(ridge(1000, 40, 14, 4.2, 0.8), landMaterial(shared, 14, "#0f1638", "#172150", "#26336a"));
    mid.position.set(0, 0, -120);
    this.group.add(far, mid);

    // --- Utility poles receding to the right, their wires sagging from arm to arm.
    const poleParts: BufferGeometry[] = [];
    const wireSegments: number[] = [];
    const poles: Vector3[] = [];
    for (let index = 0; index < 8; index += 1) {
      const t = index / 7;
      poles.push(new Vector3(10 + t * 70, 0, 3 - t * 150));
    }
    const poleHeight = 9;
    for (const base of poles) {
      const pole = new BoxGeometry(0.22, poleHeight, 0.22);
      pole.translate(base.x, poleHeight / 2, base.z);
      const arm = new BoxGeometry(2.4, 0.14, 0.14);
      arm.translate(base.x, poleHeight - 0.5, base.z);
      const lower = new BoxGeometry(1.8, 0.12, 0.12);
      lower.translate(base.x, poleHeight - 1.3, base.z);
      poleParts.push(pole, arm, lower);
    }
    for (let index = 0; index < poles.length - 1; index += 1) {
      const a = poles[index];
      const b = poles[index + 1];
      for (const [dx, dy] of [[-1.1, -0.5], [1.1, -0.5], [-0.8, -1.3], [0.8, -1.3]]) {
        const from = new Vector3(a.x + dx, poleHeight + dy, a.z);
        const to = new Vector3(b.x + dx, poleHeight + dy, b.z);
        const sag = from.distanceTo(to) * 0.035;
        const steps = 14;
        for (let step = 0; step < steps; step += 1) {
          const t0 = step / steps;
          const t1 = (step + 1) / steps;
          const p0 = from.clone().lerp(to, t0);
          const p1 = from.clone().lerp(to, t1);
          p0.y -= Math.sin(Math.PI * t0) * sag;
          p1.y -= Math.sin(Math.PI * t1) * sag;
          wireSegments.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        }
      }
    }
    // The wires lead in from beyond the frame on the near side too.
    for (const [dx, dy] of [[-1.1, -0.5], [1.1, -0.5]]) {
      const from = new Vector3(poles[0].x + dx - 4, poleHeight + dy - 3.5, poles[0].z + 40);
      const to = new Vector3(poles[0].x + dx, poleHeight + dy, poles[0].z);
      for (let step = 0; step < 10; step += 1) {
        const p0 = from.clone().lerp(to, step / 10);
        const p1 = from.clone().lerp(to, (step + 1) / 10);
        wireSegments.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      }
    }
    const flat = (color: string) =>
      new ShaderMaterial({
        vertexShader: FLAT_VERTEX,
        fragmentShader: FLAT_FRAGMENT,
        uniforms: { ...shared, uColor: { value: new Vector3(...hex(color)) } },
        transparent: true,
      });
    const poleGeometry = mergeGeometries(poleParts);
    poleParts.forEach((part) => part.dispose());
    if (poleGeometry) this.group.add(new Mesh(poleGeometry, flat("#0b0a20")));
    const wires = new BufferGeometry();
    wires.setAttribute("position", new BufferAttribute(new Float32Array(wireSegments), 3));
    this.group.add(new LineSegments(wires, flat("#0b0a20")));

    // --- Clouds in layers: a far bank, a middle layer the camera climbs through, high wisps.
    for (let variant = 0; variant < 5; variant += 1) this.textures.push(cloudTexture(variant * 13 + 3));
    const layers: { count: number; x: [number, number]; y: [number, number]; z: [number, number]; size: [number, number] }[] = [
      { count: 16, x: [-320, 320], y: [16, 42], z: [-150, -300], size: [60, 120] },
      { count: 12, x: [-120, 120], y: [12, 26], z: [-40, -120], size: [24, 46] },
      { count: 10, x: [-40, 40], y: [26, 62], z: [-10, 34], size: [12, 22] },
      { count: 8, x: [-160, 160], y: [58, 68], z: [-40, -200], size: [40, 80] },
    ];
    let seed = 1;
    for (const layer of layers) {
      for (let index = 0; index < layer.count; index += 1) {
        seed += 1;
        const size = layer.size[0] + hash(seed * 1.7) * (layer.size[1] - layer.size[0]);
        const material = new ShaderMaterial({
          vertexShader: CLOUD_VERTEX,
          fragmentShader: CLOUD_FRAGMENT,
          uniforms: { ...shared, uMap: { value: this.textures[seed % this.textures.length] }, uPush: { value: 0 } },
          transparent: true,
          depthWrite: false,
        });
        this.cloudMaterials.push(material);
        const mesh = new Mesh(new PlaneGeometry(size, size / 2), material);
        const home = new Vector3(
          layer.x[0] + hash(seed * 3.1) * (layer.x[1] - layer.x[0]),
          layer.y[0] + hash(seed * 5.3) * (layer.y[1] - layer.y[0]),
          layer.z[0] + hash(seed * 7.9) * (layer.z[1] - layer.z[0]),
        );
        mesh.position.copy(home);
        this.cloudGroup.add(mesh);
        this.clouds.push({ mesh, home });
      }
    }
    this.group.add(this.cloudGroup);
  }

  /**
   * Clouds always face the camera and drift with the wind. A shockwave ring (centre, radius,
   * strength) pushes every cloud it has passed outward, and they settle back as it fades.
   */
  update(camera: PerspectiveCamera, time: number, wind: number, shock: { x: number; z: number; radius: number; strength: number } | null) {
    this.clouds.forEach(({ mesh, home }, index) => {
      mesh.quaternion.copy(camera.quaternion);
      mesh.position.x = home.x + Math.sin(time * 0.02 + index) * 3 + time * wind * (0.5 + hash(index) * 0.5);
      mesh.position.z = home.z;
      if (shock && shock.strength > 0) {
        const dx = home.x - shock.x;
        const dz = home.z - shock.z;
        const distance = Math.hypot(dx, dz) || 1;
        const passed = Math.min(1, Math.max(0, (shock.radius - distance) / 25));
        const push = 14 * passed * shock.strength;
        mesh.position.x += (dx / distance) * push;
        mesh.position.z += (dz / distance) * push;
      }
    });
  }

  dispose() {
    this.group.traverse((object) => {
      if (object instanceof Mesh || object instanceof LineSegments) {
        object.geometry.dispose();
        (object.material as ShaderMaterial).dispose();
      }
    });
    this.textures.forEach((texture) => texture.dispose());
  }
}
