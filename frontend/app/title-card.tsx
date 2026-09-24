import type { RecognitionResponse } from "../lib/api";
import { formatClock } from "./replay/data";

/** Spotify's own links accept a start time after "#", as minutes:seconds. */
export function spotifyAt(url: string, seconds: number | null): string {
  if (seconds === null) return url;
  return `${url.split("#")[0]}#${formatClock(seconds)}`;
}

export function describeEdit({ speedFactor, pitchFactor }: RecognitionResponse): string | null {
  if (speedFactor && Math.abs(speedFactor - 1) >= 0.02) {
    return `${speedFactor > 1 ? "Sped up" : "Slowed"} to ${Math.round(speedFactor * 100)}% of the original`;
  }
  if (pitchFactor && Math.abs(pitchFactor - 1) >= 0.02) {
    const semitones = 12 * Math.log2(pitchFactor);
    return `Pitch ${semitones > 0 ? "raised" : "lowered"} ${Math.abs(semitones).toFixed(1)} semitones`;
  }
  return null;
}

function describeMelody(recognition: RecognitionResponse): string | null {
  if (recognition.matchMethod !== "melody") return null;
  const shift = recognition.keyShiftSemitones ?? 0;
  const key = shift === 0 ? "in the original key" : `${Math.abs(shift)} semitone${Math.abs(shift) === 1 ? "" : "s"} ${shift > 0 ? "higher" : "lower"}`;
  return `Recognized by its melody: another performance, sung ${key}`;
}

type TitleCardProps = {
  recognition: RecognitionResponse;
  /** The replay was requested and waits for its evidence (usually well under a second). */
  waiting?: boolean;
  /** The answer is known but its explanation is still on the way: the replay cannot open yet. */
  preparing?: boolean;
  onWatch: () => void;
  onClassMode: () => void;
  onHome: () => void;
};

export default function TitleCard({ recognition, waiting = false, preparing = false, onWatch, onClassMode, onHome }: TitleCardProps) {
  const matched = recognition.matched && recognition.song;
  const detail = matched ? describeMelody(recognition) ?? describeEdit(recognition) : null;
  return (
    <section className="title-card" aria-live="polite" aria-labelledby="answer-title">
      {matched && recognition.song ? (
        <>
          <p className="title-card-moment">
            Heard at <strong>{formatClock(recognition.timestampSeconds ?? 0)}</strong> into
          </p>
          <h2 id="answer-title" className="title-card-song">{recognition.song.name}</h2>
          {detail ? <p className="title-card-detail">{detail}</p> : null}
        </>
      ) : (
        <>
          <h2 id="answer-title" className="title-card-song title-card-song-quiet">No song in the catalog matched</h2>
          <p className="title-card-detail">You can still watch what Apollo heard, and why nothing lined up.</p>
        </>
      )}
      <div className="title-card-actions">
        <button type="button" className="action action-primary" onClick={onWatch} disabled={waiting || preparing}>
          {preparing ? "Preparing the replay…" : waiting ? "Gathering the evidence…" : matched ? "Watch how it was found" : "Watch what Apollo heard"}
        </button>
        <button type="button" className="action" onClick={onClassMode} disabled={waiting || preparing}>
          Class mode
        </button>
        {matched && recognition.song ? (
          <a className="action" href={spotifyAt(recognition.song.spotifyUrl, recognition.timestampSeconds)} target="_blank" rel="noreferrer">
            Play on Spotify at {formatClock(recognition.timestampSeconds ?? 0)}
          </a>
        ) : null}
        {preparing ? null : (
          <button type="button" className="action action-quiet" onClick={onHome}>
            Try another song
          </button>
        )}
      </div>
    </section>
  );
}
