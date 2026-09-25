"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchRecognitionEvidence,
  recognizeAudio,
  recognizeAudioWithExplanation,
  type RecognitionEvidence,
  type RecognitionExplanationResponse,
  type RecognitionResponse,
} from "../lib/api";
import { type ReplayData, buildSky, decodeRecording, songStarsOnRecording } from "./replay/data";
import Horizon from "./sky/horizon";
import LiveSky, { type LiveCheck } from "./sky/live-sky";
import PaintedSky from "./sky/painted-sky";
import TitleCard from "./title-card";

// The replay and its 3D world load only when someone opens it: never during listening.
const loadReplay = () => import("./replay/replay");
const Replay = dynamic(loadReplay, { ssr: false });

// Listening stops as soon as two consecutive checks agree on the song and its position,
// like Shazam; otherwise it stops at the maximum and recognizes whatever was captured.
const MAX_RECORDING_SECONDS = 15;
const FIRST_CHECK_SECONDS = 2;
const CHECK_INTERVAL_SECONDS = 1;
const TIMER_TICK_MS = 250;
// Both checks start at the same moment in the song, so their timestamps must agree.
const TIMESTAMP_AGREEMENT_SECONDS = 0.25;
// If no live check has matched by then, the full answer (melody matching for covers and live
// versions) is requested early in the background, so it is ready when listening stops.
const EARLY_ANSWER_SECONDS = 10;
// Use the browser's device defaults. Explicit mono/raw constraints left the built-in
// microphone array unusable on a Windows laptop where audio: true records correctly.
const MICROPHONE_CONSTRAINTS: MediaStreamConstraints = {
  audio: true,
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

type CheckEvent = { seconds: number; text: string };

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
  const [checkMessage, setCheckMessage] = useState("Waiting for the first check at 2 seconds");
  const [checks, setChecks] = useState<CheckEvent[]>([]);
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
  const sampleRateRef = useRef(48_000);
  const recordingBlobRef = useRef<Blob | null>(null);
  const [replayMode, setReplayMode] = useState<"highlight" | "class" | null>(null);
  const [evidence, setEvidence] = useState<RecognitionEvidence | null>(null);
  const [decoded, setDecoded] = useState<{ samples: Float32Array; rate: number } | null>(null);
  // Set when someone opens the replay; nothing heavy runs before that.
  const [evidenceWanted, setEvidenceWanted] = useState(false);
  const [skyEpoch, setSkyEpoch] = useState(0);

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
    setReplayMode(null);
    setEvidence(null);
    setDecoded(null);
    setEvidenceWanted(false);
    replacePlaybackUrl(null);
    setVolume(0);
    setChecks([]);
    setSkyEpoch((value) => value + 1);
    setCheckMessage("Waiting for the first check at 2 seconds");
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
      sampleRateRef.current = sampleRate;

      let confirmedRecognition: RecognitionResponse | null = null;
      // Objects rather than plain variables: the timer callbacks below update them.
      const live = { allChecksFailed: true };
      const early: { answer: Promise<RecognitionExplanationResponse | null> | null } = {
        answer: null,
      };
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
          if (early.answer === null && live.allChecksFailed && elapsedSeconds >= EARLY_ANSWER_SECONDS) {
            early.answer = recognizeAudioWithExplanation(encodeWav(chunks.current, sampleRate), true)
              .then((response) => {
                if (response.recognition.matched) activeSession.finish();
                return response;
              })
              .catch(() => null);
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
          setCheckMessage(`Checking ${elapsedSeconds.toFixed(1)} seconds of audio…`);
          recognizeAudio(encodeWav(chunks.current, sampleRate))
            .then((response) => {
              if (!capturing.current || unmounted.current) return;
              const confirmed = isConfirmedMatch(previousCheck, response);
              if (response.matched) live.allChecksFailed = false;
              const text = confirmed ? "Stable match confirmed" : response.matched ? "Possible match; checking again" : "No stable match yet";
              setCheckMessage(text);
              setChecks((current) => [...current, { seconds: elapsedSeconds, text }].slice(-40));
              if (confirmed) {
                confirmedRecognition = response;
                activeSession.finish();
              }
              previousCheck = response.matched ? response : null;
            })
            .catch(() => {
              // A failed early check only delays the answer; the final request reports errors.
              previousCheck = null;
              if (capturing.current && !unmounted.current) setCheckMessage("Check unavailable; continuing to listen");
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
      recordingBlobRef.current = recording;
      replacePlaybackUrl(recording);
      // Use the early answer when it found the song; otherwise ask again with all the audio.
      const earlyResponse = confirmedRecognition === null && early.answer ? await early.answer : null;
      const response = earlyResponse?.recognition.matched
        ? earlyResponse
        : await recognizeAudioWithExplanation(recording, live.allChecksFailed);
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
  const [frozen, setFrozen] = useState<ReplayData | null>(null);
  const [pendingReplay, setPendingReplay] = useState<"highlight" | "class" | null>(null);

  // Replay evidence costs seconds of backend work, so it is fetched only when the replay is
  // opened: the answer and the song still playing in the room never compete with it.
  useEffect(() => {
    const blob = recordingBlobRef.current;
    if (!evidenceWanted || !result || !blob || !playbackUrl) return;
    let cancelled = false;
    fetchRecognitionEvidence(blob, result.recognition)
      .then((value) => {
        if (!cancelled) setEvidence(value);
      })
      .catch((error: unknown) => console.debug("Replay evidence unavailable", error));
    void decodeRecording(playbackUrl).then((value) => {
      if (!cancelled) setDecoded(value);
    });
    return () => {
      cancelled = true;
    };
  }, [evidenceWanted, result, playbackUrl]);

  const sky = useMemo(() => (result ? buildSky(result) : null), [result]);
  const replayData = useMemo<ReplayData | null>(() => {
    if (!result || !sky) return null;
    const recognition = result.recognition;
    const speedFactor = recognition.speedFactor ?? 1;
    const pitchFactor = recognition.pitchFactor ?? 1;
    return {
      response: result,
      evidence,
      duration: result.explanation.queryDurationSeconds,
      sampleRate: result.explanation.sampleRate,
      ...sky,
      samples: decoded?.samples ?? null,
      samplesRate: decoded?.rate ?? 22_050,
      songStars: songStarsOnRecording(evidence, speedFactor),
      speedFactor,
      pitchFactor,
      matched: recognition.matched,
      songName: recognition.song?.name ?? "",
    };
  }, [result, sky, evidence, decoded]);

  // The journey starts once its evidence has arrived (it usually has by the time anyone clicks).
  useEffect(() => {
    if (!pendingReplay || !replayData) return;
    const start = () => {
      setFrozen(replayData);
      setReplayMode(pendingReplay);
      setPendingReplay(null);
    };
    if (evidence) {
      start();
      return;
    }
    // Covers take longest: the evidence separates the voice again. Start anyway after 12 s.
    const timer = window.setTimeout(start, 12_000);
    return () => window.clearTimeout(timer);
  }, [pendingReplay, replayData, evidence]);

  function openReplay(mode: "highlight" | "class") {
    setFrozen(null);
    setReplayMode(null);
    setPendingReplay(mode);
    setEvidenceWanted(true);
    void loadReplay();
  }

  function closeReplay() {
    setFrozen(null);
    setReplayMode(null);
    setPendingReplay(null);
  }

  // Back to the start screen: the sky is cleared and nothing records until Listen is pressed.
  function goHome() {
    if (busy.current) return;
    closeReplay();
    setEvidence(null);
    setDecoded(null);
    setEvidenceWanted(false);
    replacePlaybackUrl(null);
    setChecks([]);
    setSkyEpoch((value) => value + 1);
    setState({ phase: "ready" });
  }

  const isBusy =
    state.phase === "starting-microphone" ||
    state.phase === "recording" ||
    state.phase === "processing";
  const liveChecks: LiveCheck[] = checks.map((check) => ({
    seconds: check.seconds,
    kind: check.text.startsWith("Stable") ? "confirmed" : check.text.startsWith("Possible") ? "possible" : "none",
  }));
  const status =
    state.phase === "ready"
      ? source === "tab"
        ? "Play the song in another window, then share that tab."
        : "Hold the song near the microphone."
      : state.phase === "starting-microphone"
        ? source === "tab"
          ? "Choose the tab playing the song and turn on “Share tab audio”."
          : "Opening the microphone…"
        : state.phase === "recording"
          ? checkMessage
          : state.phase === "processing"
            ? state.recognition
              ? "Found it. Preparing the answer…"
              : "Listening is done. Searching the catalog…"
            : state.phase === "complete"
              ? ""
              : state.message;
  const replaying = frozen !== null && replayMode !== null;
  // A confirmed live check is the answer: show it at once, while the explanation is still fetched.
  const confirmedEarly = state.phase === "processing" && state.recognition?.matched ? state.recognition : null;

  return (
    <main className={`stage stage-${state.phase}${replaying ? " stage-replay" : ""}`}>
      <PaintedSky
        paused={state.phase === "starting-microphone" || state.phase === "recording" || state.phase === "processing"}
        calm={replaying ? 1 : result || state.phase === "recording" || state.phase === "processing" ? 0.55 : 0} />
      <LiveSky
        chunksRef={chunks}
        sampleRateRef={sampleRateRef}
        recording={state.phase === "recording"}
        durationSeconds={MAX_RECORDING_SECONDS}
        checks={liveChecks}
        opacity={replaying ? 0 : result ? 0.4 : 1}
        epoch={skyEpoch}
      />
      <Horizon />

      <header className="credit">
        <p className="credit-jp" lang="ja">音の星空</p>
        <h1 className="credit-name">Apollo</h1>
      </header>

      {replaying && frozen && replayMode && playbackUrl ? (
        <Replay
          key={replayMode}
          data={frozen}
          mode={replayMode}
          recordingUrl={playbackUrl}
          onExit={closeReplay}
          onClassMode={() => openReplay("class")}
          onHome={goHome}
        />
      ) : result || confirmedEarly ? (
        <TitleCard
          recognition={result?.recognition ?? confirmedEarly!}
          preparing={!result}
          waiting={pendingReplay !== null}
          onWatch={() => openReplay("highlight")}
          onClassMode={() => openReplay("class")}
          onHome={goHome}
        />
      ) : (
        <section className="console" aria-label="Listen for a song">
          <div className="source-switch" role="radiogroup" aria-label="Where the sound comes from">
            {(["microphone", "tab"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={source === option}
                className="source-option"
                disabled={isBusy}
                onClick={() => setSource(option)}
              >
                <SourceIcon kind={option} />
                {option === "microphone" ? "Microphone" : "Browser tab"}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="record"
            onClick={state.phase === "recording" ? stopRecording : listen}
            disabled={state.phase === "starting-microphone" || state.phase === "processing"}
            aria-label={state.phase === "recording" ? "Stop and recognize now" : "Listen"}
          >
            <span className="record-ring" aria-hidden="true" />
            <span className="record-core" aria-hidden="true" />
          </button>
          <p className="record-label">
            {state.phase === "recording"
              ? `Listening · ${state.elapsedSeconds} s`
              : state.phase === "processing"
                ? "Searching"
                : "Listen"}
          </p>
          <p className={state.phase === "error" ? "status status-error" : "status"} aria-live="polite">
            {status}
            {state.phase === "recording" ? <span className="status-hint"> · press again to stop early</span> : null}
            {state.phase === "recording" && volume < 0.004 ? <span className="status-hint"> · no sound is reaching Apollo yet</span> : null}
          </p>
        </section>
      )}
    </main>
  );
}

function SourceIcon({ kind }: { kind: AudioSource }) {
  return kind === "microphone" ? (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 9h18M6 7h.01M8.5 7h.01" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10 13.5l2.2 1.6L15 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
