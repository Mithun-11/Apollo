/**
 * The shared sky frame. Every layer (painted sky, data canvas, horizon, captions) maps time and
 * pitch through these functions, so the sky painted while listening is the same sky the replay
 * explains: time runs left to right, pitch rises from the horizon.
 */

export const MIN_FREQUENCY_HZ = 100;
export const MAX_FREQUENCY_HZ = 5_000;

/** Fractions of the viewport; they match the replay's wide camera shot, so both skies line up. */
export const SKY_TOP = 0.116;
export const HORIZON = 0.7;
export const SKY_LEFT = 0.125;
export const SKY_RIGHT = 0.875;

export const INK = {
  night: "#0c1130",
  ultramarine: "#16204a",
  violet: "#3b2f6b",
  dusk: "#f0a47a",
  star: "#fff6e6",
  starDim: "rgba(255, 246, 230, 0.62)",
  thread: "#e2323f",
  comet: "#9fe3e0",
  lantern: "#ffc98a",
} as const;

export type SkyFrame = { width: number; height: number };

export function timeToX(seconds: number, durationSeconds: number, frame: SkyFrame): number {
  const span = Math.max(durationSeconds, 0.001);
  return frame.width * (SKY_LEFT + (SKY_RIGHT - SKY_LEFT) * (seconds / span));
}

export function frequencyToY(hz: number, frame: SkyFrame): number {
  const low = Math.log(MIN_FREQUENCY_HZ);
  const high = Math.log(MAX_FREQUENCY_HZ);
  const clamped = Math.min(MAX_FREQUENCY_HZ, Math.max(MIN_FREQUENCY_HZ, hz));
  const position = (Math.log(clamped) - low) / (high - low);
  return frame.height * (HORIZON - (HORIZON - SKY_TOP) * position);
}

export function horizonY(frame: SkyFrame): number {
  return frame.height * HORIZON;
}

/** Fit a canvas to its CSS box at device resolution; returns the CSS-pixel frame. */
export function fitCanvas(canvas: HTMLCanvasElement): SkyFrame {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext("2d");
  context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const easeOut = (value: number) => 1 - Math.pow(1 - clamp01(value), 3);
export const easeInOut = (value: number) => {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
