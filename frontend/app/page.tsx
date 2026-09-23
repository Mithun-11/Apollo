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
// Tab audio is the exact digital signal a browser tab plays. Browsers only share it through
// their screen-share picker, and the API requires video, so the page offers tabs only and
// disables the video track it cannot avoid receiving. Chrome and Edge share tab audio on
// Windows and macOS; Safari and Firefox do not.
const TAB_CAPTURE_OPTIONS = {
  video: { displaySurface: "browser" },
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  preferCurrentTab: false,
  selfBrowserSurface: "exclude",
  surfaceSwitching: "include",
  systemAudio: "exclude",
} as DisplayMediaStreamOptions;
const TAB_AUDIO_UNSUPPORTED =
  "This browser cannot share tab audio. Use Chrome or Edge (Windows or macOS).";
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

type AudioSource = "microphone" | "tab";

type RecognitionState =
  | { phase: "ready" }
  | { phase: "starting-microphone" }
  | { phase: "recording"; elapsedSeconds: number }
  | { phase: "processing"; recognition: RecognitionResponse | null }
  | { phase: "complete"; response: RecognitionExplanationResponse }
  | { phase: "error"; message: string };

type Microphone = {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  recorder: AudioWorkletNode;
  silentOutput: GainNode;
};

type RecordingSession = {
  finish: () => void;
  tickTimerId: number | null;
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

function openMicrophoneStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(MICROPHONE_CONSTRAINTS);
}

async function openTabStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error(TAB_AUDIO_UNSUPPORTED);
  const stream = await navigator.mediaDevices.getDisplayMedia(TAB_CAPTURE_OPTIONS);
  stream.getVideoTracks().forEach((track) => {
    track.enabled = false;
  });
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(
      "No tab audio was shared. Pick a browser tab and turn on “Share tab audio”. " +
        TAB_AUDIO_UNSUPPORTED.replace("This browser cannot share tab audio. ", ""),
    );
  }
  return stream;
}

async function openMicrophone(
  onSamples: (samples: Float32Array) => void,
  openStream: () => Promise<MediaStream> = openMicrophoneStream,
): Promise<Microphone> {
  const stream = await openStream();
  const context = new AudioContext();
  try {
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
    // Stereo tab audio is mixed down to mono; the microphone is already mono.
    const recorder = new AudioWorkletNode(context, "apollo-recorder", {
      channelCount: 1,
      channelCountMode: "explicit",
    });
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    recorder.port.onmessage = (event: MessageEvent<Float32Array>) => {
      onSamples(new Float32Array(event.data));
    };
    source.connect(recorder);
    recorder.connect(silentOutput);
    silentOutput.connect(context.destination);
    // Idle until Listen: a suspended context uses no CPU and resumes within milliseconds.
    await context.suspend();
    return { stream, context, source, recorder, silentOutput };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
    throw error;
  }
}

function isMicrophoneLive(microphone: Microphone): boolean {
  return (
    microphone.context.state !== "closed" &&
    microphone.stream.getAudioTracks().some((track) => track.readyState === "live")
  );
}

async function closeMicrophone(microphone: Microphone): Promise<void> {
  microphone.recorder.port.onmessage = null;
  microphone.recorder.disconnect();
  microphone.recorder.port.close();
  microphone.silentOutput.disconnect();
  microphone.source.disconnect();
  microphone.stream.getTracks().forEach((track) => track.stop());
  if (microphone.context.state !== "closed") await microphone.context.close();
}

/**
 * Keeps one opened microphone ready, like a video call does, so Listen starts instantly.
 * Opening the device and loading the recorder takes a second or two, which previously
 * happened on every press.
 */
class MicrophoneKeeper {
  private opening: Promise<Microphone> | null = null;
  private ready: Microphone | null = null;

  constructor(
    private readonly onSamples: (samples: Float32Array) => void,
    private readonly openStream: () => Promise<MediaStream> = openMicrophoneStream,
  ) {}

  isReady(): boolean {
    return this.ready !== null && isMicrophoneLive(this.ready);
  }

  acquire(): Promise<Microphone> {
    if (this.ready && !isMicrophoneLive(this.ready)) this.release();
    if (this.opening) return this.opening;
    const opening: Promise<Microphone> = openMicrophone(this.onSamples, this.openStream).then(
      (microphone) => {
        if (this.opening !== opening) {
          void closeMicrophone(microphone);
          throw new Error("The microphone was released while it was starting.");
        }
        this.ready = microphone;
        return microphone;
      },
      (error: unknown) => {
        if (this.opening === opening) this.opening = null;
        throw error;
      },
    );
    this.opening = opening;
    return opening;
  }

  release(): void {
    const microphone = this.ready;
    this.opening = null;
    this.ready = null;
    if (microphone) void closeMicrophone(microphone);
  }
}

export default function Home() {
  const [state, setState] = useState<RecognitionState>({ phase: "ready" });
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);
  const chunks = useRef<Float32Array[]>([]);
  const liveSamplesRef = useRef<Float32Array>(new Float32Array(0));
  const sessionRef = useRef<RecordingSession | null>(null);
  const microphoneRef = useRef<MicrophoneKeeper | null>(null);
  const tabAudioRef = useRef<MicrophoneKeeper | null>(null);
  const [source, setSource] = useState<AudioSource>("microphone");
  const capturing = useRef(false);
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
        if (session.tickTimerId !== null) window.clearInterval(session.tickTimerId);
      }
      if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const receiveSamples = (chunk: Float32Array) => {
      if (!capturing.current) return;
      chunks.current.push(chunk);
      liveSamplesRef.current = chunk;
      const now = performance.now();
      if (now - lastVolumeUpdate.current >= 100) {
        const sumSquares = chunk.reduce((sum, sample) => sum + sample * sample, 0);
        setVolume(chunk.length > 0 ? Math.sqrt(sumSquares / chunk.length) : 0);
        lastVolumeUpdate.current = now;
      }
    };
    const keeper = new MicrophoneKeeper(receiveSamples);
    microphoneRef.current = keeper;
    // Tab sharing lasts for one Listen: it stops as soon as recording ends (see listen()).
    const tabAudio = new MicrophoneKeeper(receiveSamples, openTabStream);
    tabAudioRef.current = tabAudio;
    let active = true;

    // Warm up only when permission was already granted, so the page never prompts on load.
    const warmUp = async () => {
      if (
        document.visibilityState !== "visible" ||
        !navigator.mediaDevices?.getUserMedia ||
        !navigator.permissions
      ) {
        return;
      }
      const permission = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      if (active && permission.state === "granted") await keeper.acquire();
    };
    const warmUpInBackground = () => {
      warmUp().catch((error: unknown) => {
        // Listen opens the microphone itself when the background warm-up is unavailable.
        console.debug("Microphone warm-up skipped", error);
      });
    };
    // Free the microphone while the tab is hidden so the browser's mic indicator turns off.
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (!capturing.current) keeper.release();
      } else {
        warmUpInBackground();
      }
    };

    warmUpInBackground();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      keeper.release();
      tabAudio.release();
      if (microphoneRef.current === keeper) microphoneRef.current = null;
      if (tabAudioRef.current === tabAudio) tabAudioRef.current = null;
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
    const requestedSource = source;
    if (
      busy.current ||
      sessionRef.current ||
      state.phase === "starting-microphone" ||
      state.phase === "recording" ||
      state.phase === "processing"
    ) {
      return;
    }
    const keeper = requestedSource === "tab" ? tabAudioRef.current : microphoneRef.current;
    if (!keeper) return;
    if (requestedSource === "tab" && !navigator.mediaDevices?.getDisplayMedia) {
      setState({ phase: "error", message: TAB_AUDIO_UNSUPPORTED });
      return;
    }
    if (requestedSource === "microphone" && !navigator.mediaDevices?.getUserMedia) {
      setState({ phase: "error", message: "This browser does not support microphone access." });
      return;
    }

    busy.current = true;
    replacePlaybackUrl(null);
    setVolume(0);
    if (!keeper.isReady()) setState({ phase: "starting-microphone" });
    let session: RecordingSession | null = null;
    let microphone: Microphone | null = null;
    try {
      microphone = await keeper.acquire();
      if (!isMicrophoneLive(microphone)) {
        keeper.release();
        microphone = await keeper.acquire();
      }
      if (requestedSource === "tab") {
        // "Stop sharing" in the browser ends the recording early and recognizes what was heard.
        microphone.stream.getAudioTracks().forEach((track) => {
          track.onended = () => sessionRef.current?.finish();
        });
      }
      await microphone.context.resume();
      chunks.current = [];
      liveSamplesRef.current = new Float32Array(0);
      capturing.current = true;
      session = { finish: () => undefined, tickTimerId: null };
      sessionRef.current = session;
      setState({ phase: "recording", elapsedSeconds: 0 });
      const activeSession = session;
      const sampleRate = microphone.context.sampleRate;

      let confirmedRecognition: RecognitionResponse | null = null;
      const recordedChunks = await new Promise<Float32Array[]>((resolve) => {
        let resolved = false;
        let checkInFlight = false;
        let lastCheckSeconds = 0;
        let previousCheck: RecognitionResponse | null = null;
        const startedAt = performance.now();
        activeSession.finish = () => {
          if (resolved) return;
          resolved = true;
          if (activeSession.tickTimerId !== null) window.clearInterval(activeSession.tickTimerId);
          activeSession.tickTimerId = null;
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
              if (isConfirmedMatch(previousCheck, response)) {
                confirmedRecognition = response;
                activeSession.finish();
              }
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

      capturing.current = false;
      // Stop tab sharing as soon as recording ends, before waiting for the explanation.
      if (requestedSource === "tab") {
        keeper.release();
        microphone = null;
      }
      if (unmounted.current) return;
      setState({ phase: "processing", recognition: confirmedRecognition });
      const recording = encodeWav(recordedChunks, sampleRate);
      replacePlaybackUrl(recording);
      const response = await recognizeAudioWithExplanation(recording);
      if (unmounted.current) return;
      setState({ phase: "complete", response });
    } catch (error) {
      if (!unmounted.current) {
        setState({
          phase: "error",
          message:
            requestedSource === "tab" &&
            error instanceof DOMException &&
            error.name === "NotAllowedError"
              ? "Tab sharing was cancelled."
              : error instanceof Error
                ? error.message
                : "Unable to use the microphone",
        });
      }
    } finally {
      capturing.current = false;
      if (requestedSource === "tab") {
        keeper.release();
        microphone = null;
      }
      if (session) {
        if (session.tickTimerId !== null) window.clearInterval(session.tickTimerId);
        if (sessionRef.current === session) sessionRef.current = null;
      }
      // Keep the microphone open for the next Listen, but pause audio processing meanwhile.
      if (microphone?.context.state === "running") await microphone.context.suspend();
      busy.current = false;
    }
  }

  const result = state.phase === "complete" ? state.response : null;
  const recognition =
    state.phase === "complete"
      ? state.response.recognition
      : state.phase === "processing"
        ? state.recognition
        : null;
  const isBusy =
    state.phase === "starting-microphone" ||
    state.phase === "recording" ||
    state.phase === "processing";
  const status =
    state.phase === "ready"
      ? "Ready to listen"
      : state.phase === "starting-microphone"
        ? source === "tab"
          ? "Choose the tab playing the song and turn on “Share tab audio”…"
          : "Starting microphone…"
        : state.phase === "recording"
          ? `Listening… ${state.elapsedSeconds}s (stops automatically once the song is recognized)`
          : state.phase === "processing"
            ? state.recognition
              ? "Match found · loading the explanation…"
              : "Recognizing and explaining…"
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
        <div className="source-picker" role="radiogroup" aria-label="Audio source">
          {(["microphone", "tab"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={source === option}
              className={source === option ? "source-option source-option-active" : "source-option"}
              disabled={isBusy}
              onClick={() => setSource(option)}
            >
              {option === "microphone" ? "Microphone" : "Browser tab"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={listen}
          disabled={isBusy}
          className={state.phase === "recording" ? "btn-recording" : ""}
        >
          {state.phase === "recording"
            ? "⏺ Recording…"
            : source === "tab"
              ? "🔊 Listen"
              : "🎙 Listen"}
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

        {recognition?.matched && recognition.song ? (
          <div className="result" aria-live="polite">
            <p className="result-label">
              Found at {formatTimestamp(recognition.timestampSeconds)}
            </p>
            <h2>{recognition.song.name}</h2>
            {describeEdit(recognition) ? (
              <p className="result-label">{describeEdit(recognition)}</p>
            ) : null}
            <a href={recognition.song.spotifyUrl} target="_blank" rel="noreferrer">
              Open in Spotify
            </a>
          </div>
        ) : null}

        {result ? <RecognitionExplanation response={result} /> : null}
      </section>
    </main>
  );
}

function describeEdit({ speedFactor, pitchFactor }: RecognitionResponse): string | null {
  if (speedFactor && Math.abs(speedFactor - 1) >= 0.02) {
    const kind = speedFactor > 1 ? "sped up" : "slowed down";
    return `Detected edit: ${kind} (played at ${speedFactor.toFixed(2)}×)`;
  }
  if (pitchFactor && Math.abs(pitchFactor - 1) >= 0.02) {
    const semitones = 12 * Math.log2(pitchFactor);
    const kind = semitones > 0 ? "raised" : "lowered";
    return `Detected edit: pitch ${kind} ${Math.abs(semitones).toFixed(1)} semitones`;
  }
  return null;
}

function formatTimestamp(seconds: number | null): string {
  if (seconds === null) return "an unknown timestamp";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
