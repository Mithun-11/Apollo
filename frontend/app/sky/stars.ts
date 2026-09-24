/**
 * Star glints as they are drawn in anime skies: a hot core, a soft halo and four thin spikes.
 * Each colour is rendered once to an offscreen canvas and then stamped, so thousands of stars
 * stay cheap to draw every frame.
 */

const SPRITE_SIZE = 64;
const cache = new Map<string, HTMLCanvasElement>();

function sprite(color: string): HTMLCanvasElement {
  const cached = cache.get(color);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const context = canvas.getContext("2d");
  if (context) {
    const middle = SPRITE_SIZE / 2;
    const halo = context.createRadialGradient(middle, middle, 0, middle, middle, middle);
    halo.addColorStop(0, color);
    halo.addColorStop(0.12, color);
    halo.addColorStop(0.3, withAlpha(color, 0.35));
    halo.addColorStop(1, withAlpha(color, 0));
    context.fillStyle = halo;
    context.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    // Four diffraction spikes, thinning to nothing.
    context.globalCompositeOperation = "lighter";
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ]) {
      const spike = context.createLinearGradient(
        middle - dx * middle,
        middle - dy * middle,
        middle + dx * middle,
        middle + dy * middle,
      );
      spike.addColorStop(0, withAlpha(color, 0));
      spike.addColorStop(0.5, color);
      spike.addColorStop(1, withAlpha(color, 0));
      context.fillStyle = spike;
      if (dx) context.fillRect(0, middle - 0.9, SPRITE_SIZE, 1.8);
      else context.fillRect(middle - 0.9, 0, 1.8, SPRITE_SIZE);
    }
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(middle, middle, 2.1, 0, Math.PI * 2);
    context.fill();
  }
  cache.set(color, canvas);
  return canvas;
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Stamp a star; ``size`` is its drawn diameter in CSS pixels. */
export function drawStar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha = 1,
): void {
  if (alpha <= 0.01 || size <= 0.5) return;
  const image = sprite(color);
  context.globalAlpha = Math.min(1, alpha);
  context.drawImage(image, x - size / 2, y - size / 2, size, size);
  context.globalAlpha = 1;
}

export { withAlpha };
