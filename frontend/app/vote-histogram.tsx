"use client";

import type { OffsetVoteDisplay } from "../lib/api";

const MAX_RENDERED_BARS = 200;

function formatSeconds(value: number): string {
  return `${value.toFixed(2)} s`;
}

export default function VoteHistogram({
  votes,
  threshold,
  timestampSeconds,
}: {
  votes: OffsetVoteDisplay[];
  threshold: number;
  timestampSeconds: number | null;
}) {
  const visibleVotes = votes.slice(0, MAX_RENDERED_BARS);
  const maximumCount = Math.max(threshold, ...visibleVotes.map((vote) => vote.count), 1);
  const minimumOffset = visibleVotes.length > 0 ? visibleVotes[0].offsetSeconds : 0;
  const maximumOffset =
    visibleVotes.length > 0 ? visibleVotes[visibleVotes.length - 1].offsetSeconds : 1;
  const offsetRange = maximumOffset - minimumOffset || 1;
  const chartLeft = 8;
  const chartWidth = 88;
  const chartBottom = 53;
  const chartHeight = 38;
  const barWidth = Math.max(0.45, (chartWidth / Math.max(visibleVotes.length, 1)) * 0.72);

  return (
    <div>
      {visibleVotes.length > 0 ? (
        <svg
          className="vote-plot"
          viewBox="0 0 100 72"
          role="img"
          aria-label="Time-offset vote histogram with the winning offset highlighted"
        >
          <rect x="0" y="0" width="100" height="72" fill="#0b1020" rx="2" />
          <line x1={chartLeft} y1={chartBottom} x2={chartLeft + chartWidth} y2={chartBottom} stroke="#737373" />
          {visibleVotes.map((vote) => {
            const x =
              chartLeft + ((vote.offsetSeconds - minimumOffset) / offsetRange) * chartWidth;
            const height = (vote.count / maximumCount) * chartHeight;
            return (
              <rect
                key={`${vote.offsetSeconds}-${vote.count}`}
                x={x - barWidth / 2}
                y={chartBottom - height}
                width={barWidth}
                height={height}
                fill={vote.winning ? "#facc15" : "#38bdf8"}
                opacity={vote.winning ? 1 : 0.7}
              />
            );
          })}
          <line
            x1={chartLeft}
            y1={chartBottom - (threshold / maximumCount) * chartHeight}
            x2={chartLeft + chartWidth}
            y2={chartBottom - (threshold / maximumCount) * chartHeight}
            stroke="#fb7185"
            strokeDasharray="1.5 1"
          />
          <text x="1" y="15" fill="#fb7185" fontSize="3">threshold</text>
          <text x="8" y="64" fill="#a3a3a3" fontSize="3">
            {formatSeconds(minimumOffset)}
          </text>
          <text x="77" y="64" fill="#a3a3a3" fontSize="3">
            {formatSeconds(maximumOffset)}
          </text>
        </svg>
      ) : (
        <p className="empty-chart">No accepted offset votes are available for this recording.</p>
      )}
      <p className="chart-caption">
        {timestampSeconds === null
          ? "Apollo did not accept a winning source offset."
          : `Winning offset: ${formatSeconds(timestampSeconds)}; threshold: ${threshold} aligned votes.`}
      </p>
      {visibleVotes.length > 0 ? (
        <ol className="chart-fallback">
          {[...visibleVotes]
            .sort((first, second) => second.count - first.count || first.offsetSeconds - second.offsetSeconds)
            .slice(0, 5)
            .map((vote) => (
              <li key={`${vote.offsetSeconds}-${vote.count}-fallback`}>
                {formatSeconds(vote.offsetSeconds)}: {vote.count} votes
                {vote.winning ? " (winning)" : ""}
              </li>
            ))}
        </ol>
      ) : null}
    </div>
  );
}
