"use client";

import { useEffect, useRef, type RefObject } from "react";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 150;

export default function LiveWaveform({
  samplesRef,
}: {
  samplesRef: RefObject<Float32Array>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = CANVAS_WIDTH * ratio;
    canvas.height = CANVAS_HEIGHT * ratio;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    let animationFrame = 0;
    const draw = () => {
      context.fillStyle = "#0b1020";
      context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      context.strokeStyle = "#1f2937";
      context.beginPath();
      context.moveTo(0, CANVAS_HEIGHT / 2);
      context.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT / 2);
      context.stroke();

      const samples = samplesRef.current;
      if (samples.length > 0) {
        context.strokeStyle = "#67e8f9";
        context.lineWidth = 1.5;
        context.beginPath();
        for (let index = 0; index < samples.length; index += 1) {
          const x = (index / Math.max(samples.length - 1, 1)) * CANVAS_WIDTH;
          const y = (1 - Math.max(-1, Math.min(1, samples[index]))) * (CANVAS_HEIGHT / 2);
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }
      animationFrame = window.requestAnimationFrame(draw);
    };

    draw();
    return () => window.cancelAnimationFrame(animationFrame);
  }, [samplesRef]);

  return (
    <canvas
      ref={canvasRef}
      className="live-waveform"
      role="img"
      aria-label="Live microphone waveform"
    />
  );
}
