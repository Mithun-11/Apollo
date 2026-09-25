import type { RecognitionExplanationResponse, RecognitionResponse } from "../../lib/api";

function timestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export default function ResultHero({ recognition, explanation }: { recognition: RecognitionResponse; explanation: RecognitionExplanationResponse["explanation"] | null }) {
  if (!recognition.matched || !recognition.song) return null;
  const speed = recognition.speedFactor ?? 1;
  const pitch = recognition.pitchFactor ?? 1;
  const edit = Math.abs(speed - 1) >= .02 ? `Playback speed ${speed.toFixed(2)}×` : Math.abs(pitch - 1) >= .02 ? `Pitch ${12 * Math.log2(pitch) >= 0 ? "+" : ""}${(12 * Math.log2(pitch)).toFixed(1)} semitones` : null;
  const interval = explanation?.sourceInterval;
  return (
    <section className="result-hero" aria-label="Recognized song">
      <p className="result-label">Song identified</p>
      <h2>{recognition.song.name}</h2>
      {recognition.timestampSeconds !== null && <p className="result-position">Starting at <strong>{timestamp(recognition.timestampSeconds)}</strong> in the catalog song</p>}
      {interval && <div className="result-interval"><div className="result-interval-bar"><span /></div><small>Matched source segment: {timestamp(interval.startSeconds)}–{timestamp(interval.endSeconds)}. Full song duration is not available.</small></div>}
      {edit && <p className="edit-pill">{edit}</p>}
      <div className="evidence-meter"><span>Matched-vote share of query fingerprints</span><strong>{Math.round(recognition.confidence * 100)}%</strong><i><b style={{ width: `${Math.min(100, Math.max(0, recognition.confidence * 100))}%` }} /></i><small>Evidence ratio, not a probability of correctness</small></div>
      <a className="spotify-button" href={recognition.song.spotifyUrl} target="_blank" rel="noreferrer">Open in Spotify ↗</a>
    </section>
  );
}
