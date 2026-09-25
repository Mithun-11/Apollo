/**
 * Rain for the noise storm: streaks falling through a box of air, slanted by the wind,
 * animated entirely on the GPU.
 */

import { AdditiveBlending, BufferAttribute, BufferGeometry, type Color, LineSegments, ShaderMaterial } from "three";
import { hash } from "./shared";

const RAIN_VERTEX = /* glsl */ `
attribute vec3 aStart;
attribute float aSpeed;
attribute float aTail;
uniform float uClock;
uniform float uHeight;
uniform float uWind;
varying float vTail;
void main() {
  float fall = mod(aStart.y - uClock * aSpeed, uHeight);
  vec3 p = vec3(aStart.x + (uHeight - fall) * uWind, fall, aStart.z);
  // The tail sits a little above and upwind of the head, so each drop is a short streak.
  p += aTail * vec3(-uWind, 1.0, 0.0) * 0.045 * aSpeed;
  vTail = aTail;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const RAIN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vTail;
void main() {
  gl_FragColor = vec4(uColor, (1.0 - vTail) * uOpacity);
  #include <colorspace_fragment>
}`;

export class Rain {
  readonly object: LineSegments;
  private readonly material: ShaderMaterial;

  /** Drops fill the box from (x0, 0, z0) to (x1, height, z1). */
  constructor(count: number, x0: number, x1: number, z0: number, z1: number, height: number, color: Color) {
    const start = new Float32Array(count * 6);
    const speed = new Float32Array(count * 2);
    const tail = new Float32Array(count * 2);
    for (let index = 0; index < count; index += 1) {
      const x = x0 + hash(index * 1.9) * (x1 - x0);
      const y = hash(index * 4.3) * height;
      const z = z0 + hash(index * 7.1) * (z1 - z0);
      const v = 9 + hash(index * 2.6) * 6;
      for (let end = 0; end < 2; end += 1) {
        start.set([x, y, z], (index * 2 + end) * 3);
        speed[index * 2 + end] = v;
        tail[index * 2 + end] = end;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(start.slice(), 3));
    geometry.setAttribute("aStart", new BufferAttribute(start, 3));
    geometry.setAttribute("aSpeed", new BufferAttribute(speed, 1));
    geometry.setAttribute("aTail", new BufferAttribute(tail, 1));
    this.material = new ShaderMaterial({
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      uniforms: {
        uClock: { value: 0 },
        uHeight: { value: height },
        uWind: { value: 0.25 },
        uColor: { value: color },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.object = new LineSegments(geometry, this.material);
    this.object.frustumCulled = false;
    this.object.visible = false;
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
