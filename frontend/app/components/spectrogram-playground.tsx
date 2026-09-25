"use client";

import { useEffect, useRef, useState } from "react";
import type { RecognitionExplanation } from "../../lib/api";

const WIDTH = 520;
const HEIGHT = 220;
type Wave = OscillatorType;

export default function SpectrogramPlayground({ config }: { config: RecognitionExplanation["signalConfig"] }) {
  const [frequency, setFrequency] = useState(440);
  const [wave, setWave] = useState<Wave>("sine");
  const [fftSize, setFftSize] = useState(config.fftSize);
  const [hopLength, setHopLength] = useState(config.hopLength);
  const [running, setRunning] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<{ context: AudioContext; analyser: AnalyserNode; oscillator: OscillatorNode; gain: GainNode } | null>(null);

  const stopTone = () => {
    const engine = engineRef.current;
    engineRef.current = null;
    if (!engine) return;
    engine.oscillator.stop();
    engine.oscillator.disconnect();
    engine.analyser.disconnect();
    engine.gain.disconnect();
    void engine.context.close();
    setRunning(false);
  };

  const toggleTone = async () => {
    if (engineRef.current) { stopTone(); return; }
    setAudioError(null);
    const context = new AudioContext();
    try {
      const oscillator = context.createOscillator();
      const analyser = context.createAnalyser();
      const gain = context.createGain();
      oscillator.type = wave;
      oscillator.frequency.value = frequency;
      analyser.fftSize = fftSize;
      gain.gain.value = .08;
      oscillator.connect(analyser);
      analyser.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      await context.resume();
      engineRef.current = { context, analyser, oscillator, gain };
      setRunning(true);
    } catch {
      setAudioError("The browser could not start the demonstration audio.");
      await context.close();
    }
  };

  useEffect(() => {
    const engine = engineRef.current;
    if (engine) { engine.oscillator.frequency.setTargetAtTime(frequency, engine.context.currentTime, .02); engine.oscillator.type = wave; }
  }, [frequency, wave, running]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!running || !engine) return;
    const { context, analyser } = engine;
    analyser.fftSize = fftSize;
    const canvas = canvasRef.current;
    const drawing = canvas?.getContext("2d");
    const bins = new Float32Array(analyser.frequencyBinCount);
    if (canvas && drawing) { canvas.width = WIDTH; canvas.height = HEIGHT; drawing.fillStyle = "#0f1e24"; drawing.fillRect(0, 0, WIDTH, HEIGHT); }
    const timer = window.setInterval(() => {
      if (!drawing || !canvas) return;
      analyser.getFloatFrequencyData(bins);
      drawing.drawImage(canvas, -2, 0);
      const maxBin = Math.min(bins.length, Math.max(1, Math.floor(5000 / (context.sampleRate / 2) * bins.length)));
      for (let y = 0; y < HEIGHT; y++) {
        const bin = Math.min(maxBin - 1, Math.floor((1 - y / HEIGHT) * maxBin));
        const strength = Math.max(0, Math.min(1, (bins[bin] + 100) / 90));
        drawing.fillStyle = `rgb(${Math.round(22 + strength * 230)},${Math.round(15 + strength * 150)},${Math.round(40 + strength * 45)})`;
        drawing.fillRect(WIDTH - 2, y, 2, 1);
      }
    }, Math.max(20, hopLength / context.sampleRate * 1000));
    return () => window.clearInterval(timer);
  }, [running, fftSize, hopLength]);

  useEffect(() => () => {
    const engine = engineRef.current;
    engineRef.current = null;
    if (engine) { engine.oscillator.stop(); engine.oscillator.disconnect(); engine.analyser.disconnect(); engine.gain.disconnect(); void engine.context.close(); }
  }, []);

  const playSample = (kind: "chord" | "drum") => {
    const engine = engineRef.current;
    if (!engine) return;
    const { context, analyser } = engine;
    const duration = .7;
    const buffer = context.createBuffer(1, Math.floor(duration * context.sampleRate), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const time = i / context.sampleRate;
      const envelope = Math.exp(-time * (kind === "drum" ? 12 : 4));
      data[i] = envelope * (kind === "chord" ? (Math.sin(2 * Math.PI * 261.6 * time) + Math.sin(2 * Math.PI * 329.6 * time) + Math.sin(2 * Math.PI * 392 * time)) / 9 : Math.sin(2 * Math.PI * (120 - time * 100) * time) * .25);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    source.onended = () => source.disconnect();
    source.start();
  };

  return <div className="lab-tool"><h3>Interactive spectrogram</h3><p>Generate a real tone and watch its changing frequency spectrum. While it runs, play a chord or drum hit through the same analyzer. The browser samples at an approximate hop interval; this is a teaching visualization, not Apollo&apos;s backend STFT.</p><div className="lab-controls"><label>Frequency <input type="range" min="100" max="2000" value={frequency} onChange={(event) => setFrequency(Number(event.target.value))} />{frequency} Hz</label><label>Waveform <select value={wave} onChange={(event) => setWave(event.target.value as Wave)}><option value="sine">Sine</option><option value="square">Square</option><option value="sawtooth">Sawtooth</option></select></label><label>FFT size <select value={fftSize} onChange={(event) => setFftSize(Number(event.target.value))}>{[512,1024,2048,4096].map((size) => <option key={size}>{size}</option>)}</select></label><label>Hop length <input type="range" min="128" max="1024" step="128" value={hopLength} onChange={(event) => setHopLength(Number(event.target.value))} />{hopLength} samples</label></div><div className="lab-actions"><button type="button" onClick={() => void toggleTone()}>{running ? "Stop tone" : "Play tone"}</button><button type="button" onClick={() => { setFftSize(config.fftSize); setHopLength(config.hopLength); }}>Use Apollo settings</button><button type="button" disabled={!running} onClick={() => playSample("chord")}>Play chord</button><button type="button" disabled={!running} onClick={() => playSample("drum")}>Play drum hit</button></div>{audioError && <p className="lab-audio-error" role="alert">{audioError}</p>}<canvas ref={canvasRef} className="lab-spectrogram" role="img" aria-label="Live browser spectrogram of the generated tone and samples" /><p className="lab-caption">Vertical: 0–5 kHz frequency · horizontal: time flows left. Larger FFT windows separate nearby frequencies more clearly but span more time. Apollo uses {config.fftSize} samples per window and {config.hopLength} samples per hop.</p></div>;
}
