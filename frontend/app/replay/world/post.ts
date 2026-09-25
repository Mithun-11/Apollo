/**
 * The film look, as one post-processing chain: bloom on everything bright (only the data is
 * bright: stars, threads, beam, pillars), depth of field on close shots, a white flash and a
 * chromatic pulse reserved for impacts, and the painted grain and vignette. Quality steps down
 * automatically, one way only, if the laptop cannot keep up.
 */

import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  Effect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  VignetteEffect,
} from "postprocessing";
import { HalfFloatType, type PerspectiveCamera, type Scene, Uniform, Vector2, type Vector3, type WebGLRenderer } from "three";

const FLASH_FRAGMENT = /* glsl */ `
uniform float uFlash;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 color = inputColor.rgb + uFlash * (vec3(1.0) - inputColor.rgb) * 0.85;
  outputColor = vec4(color, inputColor.a);
}`;

class FlashEffect extends Effect {
  constructor() {
    super("FlashEffect", FLASH_FRAGMENT, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([["uFlash", new Uniform(0)]]),
    });
  }

  set amount(value: number) {
    (this.uniforms.get("uFlash") as Uniform<number>).value = value;
  }
}

export type PostFrame = {
  /** Multiplier on the resting bloom (1 = normal, higher for surges). */
  bloom: number;
  /** A world point to focus on, or null for no depth of field. */
  focus: Vector3 | null;
  /** 0 to 1 white flash. */
  flash: number;
  /** 0 to 1 chromatic pulse. */
  chroma: number;
};

/** Frame-time budget before quality steps down (ms): about 45 fps. */
const SLOW_FRAME_MS = 22;

export class Post {
  private readonly composer: EffectComposer;
  private readonly bloom: BloomEffect;
  private readonly dof: DepthOfFieldEffect;
  private readonly dofPass: EffectPass;
  private readonly flash = new FlashEffect();
  private readonly chroma: ChromaticAberrationEffect;
  private readonly renderer: WebGLRenderer;
  private readonly reducedMotion: boolean;
  private quality = 0;
  private frameTimes: number[] = [];
  private last = 0;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, reducedMotion: boolean) {
    this.renderer = renderer;
    this.reducedMotion = reducedMotion;
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));

    this.dof = new DepthOfFieldEffect(camera, { focusDistance: 7, focusRange: 6, bokehScale: 1.3, resolutionScale: 0.5 });
    this.dofPass = new EffectPass(camera, this.dof);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);

    this.bloom = new BloomEffect({ luminanceThreshold: 0.55, luminanceSmoothing: 0.25, mipmapBlur: true, intensity: 1.1, radius: 0.72 });
    const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    grain.blendMode.opacity.value = 0.07;
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.55 });
    this.chroma = new ChromaticAberrationEffect({ offset: new Vector2(0, 0), radialModulation: true, modulationOffset: 0.2 });
    // The last pass presents to the screen, so it is never switched off: the chromatic pulse
    // rests at zero offset instead.
    this.composer.addPass(new EffectPass(camera, this.bloom, this.flash, this.chroma, grain, vignette));
  }

  setSize(width: number, height: number) {
    this.composer.setSize(width, height, false);
  }

  render(now: number, frame: PostFrame) {
    this.watch(now);
    this.bloom.intensity = 1.1 * frame.bloom;
    const focusing = frame.focus !== null && this.quality < 1;
    this.dofPass.enabled = focusing;
    if (focusing && frame.focus) this.dof.target = frame.focus;
    const calm = this.reducedMotion ? 0 : 1;
    this.flash.amount = frame.flash * calm;
    const pulse = frame.chroma * calm;
    this.chroma.offset.set(0.004 * pulse, 0.002 * pulse);
    this.composer.render();
  }

  /** Step quality down (never back up) when frames stay slow: DOF, then MSAA, then resolution. */
  private watch(now: number) {
    if (this.last > 0) this.frameTimes.push(now - this.last);
    this.last = now;
    if (this.frameTimes.length < 90) return;
    const average = this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (average <= SLOW_FRAME_MS || this.quality >= 3) return;
    this.quality += 1;
    if (this.quality === 2) this.composer.multisampling = 0;
    if (this.quality === 3) {
      this.renderer.setPixelRatio(1);
      const size = this.renderer.getSize(new Vector2());
      this.composer.setSize(size.x, size.y, false);
    }
  }

  dispose() {
    this.composer.dispose();
  }
}
