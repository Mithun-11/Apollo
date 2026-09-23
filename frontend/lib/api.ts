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
    matchingHashes: number;
    winningVotes: number;
  };
  matchThreshold: number;
  candidateVotes: unknown[];
  processingTimesMs: Record<string, number> | null;
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
): Promise<T> {
  const form = new FormData();
  form.append("audio", audio, "microphone.wav");
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

export async function recognizeAudioWithExplanation(
  audio: Blob,
): Promise<RecognitionExplanationResponse> {
  return postAudio<RecognitionExplanationResponse>(
    "/backend/recognize/explain",
    audio,
    "Recognition explanation failed",
  );
}
