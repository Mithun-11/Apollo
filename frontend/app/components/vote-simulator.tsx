"use client";

import { useMemo, useState } from "react";
import type { RecognitionExplanation } from "../../lib/api";

const QUERY = [2, 10, 18, 26, 34];

export default function VoteSimulator({ decision }: { decision: RecognitionExplanation["decision"] }) {
  const [songFrames, setSongFrames] = useState([42, 50, 58, 66, 74]);
  const votes = useMemo(() => songFrames.map((frame, index) => frame - QUERY[index]), [songFrames]);
  const offsets = Array.from(new Set(votes)).sort((a, b) => a - b);
  const clusterCount = (offset: number) => votes.filter((vote) => Math.abs(vote - offset) <= decision.offsetToleranceFrames).length;
  const leading = Math.max(...offsets.map(clusterCount));
  return <div className="lab-tool"><h3>Offset voting simulator</h3><p>Each matching fingerprint votes for <code>catalog frame − query frame</code>. Move catalog anchors to see votes group around one song position.</p><div className="vote-demo-rows">{QUERY.map((query, index) => <label key={query}>Pair {index + 1}: query {query} → catalog <input type="range" min="20" max="95" value={songFrames[index]} onChange={(event) => setSongFrames((current) => current.map((frame, i) => i === index ? Number(event.target.value) : frame))} />{songFrames[index]} = <strong>{votes[index]} frames</strong></label>)}</div><div className="vote-demo-bars">{offsets.map((offset) => <div key={offset}><span>{offset} frames</span><i style={{ width: `${clusterCount(offset) / QUERY.length * 100}%` }} /><strong>{clusterCount(offset)} votes</strong></div>)}</div><p className="lab-caption">Best cluster: {leading} of 5 demo votes, combining offsets within ±{decision.offsetToleranceFrames} frame. The real matcher requires {decision.minimumVotes} votes and a {decision.minimumWinnerRatio}× margin over the best other song, so this five-pair demo cannot itself pass Apollo&apos;s full decision gate.</p></div>;
}
