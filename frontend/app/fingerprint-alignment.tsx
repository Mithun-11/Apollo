"use client";

import type { MatchedFingerprintDisplay } from "../lib/api";

const MAX_RENDERED_MATCHES = 300;

const VW = 900;
const VH = 400;
const LEFT   = 70;
const RIGHT  = 18;
const PW     = VW - LEFT - RIGHT;

// Two timeline y-positions
const QUERY_Y  = 120;
const SONG_Y   = 280;

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function fmt(v: number): string {
  return `${v.toFixed(2)} s`;
}

export default function FingerprintAlignment({
  matches,
  queryDurationSeconds,
  sourceInterval,
  cursorSeconds,
}: {
  matches: MatchedFingerprintDisplay[];
  queryDurationSeconds: number;
  sourceInterval: { startSeconds: number; endSeconds: number } | null;
  cursorSeconds?: number;
}) {
  const visible = matches.slice(0, MAX_RENDERED_MATCHES);
  const queryDuration = queryDurationSeconds || 1;
  const sourceStart   = sourceInterval?.startSeconds ?? 0;
  const sourceEnd     = sourceInterval?.endSeconds   ?? queryDuration;
  const sourceDuration = Math.max(sourceEnd - sourceStart, queryDuration);

  // Sub-tick counts
  const tickCount = 6;

  if (!sourceInterval || visible.length === 0) {
    return (
      <div>
        <p className="empty-chart">No accepted fingerprint alignment is available.</p>
        <p className="chart-caption">The source-side timeline stays blank when Apollo has no accepted match.</p>
      </div>
    );
  }

  return (
    <div>
      <svg
        className="alignment-plot"
        viewBox={`0 0 ${VW} ${VH}`}
        role="img"
        aria-label="Matched fingerprints aligned between query and source song timelines"
      >
        {/* White background */}
        <rect x="0" y="0" width={VW} height={VH} fill="#ffffff" rx="4" />

        {/* ── Section labels ─────────────────────────────────── */}
        <text x={LEFT - 8} y={QUERY_Y - 30} fill="#374151" fontSize="13" fontWeight="700" textAnchor="end">
          Query
        </text>
        <text x={LEFT - 8} y={SONG_Y - 30} fill="#374151" fontSize="13" fontWeight="700" textAnchor="end">
          Song
        </text>

        {/* ── Query timeline band ─────────────────────────────── */}
        <rect x={LEFT} y={QUERY_Y - 14} width={PW} height={28}
          fill="#eff6ff" stroke="#bfdbfe" strokeWidth="1.5" rx="6" />
        <text x={LEFT} y={QUERY_Y + 34} fill="#6b7280" fontSize="11" textAnchor="start">0 s</text>
        <text x={LEFT + PW} y={QUERY_Y + 34} fill="#6b7280" fontSize="11" textAnchor="end">
          {fmt(queryDurationSeconds)}
        </text>
        {cursorSeconds !== undefined && <line x1={LEFT + clamp(cursorSeconds / queryDuration) * PW} x2={LEFT + clamp(cursorSeconds / queryDuration) * PW} y1={QUERY_Y - 31} y2={QUERY_Y + 20} stroke="#087f8b" strokeWidth="2.5" />}

        {/* ── Song timeline band ──────────────────────────────── */}
        <rect x={LEFT} y={SONG_Y - 14} width={PW} height={28}
          fill="#fef3c7" stroke="#fcd34d" strokeWidth="1.5" rx="6" />
        <text x={LEFT} y={SONG_Y + 34} fill="#6b7280" fontSize="11" textAnchor="start">
          {fmt(sourceStart)}
        </text>
        <text x={LEFT + PW} y={SONG_Y + 34} fill="#6b7280" fontSize="11" textAnchor="end">
          {fmt(sourceEnd)}
        </text>
        {cursorSeconds !== undefined && <line x1={LEFT + clamp(cursorSeconds / queryDuration) * PW} x2={LEFT + clamp(cursorSeconds / queryDuration) * PW} y1={SONG_Y - 31} y2={SONG_Y + 20} stroke="#d97706" strokeWidth="2.5" />}

        {/* ── Grid lines / ticks on both timelines ────────────── */}
        {Array.from({ length: tickCount - 1 }, (_, i) => {
          const frac = (i + 1) / tickCount;
          const qx = LEFT + frac * PW;
          const sx = LEFT + frac * PW;
          return (
            <g key={`tick-${i}`}>
              <line x1={qx} y1={QUERY_Y - 14} x2={qx} y2={QUERY_Y + 14}
                stroke="#bfdbfe" strokeWidth="0.8" />
              <line x1={sx} y1={SONG_Y - 14} x2={sx} y2={SONG_Y + 14}
                stroke="#fcd34d" strokeWidth="0.8" />
            </g>
          );
        })}

        {/* ── Connector lines (drawn beneath markers) ─────────── */}
        {visible.map((match, i) => {
          const qx = LEFT + clamp(match.queryAnchorSeconds / queryDuration) * PW;
          const sx = LEFT + clamp((match.sourceAnchorSeconds - sourceStart) / sourceDuration) * PW;
          return (
            <line
              key={`line-${i}`}
              x1={qx} y1={QUERY_Y + 14}
              x2={sx} y2={SONG_Y - 14}
              stroke="#f59e0b"
              strokeOpacity="0.25"
              strokeWidth="1"
            />
          );
        })}

        {/* ── Query markers ───────────────────────────────────── */}
        {visible.map((match, i) => {
          const qx = LEFT + clamp(match.queryAnchorSeconds / queryDuration) * PW;
          return (
            <circle key={`qm-${i}`} cx={qx} cy={QUERY_Y} r="4"
              fill="#3b82f6" fillOpacity="0.85" />
          );
        })}

        {/* ── Song markers ────────────────────────────────────── */}
        {visible.map((match, i) => {
          const sx = LEFT + clamp((match.sourceAnchorSeconds - sourceStart) / sourceDuration) * PW;
          return (
            <circle key={`sm-${i}`} cx={sx} cy={SONG_Y} r="4"
              fill="#d97706" fillOpacity="0.85" />
          );
        })}

        {/* ── Axis title ──────────────────────────────────────── */}
        <text x={VW / 2} y={VH - 6} fill="#9ca3af" fontSize="11" textAnchor="middle">
          Time axis — Query: 0 … {fmt(queryDurationSeconds)} · Song: {fmt(sourceStart)} … {fmt(sourceEnd)}
        </text>
      </svg>

      <p className="chart-caption">
        {visible.length} matched fingerprint pairs shown ·{" "}
        <span style={{ color: "#2563eb", fontWeight: 500 }}>blue dots</span> = query anchors ·{" "}
        <span style={{ color: "#d97706", fontWeight: 500 }}>gold dots</span> = song anchors ·
        lines show alignment
      </p>

      {visible.length > 0 && (
        <ol className="chart-fallback">
          {visible.slice(0, 5).map((m, i) => (
            <li key={`fa-${i}`}>
              Query {fmt(m.queryAnchorSeconds)} @ {Math.round(m.anchorFrequencyHz)} Hz →
              Song {fmt(m.sourceAnchorSeconds)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
