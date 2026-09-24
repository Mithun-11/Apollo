export type RecognizedSong = {
  id: string;
  name: string;
  spotifyUrl: string;
};

export type RecognitionResponse = {
  matched: boolean;
  song: RecognizedSong | null;
  timestampSeconds: number | null;
  confidence: number;
  matchCount: number;
  /** Recording speed and pitch relative to the song; both 1 unless an edit was detected. */
  speedFactor?: number | null;
  pitchFactor?: number | null;
  /** "melody" when a cover, live version or crowd was matched by its melody. */
  matchMethod?: "melody";
  melodyScoreGap?: number;
  keyShiftSemitones?: number;
};

export type WaveformEnvelopePoint = {
  timeSeconds: number;
  minimum: number;
  maximum: number;
};

export type SpectrogramDisplay = {
  valuesDb: number[][];
  minimumDb: number;
  maximumDb: number;
  maximumFrequencyHz: number;
  durationSeconds: number;
};

export type PeakDisplay = {
  timeSeconds: number;
  frequencyHz: number;
  amplitudeDb: number;
  matched: boolean;
};

export type MatchedFingerprintDisplay = {
  queryAnchorSeconds: number;
  queryTargetSeconds: number;
  sourceAnchorSeconds: number;
  sourceTargetSeconds: number;
  anchorFrequencyHz: number;
  targetFrequencyHz: number;
};

export type OffsetVoteDisplay = {
  offsetSeconds: number;
  count: number;
  winning: boolean;
};

export type PairExample = {
  anchorSeconds: number;
  targetSeconds: number;
  anchorFrequencyHz: number;
  targetFrequencyHz: number;
  deltaFrames: number;
};

export type CandidateVote = {
  songName: string;
  votes: number;
  offsetSeconds: number;
};

export type RecognitionExplanation = {
  queryDurationSeconds: number;
  sampleRate: number;
  waveformEnvelope: WaveformEnvelopePoint[];
  spectrogram: SpectrogramDisplay;
  peaks: PeakDisplay[];
  matchedFingerprints: MatchedFingerprintDisplay[];
  offsetVotes: OffsetVoteDisplay[];
  sourceInterval: {
    startSeconds: number;
    endSeconds: number;
  } | null;
  counts: {
    peaks: number;
    fingerprints: number;
    lookupFingerprints: number;
    matchingHashes: number;
    winningVotes: number;
  };
  matchThreshold: number;
  signalConfig: {
    fftSize: number;
    hopLength: number;
    minimumFrequencyHz: number;
    maximumFrequencyHz: number;
    peakFloorDb: number;
    peaksPerSecond: number;
    fanOut: number;
    fingerprintVersion: string;
  };
  pairExamples: PairExample[];
  decision: {
    reason: "accepted" | "no_fingerprints" | "no_catalog_hits" | "no_valid_offsets" | "below_threshold" | "ambiguous";
    leadingVotes: number;
    leadingOffsetSeconds: number | null;
    runnerUpVotes: number;
    minimumVotes: number;
    minimumWinnerRatio: number;
    offsetToleranceFrames: number;
    clusteredOffsetVotes: OffsetVoteDisplay[];
  };
  candidateVotes: CandidateVote[];
  melodyMatch: {
    scoreGap: number;
    keyShiftSemitones: number;
    startSeconds: number;
    ranking: { songName: string; score: number }[];
  } | null;
  processingTimesMs: Record<string, number> | null;
};

/** Replay evidence, fetched after the answer so recognition never waits for it. */
export type StageTiming = { stage: string; detail: string; milliseconds: number };
export type CatalogSong = { songId: string; name: string; fingerprints: number; hashHits: number };
export type SongVote = { songId: string; votes: number; offsetSeconds: number };
export type SpeedCandidate = { speedFactor: number; pitchFactor: number; votes: number };
export type SkyPeak = { timeSeconds: number; frequencyHz: number; amplitudeDb: number };
export type MelodyEvidence = {
  framesPerSecond: number;
  query: number[];
  queryShifted: number[];
  song: number[];
  path: [number, number][];
  keyShiftSemitones: number;
  mixSpectrogram: number[][];
  vocalSpectrogram: number[][];
};
export type RecognitionEvidence = {
  durationSeconds: number;
  timings: StageTiming[];
  songs: CatalogSong[];
  votes: SongVote[];
  catalogFingerprints: number;
  speedCurve: SpeedCandidate[] | null;
  songSky: { startSeconds: number; durationSeconds: number; peaks: SkyPeak[] } | null;
  melody: MelodyEvidence | null;
};

export type RecognitionExplanationResponse = {
  recognition: RecognitionResponse;
  explanation: RecognitionExplanation;
};

type ApiError = { error?: { message?: string } };
const RECOGNITION_TIMEOUT_MS = 60_000;

async function postAudio<T>(
  endpoint: string,
  audio: Blob,
  fallbackMessage: string,
  fields: Record<string, string> = {},
): Promise<T> {
  const form = new FormData();
  form.append("audio", audio, "microphone.wav");
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), RECOGNITION_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    const body = (await response.json()) as T & ApiError;
    if (!response.ok) {
      throw new Error(body.error?.message ?? fallbackMessage);
    }
    return body;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Recognition took too long. Please try a shorter recording.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function recognizeAudio(audio: Blob): Promise<RecognitionResponse> {
  return postAudio<RecognitionResponse>("/backend/recognize", audio, "Recognition failed");
}

/** `liveChecksFailed`: no live check matched, so the backend skips the edit search they already ran. */
export async function recognizeAudioWithExplanation(
  audio: Blob,
  liveChecksFailed = false,
): Promise<RecognitionExplanationResponse> {
  return postAudio<RecognitionExplanationResponse>(
    "/backend/recognize/explain",
    audio,
    "Recognition explanation failed",
    { liveChecksFailed: String(liveChecksFailed) },
  );
}

export async function fetchRecognitionEvidence(
  audio: Blob,
  recognition: RecognitionResponse,
): Promise<RecognitionEvidence> {
  return postAudio<RecognitionEvidence>(
    "/backend/recognize/evidence",
    audio,
    "Replay evidence failed",
    {
      songId: recognition.song?.id ?? "",
      timestampSeconds: String(recognition.timestampSeconds ?? 0),
      speedFactor: String(recognition.speedFactor ?? 1),
      pitchFactor: String(recognition.pitchFactor ?? 1),
      matchMethod: recognition.matchMethod ?? "fingerprint",
    },
  );
}
