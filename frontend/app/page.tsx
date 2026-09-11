"use client";

import { useRef, useState } from "react";
import { recognizeAudio, type RecognitionResponse } from "../lib/api";

const RECORDING_SECONDS = 10;
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

export default function Home() {
  const [status, setStatus] = useState("Ready to listen");
  const [result, setResult] = useState<RecognitionResponse | null>(null);
  const [isListening, setIsListening] = useState(false);
  const chunks = useRef<Float32Array[]>([]);

  async function listen() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("This browser does not support microphone access.");
      return;
    }

    setIsListening(true);
    setResult(null);
    setStatus(`Listening for ${RECORDING_SECONDS} seconds…`);
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      chunks.current = [];
      recorder.port.onmessage = (event: MessageEvent<Float32Array>) => {
        chunks.current.push(new Float32Array(event.data));
      };
      source.connect(recorder);
      recorder.connect(silentOutput);
      silentOutput.connect(context.destination);
      await new Promise((resolve) => window.setTimeout(resolve, RECORDING_SECONDS * 1000));
      recorder.disconnect();
      recorder.port.close();
      silentOutput.disconnect();
      source.disconnect();

      setStatus("Recognizing…");
      const response = await recognizeAudio(encodeWav(chunks.current, context.sampleRate));
      setResult(response);
      setStatus(response.matched ? "Match found" : "No match found");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to use the microphone");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      await context?.close();
      setIsListening(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="card" aria-labelledby="title">
        <p className="eyebrow">APOLLO</p>
        <h1 id="title">What’s playing?</h1>
        <p className="subtitle">Listen to a nearby recording and find its Spotify track.</p>
        <button type="button" onClick={listen} disabled={isListening}>
          {isListening ? "Listening…" : "Listen"}
        </button>
        <p className="status" aria-live="polite">{status}</p>

        {result?.matched && result.song ? (
          <div className="result" aria-live="polite">
            <p className="result-label">Found at {formatTimestamp(result.timestampSeconds)}</p>
            <h2>{result.song.name}</h2>
            <a href={result.song.spotifyUrl} target="_blank" rel="noreferrer">
              Open in Spotify
            </a>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function formatTimestamp(seconds: number | null): string {
  if (seconds === null) return "an unknown timestamp";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
