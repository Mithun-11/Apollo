/**
 * The stops of the journey, in the order the class meets them. Every sentence is written from
 * this recording's own numbers; stops that do not apply (an edit, a cover) are left out.
 */

import type { ChapterId } from "./world";
import { type ReplayData, formatClock, formatCount } from "./data";

export type ChapterSpec = {
  id: ChapterId;
  kanji: string;
  title: string;
  /** Name on the journey rail. */
  short: string;
  sentence: string;
  figure: { value: string; unit: string } | null;
  /** Seconds a stop needs for its animation before the next can follow in the highlight. */
  settle: number;
};

export function buildChapters(data: ReplayData): ChapterSpec[] {
  const { explanation, recognition } = data.response;
  const config = explanation.signalConfig;
  const numbers = Math.round(data.duration * data.sampleRate);
  const frameMs = (config.fftSize / data.sampleRate) * 1000;
  const hopMs = (config.hopLength / data.sampleRate) * 1000;
  const slices = Math.round((data.duration * data.sampleRate) / config.hopLength);
  const pitches = config.fftSize / 2 + 1;
  const songCount = data.evidence?.songs.length;
  const totalHits = data.evidence?.songs.reduce((sum, song) => sum + song.hashHits, 0) ?? explanation.counts.matchingHashes;
  const decision = explanation.decision;
  const edited = Math.abs(data.speedFactor - 1) >= 0.01 || Math.abs(data.pitchFactor - 1) >= 0.01;
  const melody = recognition.matchMethod === "melody";

  const chapters: ChapterSpec[] = [
    {
      id: "sound",
      short: "Sound",
      kanji: "音",
      title: "Sound is a list of numbers",
      sentence: `The microphone measured the air pressure ${formatCount(data.sampleRate)} times every second. ${data.duration.toFixed(1)} seconds of listening became ${formatCount(numbers)} numbers, and that is all the computer receives.`,
      figure: { value: formatCount(numbers), unit: "numbers" },
      settle: 4,
    },
    {
      id: "spectrum",
      short: "Spectrum",
      kanji: "空",
      title: "Splitting sound into pitches",
      sentence: `A ${Math.round(frameMs)} ms window slides along the sound, ${Math.round(hopMs)} ms at a time. For every slice, a Fourier transform measures how strong each pitch is. Laid side by side, the slices paint this sky: time runs to the right, pitch rises up.`,
      figure: { value: formatCount(slices), unit: `slices × ${formatCount(pitches)} pitches` },
      settle: 8,
    },
    {
      id: "stars",
      short: "Stars",
      kanji: "星",
      title: "Only the brightest points survive",
      sentence: `Most of the sky is haze. In every small patch Apollo keeps only the brightest point, at most ${config.peaksPerSecond} a second. A storm of noise can churn the whole lake, yet it rarely moves these peaks. Press N to add noise.`,
      figure: { value: formatCount(explanation.counts.peaks), unit: "stars" },
      settle: 5.5,
    },
    {
      id: "fingerprint",
      short: "Fingerprints",
      kanji: "結",
      title: "Pairs of stars become fingerprints",
      sentence: `Each star reaches forward to up to ${config.fanOut} stars in a small zone just ahead of it. Two pitches and the time between them make one fingerprint: a number that comes out the same in any recording of this song.`,
      figure: { value: formatCount(explanation.counts.fingerprints), unit: "fingerprints" },
      settle: 6.5,
    },
    {
      id: "catalog",
      short: "Catalog",
      kanji: "星空",
      title: "Asking the catalog",
      sentence: data.evidence
        ? `Every fingerprint is looked up in an index of ${formatCount(data.evidence.catalogFingerprints)} fingerprints from ${songCount} songs. The hits land all over the catalog, because most of them are coincidences.`
        : `Every fingerprint is looked up in the catalog's index. The hits land all over it, because most of them are coincidences.`,
      figure: { value: formatCount(totalHits), unit: "hits" },
      settle: 7,
    },
  ];

  if (edited && data.evidence?.speedCurve) {
    const percent = Math.round(data.speedFactor * 100);
    chapters.push({
      id: "warp",
      short: "Speed search",
      kanji: "速度",
      title: "When the song is sped up or slowed",
      sentence: `This recording runs at ${percent}% of the original speed, so every pitch and every gap is off and almost no fingerprint matches. Apollo re-measures the stars under ${data.evidence.speedCurve.length} guesses of speed and pitch. One guess makes them line up.`,
      figure: { value: `${data.speedFactor.toFixed(2)}×`, unit: "speed found" },
      settle: 8.5,
    });
  }

  if (melody) {
    const shift = data.evidence?.melody?.keyShiftSemitones ?? recognition.keyShiftSemitones ?? 0;
    chapters.push({
      id: "voice",
      short: "Voice",
      kanji: "声",
      title: "Another voice, the same melody",
      sentence: `A cover shares almost no fingerprints with the original. So a neural network lifts the voice out of the band, pitch tracking follows the tune, and dynamic time warping compares its shape against every song in all 12 keys.`,
      figure: { value: shift === 0 ? "same key" : `${shift > 0 ? "+" : "−"}${Math.abs(shift)}`, unit: shift === 0 ? "as the original" : "semitones" },
      settle: 13,
    });
  } else if (recognition.matched) {
    chapters.push({
      id: "musubi",
      short: "Alignment",
      kanji: "結び",
      title: "The stars that line up",
      sentence: `A coincidence can hit any song at any moment. Only the true song has its hits at one constant offset: slide its stars to ${formatClock(recognition.timestampSeconds ?? 0)} and ${formatCount(decision.leadingVotes)} fingerprints tie together. The next best position manages ${formatCount(decision.runnerUpVotes)}.`,
      figure: { value: formatCount(decision.leadingVotes), unit: "fingerprints agree" },
      settle: 11,
    });
  } else {
    chapters.push({
      id: "musubi",
      short: "Alignment",
      kanji: "結び",
      title: "No moment lined up",
      sentence: `The hits scattered: no song had at least ${decision.minimumVotes} fingerprints agreeing on one moment, clearly ahead of the rest. Apollo would rather say nothing than guess.`,
      figure: { value: formatCount(decision.leadingVotes), unit: "best agreement" },
      settle: 10,
    });
  }

  chapters.push(
    {
      id: "listen",
      short: "Listen",
      kanji: "聴く",
      title: "Hear only the stars",
      sentence: `This is the recording reduced to its ${formatCount(explanation.peaks.length)} stars, each played as a pure tone. Almost all of the sound is gone, yet the tune survives. That is why a few hundred peaks are enough to recognize a song.`,
      figure: null,
      settle: 4,
    },
    {
      id: "verdict",
      short: "Answer",
      kanji: "音の星空",
      title: recognition.matched && recognition.song ? recognition.song.name : "No match",
      sentence: "",
      figure: null,
      settle: 4,
    },
  );
  return chapters;
}

/** The short version shown after an everyday recognition. */
export const HIGHLIGHT: ChapterId[] = ["spectrum", "stars", "catalog", "warp", "voice", "musubi", "verdict"];
