/** Level in 0..1 to a paint colour: violet haze, then rose, then warm white at the loudest. */
export function paintColor(level: number): [number, number, number, number] {
  if (level <= 0.05) return [0, 0, 0, 0];
  const warm = Math.min(1, level * 1.25);
  return [
    Math.round(150 + 105 * warm),
    Math.round(110 + 135 * warm * warm),
    Math.round(190 + 40 * warm),
    Math.round(255 * Math.min(1, level * level * 1.6)),
  ];
}
