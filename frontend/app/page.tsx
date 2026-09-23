"use client";

import { useEffect, useRef, useState } from "react";
import {
  recognizeAudio,
  recognizeAudioWithExplanation,
  type RecognitionExplanationResponse,
  type RecognitionResponse,
} from "../lib/api";
import LiveWaveform from "./live-waveform";
import RecognitionExplanation from "./recognition-explanation";

// Listening stops as soon as two consecutive checks agree on the song and its position,
// like Shazam; otherwise it stops at the maximum and recognizes whatever was captured.
const MAX_RECORDING_SECONDS = 15;
const FIRST_CHECK_SECONDS = 2;
const CHECK_INTERVAL_SECONDS = 1;
const TIMER_TICK_MS = 250;
// Both checks start at the same moment in the song, so their timestamps must agree.
const TIMESTAMP_AGREEMENT_SECONDS = 0.25;
// Browser voice processing (echo cancellation, noise suppression, gain control) is tuned for
// speech and distorts music, so the recording keeps the raw microphone signal.
const MICROPHONE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
};
const RECORDER_WORKLET = `
class ApolloRecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (samples) this.port.postMessage(samples.slice());
    return true;
  }
}
registerProcessor("apollo-recorder", ApolloRecorderProcessor);
`;

type RecognitionState =
  | { phase: "ready" }
  | { phase: "requesting-permission" }
  | { phase: "recording"; elapsedSeconds: number }
  | { phase: "processing" }
  | { phase: "complete"; response: RecognitionExplanationResponse }
  | { phase: "error"; message: string };

type RecordingSession = {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  recorder: AudioWorkletNode;
  silentOutput: GainNode;
  finish: () => void;
  tickTimerId: number | null;
  cleaned: boolean;
};

function isConfirmedMatch(
  previous: RecognitionResponse | null,
  current: RecognitionResponse,
): boolean {
  if (!previous?.matched || !current.matched || !previous.song || !current.song) return false;
  if (previous.timestampSeconds === null || current.timestampSeconds === null) return false;
  return (
    previous.song.id === current.song.id &&
    Math.abs(previous.timestampSeconds - current.timestampSeconds) <= TIMESTAMP_AGREEMENT_SECONDS
  );
}

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, sampleCount * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function cleanupRecordingSession(session: RecordingSession): Promise<void> {
  if (session.cleaned) return;
  session.cleaned = true;
  if (session.tickTimerId !== null) window.clearInterval(session.tickTimerId);
  session.recorder.port.onmessage = null;
  session.recorder.disconnect();
  session.recorder.port.close();
  session.silentOutput.disconnect();
  session.source.disconnect();
  session.stream.getTracks().forEach((track) => track.stop());
  await session.context.close();
}

export default function Home() {
  const [state, setState] = useState<RecognitionState>({ phase: "ready" });
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);
  const chunks = useRef<Float32Array[]>([]);
  const liveSamplesRef = useRef<Float32Array>(new Float32Array(0));
  const sessionRef = useRef<RecordingSession | null>(null);
  const playbackUrlRef = useRef<string | null>(null);
  const lastVolumeUpdate = useRef(0);
  const unmounted = useRef(false);
  const busy = useRef(false);

  useEffect(() => {
    unmounted.current = false; // Reset on every (re)mount — React Strict Mode runs cleanup + remount in dev.
    return () => {
      unmounted.current = true;
      const session = sessionRef.current;
      if (session) {
        session.finish();
        void cleanupRecordingSession(session);
      }
      if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
    };
  }, []);

  function replacePlaybackUrl(blob: Blob | null) {
    if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
    const nextUrl = blob ? URL.createObjectURL(blob) : null;
    playbackUrlRef.current = nextUrl;
    setPlaybackUrl(nextUrl);
  }

  function stopRecording() {
    sessionRef.current?.finish();
  }

  async function listen() {
    if (
      busy.current ||
      sessionRef.current ||
      state.phase === "requesting-permission" ||
      state.phase === "recording" ||
      state.phase === "processing"
    ) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({ phase: "error", message: "This browser does not support microphone access." });
      return;
    }

    busy.current = true;
    replacePlaybackUrl(null);
    chunks.current = [];
    liveSamplesRef.current = new Float32Array(0);
    setVolume(0);
    setState({ phase: "requesting-permission" });
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let session: RecordingSession | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(MICROPHONE_CONSTRAINTS);
      context = new AudioContext();
      if (!context.audioWorklet) {
        throw new Error("This browser does not support AudioWorklet recording.");
      }
      const workletUrl = URL.createObjectURL(
        new Blob([RECORDER_WORKLET], { type: "application/javascript" }),
      );
      try {
        await context.audioWorklet.addModule(workletUrl);
      } finally {
        URL.revokeObjectURL(workletUrl);
      }

      const source = context.createMediaStreamSource(stream);
      const recorder = new AudioWorkletNode(context, "apollo-recorder");
      const silentOutput = context.createGain();
      silentOutput.gain.value = 0;
      session = {
        stream,
        context,
        source,
        recorder,
        silentOutput,
        finish: () => undefined,
        tickTimerId: null,
        cleaned: false,
      };
      sessionRef.current = session;
      recorder.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const chunk = new Float32Array(event.data);
        chunks.current.push(chunk);
        liveSamplesRef.current = chunk;
        const now = performance.now();
        if (now - lastVolumeUpdate.current >= 100) {
          const sumSquares = chunk.reduce((sum, sample) => sum + sample * sample, 0);
          setVolume(chunk.length > 0 ? Math.sqrt(sumSquares / chunk.length) : 0);
          lastVolumeUpdate.current = now;
        }
      };
      source.connect(recorder);
      recorder.connect(silentOutput);
      silentOutput.connect(context.destination);
      setState({ phase: "recording", elapsedSeconds: 0 });
      const activeSession = session;
      const sampleRate = activeSession.context.sampleRate;

      const recordedChunks = await new Promise<Float32Array[]>((resolve) => {
        let resolved = false;
        let checkInFlight = false;
        let lastCheckSeconds = 0;
        let previousCheck: RecognitionResponse | null = null;
        const startedAt = performance.now();
        activeSession.finish = () => {
          if (resolved) return;
          resolved = true;
          resolve([...chunks.current]);
        };
        activeSession.tickTimerId = window.setInterval(() => {
          const elapsedSeconds = (performance.now() - startedAt) / 1000;
          setState((current) =>
            current.phase === "recording"
              ? { phase: "recording", elapsedSeconds: Math.floor(elapsedSeconds) }
              : current,
          );
          if (elapsedSeconds >= MAX_RECORDING_SECONDS) {
            activeSession.finish();
            return;
          }
          if (
            checkInFlight ||
            elapsedSeconds < FIRST_CHECK_SECONDS ||
            elapsedSeconds - lastCheckSeconds < CHECK_INTERVAL_SECONDS
          ) {
            return;
          }
          checkInFlight = true;
          lastCheckSeconds = elapsedSeconds;
          recognizeAudio(encodeWav(chunks.current, sampleRate))
            .then((response) => {
              if (isConfirmedMatch(previousCheck, response)) activeSession.finish();
              previousCheck = response.matched ? response : null;
            })
            .catch(() => {
              // A failed early check only delays the answer; the final request reports errors.
              previousCheck = null;
            })
            .finally(() => {
              checkInFlight = false;
            });
        }, TIMER_TICK_MS);
      });

      if (unmounted.current) return;
      setState({ phase: "processing" });
      await cleanupRecordingSession(session);
      sessionRef.current = null;
      const recording = encodeWav(recordedChunks, sampleRate);
      replacePlaybackUrl(recording);
      const response = await recognizeAudioWithExplanation(recording);
      if (unmounted.current) return;
      setState({ phase: "complete", response });
    } catch (error) {
      if (!unmounted.current) {
        setState({
          phase: "error",
          message: error instanceof Error ? error.message : "Unable to use the microphone",
        });
      }
    } finally {
      if (session) {
        await cleanupRecordingSession(session);
        if (sessionRef.current === session) sessionRef.current = null;
      } else {
        stream?.getTracks().forEach((track) => track.stop());
        await context?.close();
      }
      busy.current = false;
    }
  }

  const result = state.phase === "complete" ? state.response : null;
  const isBusy =
    state.phase === "requesting-permission" ||
    state.phase === "recording" ||
    state.phase === "processing";
  const status =
    state.phase === "ready"
      ? "Ready to listen"
      : state.phase === "requesting-permission"
        ? "Requesting microphone permission…"
        : state.phase === "recording"
          ? `Listening… ${state.elapsedSeconds}s (stops automatically once the song is recognized)`
          : state.phase === "processing"
            ? "Recognizing and explaining…"
            : state.phase === "complete"
              ? state.response.recognition.matched
                ? "Match found"
                : "No match found"
              : state.message;

  return (
    <main className="page-shell">
      <section className="card" aria-labelledby="title">
        <p className="eyebrow">APOLLO</p>
        <h1 id="title">What’s playing?</h1>
        <p className="subtitle">Listen to a nearby recording and find its Spotify track.</p>
        <button
          type="button"
          onClick={listen}
          disabled={isBusy}
          className={state.phase === "recording" ? "btn-recording" : ""}
        >
          {state.phase === "recording" ? "⏺ Recording…" : "🎙 Listen"}
        </button>
        {state.phase === "recording" ? (
          <button className="secondary-button" type="button" onClick={stopRecording}>
            Stop and recognize now
          </button>
        ) : null}
        <p className="status" aria-live="polite">{status}</p>
        {state.phase === "recording" ? (
          <div className="live-input">
            <LiveWaveform samplesRef={liveSamplesRef} />
            <p className="volume-label">Input level: {Math.round(Math.min(1, volume) * 100)}%</p>
          </div>
        ) : null}
        {playbackUrl ? (
          <div className="playback">
            <p className="result-label">Your local recording</p>
            <audio controls src={playbackUrl} />
          </div>
        ) : null}

        {result?.recognition.matched && result.recognition.song ? (
          <div className="result" aria-live="polite">
            <p className="result-label">
              Found at {formatTimestamp(result.recognition.timestampSeconds)}
            </p>
            <h2>{result.recognition.song.name}</h2>
            <a href={result.recognition.song.spotifyUrl} target="_blank" rel="noreferrer">
              Open in Spotify
            </a>
          </div>
        ) : null}

        {result ? <RecognitionExplanation response={result} /> : null}
      </section>
    </main>
  );
}

function formatTimestamp(seconds: number | null): string {
  if (seconds === null) return "an unknown timestamp";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
