"use client";

import { useState } from "react";
import type { RecognitionExplanationResponse, WaveformEnvelopePoint } from "../lib/api";
import ConstellationPlot from "./constellation-plot";
import FingerprintAlignment from "./fingerprint-alignment";
import SpectrogramCanvas from "./spectrogram-canvas";
import VoteHistogram from "./vote-histogram";

/* ── helpers ─────────────────────────────────────────────────────── */
function fmt(v: number | null): string {
  return v === null ? "unknown" : `${v.toFixed(2)} s`;
}

/* ── Waveform ────────────────────────────────────────────────────── */
function WaveformEnvelope({
  points,
  durationSeconds,
}: {
  points: WaveformEnvelopePoint[];
  durationSeconds: number;
}) {
  const dur = durationSeconds || 1;
  const pts = points.slice(0, 600);
  const tickCount = 5;

  const forwardMax = pts
    .map((p, i) => {
      const x = 20 + Math.max(0, Math.min(1, p.timeSeconds / dur)) * 560;
      const y = 30 + (1 - Math.max(-1, Math.min(1, p.maximum))) * 0.5 * 120;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const backwardMin = [...pts]
    .reverse()
    .map((p) => {
      const x = 20 + Math.max(0, Math.min(1, p.timeSeconds / dur)) * 560;
      const y = 30 + (1 - Math.max(-1, Math.min(1, p.minimum))) * 0.5 * 120;
      return `L ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const areaPath = pts.length > 0 ? `${forwardMax} ${backwardMin} Z` : "";

  return (
    <figure className="chart-figure">
      <svg className="waveform-plot" viewBox="0 0 600 200" role="img" aria-label="Normalized query waveform envelope">
        <rect x="0" y="0" width="600" height="200" fill="#ffffff" rx="4" />
        <rect x="20" y="20" width="560" height="140" fill="#f9fafb" rx="2" />
        {[30, 90, 150].map((y, i) => (
          <g key={y}>
            <line x1="20" y1={y} x2="580" y2={y} stroke="#e5e7eb" strokeWidth="1" strokeDasharray={i === 1 ? "0" : "4 3"} />
            <text x="14" y={y + 4} fill="#9ca3af" fontSize="9" textAnchor="end">{["+1","0","−1"][i]}</text>
          </g>
        ))}
        {areaPath && <path d={areaPath} fill="rgba(56,189,248,0.18)" />}
        {pts.length > 0 && (
          <polyline
            points={pts.map((p) => {
              const x = 20 + Math.max(0, Math.min(1, p.timeSeconds / dur)) * 560;
              const y = 30 + (1 - Math.max(-1, Math.min(1, p.maximum))) * 0.5 * 120;
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(" ")}
            fill="none" stroke="#0ea5e9" strokeWidth="1.2"
          />
        )}
        <rect x="20" y="20" width="560" height="140" fill="none" stroke="#d1d5db" strokeWidth="1" rx="2" />
        {Array.from({ length: tickCount + 1 }, (_, i) => {
          const t = (i / tickCount) * durationSeconds;
          const x = 20 + (i / tickCount) * 560;
          return (
            <g key={i}>
              <line x1={x} y1="160" x2={x} y2="164" stroke="#9ca3af" strokeWidth="1" />
              <text x={x} y="176" fill="#6b7280" fontSize="9" textAnchor="middle">{t.toFixed(1)}s</text>
            </g>
          );
        })}
        <text x="300" y="195" fill="#9ca3af" fontSize="9" textAnchor="middle">Time (seconds)</text>
        <text x="8" y="92" fill="#9ca3af" fontSize="9" textAnchor="middle" transform="rotate(-90 8 92)">Amplitude</text>
      </svg>
      <p className="chart-caption">{pts.length} envelope regions · amplitude −1…+1</p>
    </figure>
  );
}

/* ── Tab definitions ────────────────────────────────────────────── */
type TabId = "waveform" | "spectrogram" | "constellation" | "alignment" | "votes";
const TABS: { id: TabId; label: string }[] = [
  { id: "waveform",      label: "Waveform" },
  { id: "spectrogram",   label: "Spectrogram" },
  { id: "constellation", label: "Constellation" },
  { id: "alignment",     label: "Alignment" },
  { id: "votes",         label: "Votes" },
];

/* ── Main ────────────────────────────────────────────────────────── */
export default function RecognitionExplanation({
  response,
}: {
  response: RecognitionExplanationResponse;
}) {
  const { recognition, explanation } = response;
  const sourceInterval = explanation.sourceInterval;
  const [activeTab, setActiveTab] = useState<TabId>("waveform");

  const song = recognition.matched && recognition.song ? recognition.song : null;

  return (
    <section className="lbx-section" aria-labelledby="explanation-title">

      {/* ── Profile-style header ─────────────────────────────────── */}
      <div className="lbx-header">
        {/* Icon */}
        <div className="lbx-avatar" aria-hidden="true">
          <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="20" cy="20" r="20" fill="#1d2330" />
            <path d="M14 26V16l12-3v10" stroke="#67e8f9" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="12" cy="26" r="2.5" fill="#67e8f9"/>
            <circle cx="24" cy="23" r="2.5" fill="#67e8f9"/>
          </svg>
        </div>

        {/* Identity */}
        <div className="lbx-identity">
          <h2 id="explanation-title" className="lbx-title">
            {song ? song.name : "No match found"}
          </h2>
          <p className="lbx-sub">
            {song && recognition.timestampSeconds !== null
              ? `Matched at ${fmt(recognition.timestampSeconds)} · confidence ${Math.round(recognition.confidence * 100)}%`
              : explanation.counts.fingerprints === 0
                ? "Recording had insufficient spectral structure."
                : explanation.counts.matchingHashes === 0
                  ? "No query fingerprints matched the catalog."
                  : "Matches did not align at a single timestamp."}
          </p>
          {song && (
            <a className="lbx-spotify-link" href={song.spotifyUrl} target="_blank" rel="noreferrer">
              Open in Spotify ↗
            </a>
          )}
        </div>

        {/* Stats — Letterboxd-style */}
        <div className="lbx-stats" aria-label="Recognition pipeline counts">
          <div className="lbx-stat">
            <span className="lbx-stat-number">{explanation.counts.peaks.toLocaleString()}</span>
            <span className="lbx-stat-label">Peaks</span>
          </div>
          <div className="lbx-stat">
            <span className="lbx-stat-number">{explanation.counts.fingerprints.toLocaleString()}</span>
            <span className="lbx-stat-label">Fingerprints</span>
          </div>
          <div className="lbx-stat">
            <span className="lbx-stat-number">{explanation.counts.matchingHashes.toLocaleString()}</span>
            <span className="lbx-stat-label">Matching hashes</span>
          </div>
          <div className="lbx-stat">
            <span className="lbx-stat-number">{explanation.counts.winningVotes.toLocaleString()}</span>
            <span className="lbx-stat-label">Winning votes</span>
          </div>
        </div>
      </div>

      {/* ── Tab nav ──────────────────────────────────────────────── */}
      <nav className="lbx-tabs" aria-label="Pipeline visualization tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`lbx-tab${activeTab === tab.id ? " lbx-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            aria-pressed={activeTab === tab.id}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ── Graph panel ──────────────────────────────────────────── */}
      <div className="lbx-graph-panel">
        <div className="chart-white-wrap">
          {activeTab === "waveform" && (
            <WaveformEnvelope
              points={explanation.waveformEnvelope}
              durationSeconds={explanation.queryDurationSeconds}
            />
          )}
          {activeTab === "spectrogram" && (
            <SpectrogramCanvas spectrogram={explanation.spectrogram} />
          )}
          {activeTab === "constellation" && (
            <ConstellationPlot
              peaks={explanation.peaks}
              durationSeconds={explanation.queryDurationSeconds}
              maximumFrequencyHz={explanation.spectrogram.maximumFrequencyHz}
            />
          )}
          {activeTab === "alignment" && (
            <FingerprintAlignment
              matches={explanation.matchedFingerprints}
              queryDurationSeconds={explanation.queryDurationSeconds}
              sourceInterval={sourceInterval}
            />
          )}
          {activeTab === "votes" && (
            <VoteHistogram
              votes={explanation.offsetVotes}
              threshold={explanation.matchThreshold}
              timestampSeconds={recognition.timestampSeconds}
            />
          )}
        </div>
      </div>
    </section>
  );
}
