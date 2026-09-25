"use client";

import { memo, useState } from "react";
import type { OffsetVoteDisplay } from "../../lib/api";
import ChartCursor from "./chart-cursor";

const MAX_RENDERED_BARS = 200;

const VW = 900;
const VH = 420;
const LEFT   = 58;
const TOP    = 28;
const RIGHT  = 18;
const BOTTOM = 54;
const PW = VW - LEFT - RIGHT;
const PH = VH - TOP - BOTTOM;

function fmt(v: number): string {
  return `${v.toFixed(2)} s`;
}

function VoteHistogram({
  votes,
  threshold,
  timestampSeconds,
  accepted,
}: {
  votes: OffsetVoteDisplay[];
  threshold: number;
  timestampSeconds: number | null;
  accepted?: boolean;
}) {
  const visible = votes.slice(0, MAX_RENDERED_BARS);
  const [hoveredOffset, setHoveredOffset] = useState<number | null>(null);
  if (visible.length === 0) {
    return (
      <div>
        <p className="empty-chart">No catalog fingerprint votes are available for this recording.</p>
        <p className="chart-caption">There is no candidate offset to compare with the decision threshold.</p>
      </div>
    );
  }

  const maxCount = Math.max(threshold * 1.2, ...visible.map((v) => v.count), 1);
  const minOffset = visible[0].offsetSeconds;
  const maxOffset = visible[visible.length - 1].offsetSeconds;
  const offsetRange = maxOffset - minOffset || 1;

  // Bar width — leave small gaps
  const barW = Math.max(2, (PW / Math.max(visible.length, 1)) * 0.75);

  // y-grid lines
  const yTickCount = 5;
  const threshY = TOP + PH - (threshold / maxCount) * PH;

  return (
    <div>
      <ChartCursor onHover={(x) => {
        if (x === null) { setHoveredOffset(null); return; }
        const offset = minOffset + Math.max(0, Math.min(1, (x * VW - LEFT) / PW)) * offsetRange;
        setHoveredOffset(visible.reduce((best, vote) => Math.abs(vote.offsetSeconds - offset) < Math.abs(best.offsetSeconds - offset) ? vote : best, visible[0]).offsetSeconds);
      }} describe={(x) => {
        const offset = minOffset + Math.max(0, Math.min(1, (x * VW - LEFT) / PW)) * offsetRange;
        const nearest = visible.reduce((best, vote) => Math.abs(vote.offsetSeconds - offset) < Math.abs(best.offsetSeconds - offset) ? vote : best, visible[0]);
        return `${nearest.offsetSeconds.toFixed(2)} s · ${nearest.count} votes`;
      }}>
      <svg
        className="vote-plot"
        viewBox={`0 0 ${VW} ${VH}`}
        role="img"
        aria-label="Time-offset vote histogram with winning offset highlighted"
      >
        {/* White background */}
        <rect x="0" y="0" width={VW} height={VH} fill="#0f1e24" rx="4" />
        {/* Plot area */}
        <rect x={LEFT} y={TOP} width={PW} height={PH} fill="#152830" rx="2" />

        {/* Horizontal grid lines */}
        {Array.from({ length: yTickCount + 1 }, (_, i) => {
          const y = TOP + (i / yTickCount) * PH;
          const count = Math.round(((yTickCount - i) / yTickCount) * maxCount);
          return (
            <g key={`yg-${i}`}>
              <line x1={LEFT} y1={y} x2={LEFT + PW} y2={y}
                stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <text x={LEFT - 7} y={y + 4} fill="#8eb8c0" fontSize="11" textAnchor="end">
                {count}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {visible.map((vote) => {
          const x = LEFT + ((vote.offsetSeconds - minOffset) / offsetRange) * PW;
          const barH = Math.max(1, (vote.count / maxCount) * PH);
          const fill = vote.winning ? "#fbbf24" : "#93c5fd";
          const stroke = hoveredOffset === vote.offsetSeconds ? "#ffffff" : vote.winning ? "#d97706" : "#60a5fa";
          return (
            <g key={`${vote.offsetSeconds}-${vote.count}`}>
              <rect
                x={x - barW / 2}
                y={TOP + PH - barH}
                width={barW}
                height={barH}
                fill={fill}
                stroke={stroke}
                strokeWidth="0.5"
                rx="1"
              />
              {vote.winning && (
                <text
                  x={x}
                  y={TOP + PH - barH - 6}
                  fill="#92400e"
                  fontSize="10"
                  textAnchor="middle"
                  fontWeight="700"
                >
                  {vote.count}
                </text>
              )}
            </g>
          );
        })}

        {/* Threshold line */}
        <line
          x1={LEFT} y1={threshY} x2={LEFT + PW} y2={threshY}
          stroke="#ef4444" strokeWidth="1.5" strokeDasharray="6 4"
        />
        <text x={LEFT + 6} y={threshY - 6} fill="#ef4444" fontSize="11" fontWeight="600">
          threshold = {threshold}
        </text>

        {/* Winning vertical line */}
        {timestampSeconds !== null && (() => {
          const wx = LEFT + ((timestampSeconds - minOffset) / offsetRange) * PW;
          return (
            <>
              <line x1={wx} y1={TOP} x2={wx} y2={TOP + PH}
                stroke="#d97706" strokeWidth="1.5" strokeDasharray="4 3" />
              <text x={wx + 4} y={TOP + 14} fill="#92400e" fontSize="11" fontWeight="700">
                  {accepted ? "accepted" : "leading"}
              </text>
            </>
          );
        })()}

        {/* Border */}
        <rect x={LEFT} y={TOP} width={PW} height={PH} fill="none" stroke="#2c454d" strokeWidth="1" rx="2" />

        {/* X-axis ticks + labels */}
        {Array.from({ length: 6 }, (_, i) => {
          const t = minOffset + (i / 5) * offsetRange;
          const x = LEFT + (i / 5) * PW;
          return (
            <g key={`xl-${i}`}>
              <line x1={x} y1={TOP + PH} x2={x} y2={TOP + PH + 4} stroke="#739ba3" strokeWidth="1" />
              <text x={x} y={TOP + PH + 17} fill="#8eb8c0" fontSize="11" textAnchor="middle">
                {fmt(t)}
              </text>
            </g>
          );
        })}

        {/* Axis titles */}
        <text x={LEFT + PW / 2} y={VH - 4} fill="#8eb8c0" fontSize="12" textAnchor="middle">
          Candidate source offset (s)
        </text>
        <text
          x={11}
          y={TOP + PH / 2}
          fill="#8eb8c0"
          fontSize="12"
          textAnchor="middle"
          transform={`rotate(-90 11 ${TOP + PH / 2})`}
        >
          Aligned vote count
        </text>
      </svg>
      </ChartCursor>

      <p className="chart-caption">
        {timestampSeconds === null
          ? "Apollo did not accept a winning source offset."
          : `${accepted ? "Accepted" : "Leading"} offset: ${fmt(timestampSeconds)} · minimum: ${threshold} clustered votes.`}
      </p>

      {/* Fallback text list */}
      <ol className="chart-fallback">
        {[...visible]
          .sort((a, b) => b.count - a.count || a.offsetSeconds - b.offsetSeconds)
          .slice(0, 5)
          .map((v) => (
            <li key={`${v.offsetSeconds}-fallback`}>
              {fmt(v.offsetSeconds)}: <strong>{v.count}</strong> clustered votes{v.winning ? accepted ? " (accepted)" : " (leading)" : ""}
            </li>
          ))}
      </ol>
    </div>
  );
}

export default memo(VoteHistogram);
