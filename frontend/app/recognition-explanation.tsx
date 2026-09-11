"use client";

import type { RecognitionExplanationResponse, WaveformEnvelopePoint } from "../lib/api";
import ConstellationPlot from "./constellation-plot";
import FingerprintAlignment from "./fingerprint-alignment";
import SpectrogramCanvas from "./spectrogram-canvas";
import VoteHistogram from "./vote-histogram";

function formatSeconds(value: number | null): string {
  return value === null ? "unknown time" : `${value.toFixed(2)} s`;
}

function WaveformEnvelope({
  points,
  durationSeconds,
}: {
  points: WaveformEnvelopePoint[];
  durationSeconds: number;
}) {
  const duration = durationSeconds || 1;
  const waveformPoints = points.slice(0, 600);
  const toX = (timeSeconds: number) => Math.max(0, Math.min(1, timeSeconds / duration)) * 100;
  const toY = (amplitude: number) => (1 - Math.max(-1, Math.min(1, amplitude))) * 22 + 3;
  const minimumPoints = waveformPoints
    .map((point) => `${toX(point.timeSeconds)},${toY(point.minimum)}`)
    .join(" ");
  const maximumPoints = waveformPoints
    .map((point) => `${toX(point.timeSeconds)},${toY(point.maximum)}`)
    .join(" ");

  return (
    <figure className="chart-figure">
      <svg
        className="waveform-plot"
        viewBox="0 0 100 48"
        role="img"
        aria-label="Normalized query waveform envelope"
      >
        <rect x="0" y="0" width="100" height="48" fill="#0b1020" rx="2" />
        <line x1="0" y1="25" x2="100" y2="25" stroke="#404040" strokeDasharray="1 1" />
        {waveformPoints.length > 0 ? (
          <>
            <polyline points={minimumPoints} fill="none" stroke="#38bdf8" strokeWidth="0.45" />
            <polyline points={maximumPoints} fill="none" stroke="#67e8f9" strokeWidth="0.45" />
          </>
        ) : null}
        <text x="1" y="47" fill="#a3a3a3" fontSize="3">0 s</text>
        <text x="87" y="47" fill="#a3a3a3" fontSize="3">
          {durationSeconds.toFixed(1)} s
        </text>
      </svg>
      <figcaption>
        {waveformPoints.length} min/max regions shown; amplitude is normalized to −1 through 1.
      </figcaption>
    </figure>
  );
}

export default function RecognitionExplanation({
  response,
}: {
  response: RecognitionExplanationResponse;
}) {
  const { recognition, explanation } = response;
  const sourceInterval = explanation.sourceInterval;

  return (
    <section className="explanation-dashboard" aria-labelledby="explanation-title">
      <div className="explanation-summary">
        <h2 id="explanation-title">How Apollo decided</h2>
        <p>Apollo detected {explanation.counts.peaks} spectral peaks.</p>
        <p>
          Apollo generated {explanation.counts.fingerprints} query fingerprints, and{" "}
          {explanation.counts.matchingHashes} hashes also existed in the catalog.
        </p>
        {recognition.matched && recognition.song && sourceInterval ? (
          <>
            <p>
              {explanation.counts.winningVotes} fingerprints agreed on an offset of{" "}
              {formatSeconds(recognition.timestampSeconds)}.
            </p>
            <p>
              The recording aligns with {formatSeconds(sourceInterval.startSeconds)}–
              {formatSeconds(sourceInterval.endSeconds)} in {recognition.song.name}.
            </p>
            <p>
              Match confidence (aligned fingerprint ratio): {Math.round(recognition.confidence * 100)}%.
            </p>
          </>
        ) : (
          <p>
            {explanation.counts.fingerprints === 0
              ? "The recording did not contain enough usable spectral structure."
              : explanation.counts.matchingHashes === 0
                ? "None of the query fingerprints occurred in the catalog."
                : "Matches did not align strongly enough at one timestamp."}
          </p>
        )}
      </div>

      <dl className="metric-grid" aria-label="Recognition pipeline counts">
        <div><dt>Peaks</dt><dd>{explanation.counts.peaks}</dd></div>
        <div><dt>Fingerprints</dt><dd>{explanation.counts.fingerprints}</dd></div>
        <div><dt>Matching hashes</dt><dd>{explanation.counts.matchingHashes}</dd></div>
        <div><dt>Winning votes</dt><dd>{explanation.counts.winningVotes}</dd></div>
      </dl>

      <div className="visual-grid">
        <section className="explanation-panel" aria-labelledby="waveform-title">
          <h3 id="waveform-title">1. Query waveform</h3>
          <WaveformEnvelope
            points={explanation.waveformEnvelope}
            durationSeconds={explanation.queryDurationSeconds}
          />
        </section>
        <section className="explanation-panel" aria-labelledby="spectrogram-title">
          <h3 id="spectrogram-title">2. STFT spectrogram</h3>
          <SpectrogramCanvas spectrogram={explanation.spectrogram} />
        </section>
        <section className="explanation-panel" aria-labelledby="constellation-title">
          <h3 id="constellation-title">3. Spectral constellation</h3>
          <ConstellationPlot
            peaks={explanation.peaks}
            durationSeconds={explanation.queryDurationSeconds}
            maximumFrequencyHz={explanation.spectrogram.maximumFrequencyHz}
          />
        </section>
      </div>

      <section className="explanation-panel" aria-labelledby="alignment-title">
        <h3 id="alignment-title">4. Fingerprint alignment</h3>
        <FingerprintAlignment
          matches={explanation.matchedFingerprints}
          queryDurationSeconds={explanation.queryDurationSeconds}
          sourceInterval={sourceInterval}
        />
      </section>

      <section className="explanation-panel" aria-labelledby="votes-title">
        <h3 id="votes-title">5. Time-offset votes</h3>
        <VoteHistogram
          votes={explanation.offsetVotes}
          threshold={explanation.matchThreshold}
          timestampSeconds={recognition.timestampSeconds}
        />
      </section>
    </section>
  );
}
