"use client";

import { useEffect, useRef } from "react";
import type { SpectrogramDisplay } from "../lib/api";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 340;
const PLOT_LEFT = 52;
const PLOT_TOP = 12;
const PLOT_RIGHT = 12;
const PLOT_BOTTOM = 34;

function colorFor(value: number, minimum: number, maximum: number): string {
  const range = maximum - minimum || 1;
  const intensity = Math.max(0, Math.min(1, (value - minimum) / range));
  const red = Math.round(8 + intensity * 235);
  const green = Math.round(12 + intensity * 78);
  const blue = Math.round(35 + intensity * 30);
  return `rgb(${red}, ${green}, ${blue})`;
}

export default function SpectrogramCanvas({ spectrogram }: { spectrogram: SpectrogramDisplay }) {
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

    context.fillStyle = "#0b1020";
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const plotWidth = CANVAS_WIDTH - PLOT_LEFT - PLOT_RIGHT;
    const plotHeight = CANVAS_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
    const rows = spectrogram.valuesDb.length;
    const columns = rows > 0 ? spectrogram.valuesDb[0].length : 0;

    if (rows > 0 && columns > 0) {
      const cellWidth = plotWidth / columns;
      const cellHeight = plotHeight / rows;
      for (let row = 0; row < rows; row += 1) {
        const values = spectrogram.valuesDb[row];
        for (let column = 0; column < columns; column += 1) {
          context.fillStyle = colorFor(
            values[column],
            spectrogram.minimumDb,
            spectrogram.maximumDb,
          );
          context.fillRect(
            PLOT_LEFT + column * cellWidth,
            PLOT_TOP + plotHeight - (row + 1) * cellHeight,
            cellWidth + 0.5,
            cellHeight + 0.5,
          );
        }
      }
    } else {
      context.fillStyle = "#a3a3a3";
      context.font = "14px Arial";
      context.fillText("No spectrogram data", PLOT_LEFT + 12, PLOT_TOP + 28);
    }

    context.strokeStyle = "#737373";
    context.lineWidth = 1;
    context.strokeRect(PLOT_LEFT, PLOT_TOP, plotWidth, plotHeight);
    context.fillStyle = "#d4d4d4";
    context.font = "12px Arial";
    context.fillText("0 s", PLOT_LEFT, CANVAS_HEIGHT - 12);
    context.fillText(
      `${spectrogram.durationSeconds.toFixed(1)} s`,
      CANVAS_WIDTH - PLOT_RIGHT - 30,
      CANVAS_HEIGHT - 12,
    );
    context.fillText("0 Hz", 4, PLOT_TOP + plotHeight);
    context.fillText(
      `${Math.round(spectrogram.maximumFrequencyHz / 1000)} kHz`,
      2,
      PLOT_TOP + 6,
    );
  }, [spectrogram]);

  return (
    <figure className="chart-figure">
      <canvas
        ref={canvasRef}
        className="spectrogram-canvas"
        role="img"
        aria-label="Query spectrogram showing frequency over time"
      />
      <figcaption>
        {spectrogram.durationSeconds.toFixed(2)} seconds, up to{" "}
        {Math.round(spectrogram.maximumFrequencyHz)} Hz. Darker cells are quieter.
      </figcaption>
    </figure>
  );
}
