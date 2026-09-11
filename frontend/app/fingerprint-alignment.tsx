"use client";

import type { MatchedFingerprintDisplay } from "../lib/api";

const MAX_RENDERED_MATCHES = 300;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function formatSeconds(value: number): string {
  return `${value.toFixed(2)} s`;
}

export default function FingerprintAlignment({
  matches,
  queryDurationSeconds,
  sourceInterval,
}: {
  matches: MatchedFingerprintDisplay[];
  queryDurationSeconds: number;
  sourceInterval: { startSeconds: number; endSeconds: number } | null;
}) {
  const visibleMatches = matches.slice(0, MAX_RENDERED_MATCHES);
  const queryDuration = queryDurationSeconds || 1;
  const sourceStart = sourceInterval?.startSeconds ?? 0;
  const sourceDuration = sourceInterval
    ? Math.max(sourceInterval.endSeconds - sourceInterval.startSeconds, queryDuration)
    : queryDuration;

  return (
    <div>
      {sourceInterval && visibleMatches.length > 0 ? (
        <svg
          className="alignment-plot"
          viewBox="0 0 100 92"
          role="img"
          aria-label="Matched fingerprints aligned between query and source timelines"
        >
          <rect x="0" y="0" width="100" height="92" fill="#0b1020" rx="2" />
          <line x1="12" y1="26" x2="96" y2="26" stroke="#737373" />
          <line x1="12" y1="66" x2="96" y2="66" stroke="#737373" />
          {visibleMatches.map((match, index) => {
            const queryX = 12 + clamp(match.queryAnchorSeconds / queryDuration) * 84;
            const sourceX =
              12 + clamp((match.sourceAnchorSeconds - sourceStart) / sourceDuration) * 84;
            return (
              <g key={`${match.queryAnchorSeconds}-${match.sourceAnchorSeconds}-${index}`}>
                <line
                  x1={queryX}
                  y1="26"
                  x2={sourceX}
                  y2="66"
                  stroke="#facc15"
                  strokeOpacity="0.55"
                  strokeWidth="0.25"
                />
                <circle cx={queryX} cy="26" r="0.7" fill="#67e8f9" />
                <circle cx={sourceX} cy="66" r="0.7" fill="#facc15" />
              </g>
            );
          })}
          <text x="1" y="27" fill="#d4d4d4" fontSize="3.4">Query</text>
          <text x="1" y="67" fill="#d4d4d4" fontSize="3.4">Song</text>
          <text x="12" y="20" fill="#a3a3a3" fontSize="3">0 s</text>
          <text x="87" y="20" fill="#a3a3a3" fontSize="3">
            {formatSeconds(queryDurationSeconds)}
          </text>
          <text x="12" y="80" fill="#a3a3a3" fontSize="3">
            {formatSeconds(sourceInterval.startSeconds)}
          </text>
          <text x="83" y="80" fill="#a3a3a3" fontSize="3">
            {formatSeconds(sourceInterval.endSeconds)}
          </text>
        </svg>
      ) : (
        <p className="empty-chart">No accepted fingerprint alignment is available.</p>
      )}
      <p className="chart-caption">
        {visibleMatches.length > 0
          ? `${visibleMatches.length} matched fingerprint lines shown; the source timeline contains matched evidence only.`
          : "The source-side timeline stays blank when Apollo has no accepted match."}
      </p>
      {visibleMatches.length > 0 ? (
        <ul className="chart-fallback">
          {visibleMatches.slice(0, 5).map((match, index) => (
            <li key={`${match.queryAnchorSeconds}-${match.sourceAnchorSeconds}-fallback-${index}`}>
              Query {formatSeconds(match.queryAnchorSeconds)} → source{" "}
              {formatSeconds(match.sourceAnchorSeconds)}; {Math.round(match.anchorFrequencyHz)} Hz
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
