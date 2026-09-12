"use client";

import type { PeakDisplay } from "../lib/api";

const MAX_RENDERED_PEAKS = 1_000;

// SVG viewBox constants
const VW = 900;
const VH = 420;
const LEFT   = 58;
const TOP    = 18;
const RIGHT  = 18;
const BOTTOM = 44;
const PW = VW - LEFT - RIGHT;
const PH = VH - TOP - BOTTOM;

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
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
  const visible = peaks.slice(0, MAX_RENDERED_PEAKS);
  const dur   = durationSeconds    || 1;
  const maxHz = maximumFrequencyHz || 1;

  const timeTickCount = 5;
  const freqTickCount = 6;

  return (
    <figure className="chart-figure">
      <svg
        className="constellation-plot"
        viewBox={`0 0 ${VW} ${VH}`}
        role="img"
        aria-label="Detected spectral peaks plotted over the query timeline"
      >
        {/* White background */}
        <rect x="0" y="0" width={VW} height={VH} fill="#ffffff" rx="4" />
        {/* Plot area */}
        <rect x={LEFT} y={TOP} width={PW} height={PH} fill="#f9fafb" rx="2" />

        {/* Grid lines — time */}
        {Array.from({ length: timeTickCount + 1 }, (_, i) => {
          const x = LEFT + (i / timeTickCount) * PW;
          return (
            <line key={`tg-${i}`} x1={x} y1={TOP} x2={x} y2={TOP + PH}
              stroke="rgba(0,0,0,0.07)" strokeWidth="1" />
          );
        })}

        {/* Grid lines — frequency */}
        {Array.from({ length: freqTickCount + 1 }, (_, i) => {
          const y = TOP + (i / freqTickCount) * PH;
          return (
            <line key={`fg-${i}`} x1={LEFT} y1={y} x2={LEFT + PW} y2={y}
              stroke="rgba(0,0,0,0.07)" strokeWidth="1" />
          );
        })}

        {/* Unmatched peaks */}
        {visible.filter((p) => !p.matched).map((peak, i) => {
          const x = LEFT + clamp(peak.timeSeconds / dur) * PW;
          const y = TOP  + (1 - clamp(peak.frequencyHz / maxHz)) * PH;
          return (
            <circle key={`u-${i}`} cx={x} cy={y} r="2.5"
              fill="#93c5fd" fillOpacity="0.7" />
          );
        })}

        {/* Matched peaks — drawn on top */}
        {visible.filter((p) => p.matched).map((peak, i) => {
          const x = LEFT + clamp(peak.timeSeconds / dur) * PW;
          const y = TOP  + (1 - clamp(peak.frequencyHz / maxHz)) * PH;
          return (
            <g key={`m-${i}`}>
              <circle cx={x} cy={y} r="5.5" fill="rgba(251,191,36,0.18)" />
              <circle cx={x} cy={y} r="3.5" fill="#fbbf24" stroke="#d97706" strokeWidth="1" />
            </g>
          );
        })}

        {/* Border */}
        <rect x={LEFT} y={TOP} width={PW} height={PH} fill="none" stroke="#d1d5db" strokeWidth="1" rx="2" />

        {/* Time axis ticks + labels */}
        {Array.from({ length: timeTickCount + 1 }, (_, i) => {
          const t = (i / timeTickCount) * durationSeconds;
          const x = LEFT + (i / timeTickCount) * PW;
          return (
            <g key={`tl-${i}`}>
              <line x1={x} y1={TOP + PH} x2={x} y2={TOP + PH + 4} stroke="#9ca3af" strokeWidth="1" />
              <text x={x} y={TOP + PH + 16} fill="#374151" fontSize="12" textAnchor="middle">
                {t.toFixed(1)}s
              </text>
            </g>
          );
        })}

        {/* Frequency axis ticks + labels */}
        {Array.from({ length: freqTickCount + 1 }, (_, i) => {
          const hz = ((freqTickCount - i) / freqTickCount) * maximumFrequencyHz;
          const y  = TOP + (i / freqTickCount) * PH;
          const label = hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`;
          return (
            <g key={`fl-${i}`}>
              <line x1={LEFT - 4} y1={y} x2={LEFT} y2={y} stroke="#9ca3af" strokeWidth="1" />
              <text x={LEFT - 7} y={y + 4} fill="#374151" fontSize="11" textAnchor="end">
                {label}
              </text>
            </g>
          );
        })}

        {/* Axis titles */}
        <text x={LEFT + PW / 2} y={VH - 4} fill="#6b7280" fontSize="12" textAnchor="middle">
          Time (s)
        </text>
        <text
          x={11}
          y={TOP + PH / 2}
          fill="#6b7280"
          fontSize="12"
          textAnchor="middle"
          transform={`rotate(-90 11 ${TOP + PH / 2})`}
        >
          Frequency (Hz)
        </text>

        {/* Legend */}
        <circle cx={LEFT + PW - 80} cy={TOP + PH - 16} r="5" fill="#93c5fd" fillOpacity="0.7" />
        <text x={LEFT + PW - 72} y={TOP + PH - 12} fill="#374151" fontSize="11">
          All peaks ({visible.filter((p) => !p.matched).length})
        </text>
        <circle cx={LEFT + PW - 80} cy={TOP + PH - 2} r="5" fill="#fbbf24" stroke="#d97706" strokeWidth="1" />
        <text x={LEFT + PW - 72} y={TOP + PH + 2} fill="#374151" fontSize="11">
          Matched ({visible.filter((p) => p.matched).length})
        </text>
      </svg>
      <p className="chart-caption">
        {visible.length} of {peaks.length} peaks shown ·{" "}
        <span style={{ color: "#2563eb", fontWeight: 500 }}>blue</span> = detected peaks ·{" "}
        <span style={{ color: "#d97706", fontWeight: 500 }}>gold</span> = contributed to winning match
      </p>
    </figure>
  );
}
