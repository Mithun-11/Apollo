"use client";

import { useEffect, useRef } from "react";

const WIDTH = 560;
const HEIGHT = 150;
const BARS = 120;

export default function LiveSpectrum({ analyser }: { analyser: AnalyserNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = WIDTH * ratio;
    canvas.height = HEIGHT * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const bins = new Float32Array(analyser.frequencyBinCount);
    const nyquist = analyser.context.sampleRate / 2;
    const minimumHz = 60;
    const frequencyAt = (index: number) => minimumHz * Math.pow(nyquist / minimumHz, index / BARS);
    const xAt = (frequencyHz: number) => Math.log(frequencyHz / minimumHz) / Math.log(nyquist / minimumHz) * WIDTH;
    let frame = 0;
    let previous = 0;
    const draw = (now: number) => {
      if (now - previous >= 1000 / 30) {
        previous = now;
        analyser.getFloatFrequencyData(bins);
        context.fillStyle = "#0f1e24";
        context.fillRect(0, 0, WIDTH, HEIGHT);
        const lowX = xAt(100);
        const highX = xAt(Math.min(5000, nyquist));
        context.fillStyle = "#17343c";
        context.fillRect(lowX, 0, highX - lowX, HEIGHT - 22);
        for (let index = 0; index < BARS; index += 1) {
          const hz = frequencyAt(index + .5);
          const bin = Math.min(bins.length - 1, Math.round(hz / nyquist * bins.length));
          const db = Number.isFinite(bins[bin]) ? bins[bin] : -100;
          const level = Math.max(0, Math.min(1, (db + 100) / 85));
          const x = index * WIDTH / BARS;
          const height = level * (HEIGHT - 29);
          context.fillStyle = hz >= 100 && hz <= 5000 ? "#85dad8" : "#476f76";
          context.fillRect(x + 1, HEIGHT - 23 - height, Math.max(1, WIDTH / BARS - 2), height);
        }
        context.fillStyle = "#a7c6ca";
        context.font = "11px sans-serif";
        context.fillText("60 Hz", 2, HEIGHT - 5);
        context.fillText("100 Hz – 5 kHz search band", Math.max(8, lowX + 6), HEIGHT - 5);
        context.textAlign = "right";
        context.fillText(`${Math.round(nyquist / 1000)} kHz`, WIDTH - 3, HEIGHT - 5);
        context.textAlign = "left";
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser]);

  return <canvas ref={canvasRef} className="live-spectrum" role="img" aria-label="Live frequency spectrum with Apollo's 100 hertz to 5 kilohertz search band highlighted" />;
}
