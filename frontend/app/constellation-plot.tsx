"use client";

import type { PeakDisplay } from "../lib/api";

const MAX_RENDERED_PEAKS = 1_000;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export default function ConstellationPlot({
  peaks,
  durationSeconds,
  maximumFrequencyHz,
}: {
  peaks: PeakDisplay[];
  durationSeconds: number;
  maximumFrequencyHz: number;
}) {
  const visiblePeaks = peaks.slice(0, MAX_RENDERED_PEAKS);
  const duration = durationSeconds || 1;
  const maximumFrequency = maximumFrequencyHz || 1;

  return (
    <figure className="chart-figure">
      <svg
        className="constellation-plot"
        viewBox="0 0 100 48"
        role="img"
        aria-label="Detected spectral peaks plotted over the query timeline"
      >
        <rect x="0" y="0" width="100" height="48" fill="#0b1020" rx="2" />
        <line x1="0" y1="46" x2="100" y2="46" stroke="#737373" />
        {visiblePeaks.map((peak, index) => {
          const x = clamp(peak.timeSeconds / duration) * 100;
          const y = (1 - clamp(peak.frequencyHz / maximumFrequency)) * 42 + 2;
          return (
            <circle
              key={`${peak.timeSeconds}-${peak.frequencyHz}-${index}`}
              cx={x}
              cy={y}
              r={peak.matched ? 0.7 : 0.35}
              fill={peak.matched ? "#facc15" : "#67e8f9"}
              stroke={peak.matched ? "#fef08a" : "none"}
              strokeWidth={peak.matched ? 0.18 : 0}
            />
          );
        })}
        <text x="1" y="47.5" fill="#a3a3a3" fontSize="3">0 s</text>
        <text x="86" y="47.5" fill="#a3a3a3" fontSize="3">
          {durationSeconds.toFixed(1)} s
        </text>
      </svg>
      <figcaption>
        {visiblePeaks.length} of {peaks.length} peaks shown. Cyan points are detected peaks;
        yellow outlined points contributed to the winning match.
      </figcaption>
    </figure>
  );
}
