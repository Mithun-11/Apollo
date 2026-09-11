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
};

type ApiError = { error?: { message?: string } };

export async function recognizeAudio(audio: Blob): Promise<RecognitionResponse> {
  const form = new FormData();
  form.append("audio", audio, "microphone.wav");
  const response = await fetch("/backend/recognize", { method: "POST", body: form });
  const body = (await response.json()) as RecognitionResponse & ApiError;
  if (!response.ok) {
    throw new Error(body.error?.message ?? "Recognition failed");
  }
  return body;
}
