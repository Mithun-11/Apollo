"use client";

import { useEffect, useRef } from "react";
import type { SpectrogramDisplay } from "../lib/api";

const CANVAS_WIDTH  = 900;
const CANVAS_HEIGHT = 420;
const PLOT_LEFT     = 58;
const PLOT_TOP      = 18;
const PLOT_RIGHT    = 18;
const PLOT_BOTTOM   = 44;

/**
 * Viridis-inspired color map on a white background.
 * intensity 0 = quietest → light gray
 * intensity 1 = loudest  → deep indigo/blue
 */
function colorFor(value: number, minimum: number, maximum: number): [number, number, number] {
  const range = maximum - minimum || 1;
  const t = Math.max(0, Math.min(1, (value - minimum) / range));

  // Viridis: dark purple → blue → teal → green → yellow
  // We use a 5-stop approximation on white bg (reversed so loud = dark)
  if (t < 0.25) {
    const s = t / 0.25;
    return [
      Math.round(240 - s * 30),
      Math.round(240 - s * 40),
      Math.round(240 - s * 10),
    ];
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    return [
      Math.round(210 - s * 80),
      Math.round(200 - s * 70),
      Math.round(230 - s * 20),
    ];
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    return [
      Math.round(130 - s * 80),
      Math.round(130 - s * 70),
      Math.round(210 + s * 10),
    ];
  } else {
    const s = (t - 0.75) / 0.25;
    return [
      Math.round(50  - s * 30),
      Math.round(60  - s * 40),
      Math.round(220 - s * 60),
    ];
  }
}

export default function SpectrogramCanvas({
  spectrogram,
  cursorSeconds,
  frequencyBand,
}: {
  spectrogram: SpectrogramDisplay;
  cursorSeconds?: number;
  frequencyBand?: { minimum: number; maximum: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width  = CANVAS_WIDTH  * ratio;
    canvas.height = CANVAS_HEIGHT * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Plot area background
    const plotW = CANVAS_WIDTH  - PLOT_LEFT - PLOT_RIGHT;
    const plotH = CANVAS_HEIGHT - PLOT_TOP  - PLOT_BOTTOM;
    ctx.fillStyle = "#f9fafb";
    ctx.fillRect(PLOT_LEFT, PLOT_TOP, plotW, plotH);

    const rows    = spectrogram.valuesDb.length;
    const columns = rows > 0 ? spectrogram.valuesDb[0].length : 0;

    if (rows > 0 && columns > 0) {
      const cellW = plotW / columns;
      const cellH = plotH / rows;

      for (let row = 0; row < rows; row++) {
        const values = spectrogram.valuesDb[row];
        for (let col = 0; col < columns; col++) {
          const [r, g, b] = colorFor(values[col], spectrogram.minimumDb, spectrogram.maximumDb);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(
            PLOT_LEFT + col * cellW,
            PLOT_TOP  + plotH - (row + 1) * cellH,
            cellW + 0.8,
            cellH + 0.8,
          );
        }
      }
    } else {
      ctx.fillStyle = "#6b7280";
      ctx.font = "14px Inter, sans-serif";
      ctx.fillText("No spectrogram data available.", PLOT_LEFT + 16, PLOT_TOP + 36);
    }

    // Grid lines (frequency)
    const freqTickCount = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.1)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= freqTickCount; i++) {
      const y = PLOT_TOP + (i / freqTickCount) * plotH;
      ctx.beginPath();
      ctx.moveTo(PLOT_LEFT, y);
      ctx.lineTo(PLOT_LEFT + plotW, y);
      ctx.stroke();
    }

    // Time grid lines
    const timeTickCount = 5;
    for (let i = 0; i <= timeTickCount; i++) {
      const x = PLOT_LEFT + (i / timeTickCount) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, PLOT_TOP);
      ctx.lineTo(x, PLOT_TOP + plotH);
      ctx.stroke();
    }

    // Border
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.strokeRect(PLOT_LEFT, PLOT_TOP, plotW, plotH);

    // Axis labels — time
    ctx.fillStyle = "#374151";
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center";
    for (let i = 0; i <= timeTickCount; i++) {
      const t = (i / timeTickCount) * spectrogram.durationSeconds;
      const x = PLOT_LEFT + (i / timeTickCount) * plotW;
      ctx.fillText(`${t.toFixed(1)}s`, x, CANVAS_HEIGHT - 8);
      // tick
      ctx.strokeStyle = "#9ca3af";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, PLOT_TOP + plotH);
      ctx.lineTo(x, PLOT_TOP + plotH + 4);
      ctx.stroke();
    }

    // Axis labels — frequency
    ctx.textAlign = "right";
    for (let i = 0; i <= freqTickCount; i++) {
      const freqHz = ((freqTickCount - i) / freqTickCount) * spectrogram.maximumFrequencyHz;
      const y = PLOT_TOP + (i / freqTickCount) * plotH;
      const label = freqHz >= 1000
        ? `${(freqHz / 1000).toFixed(1)}k`
        : `${Math.round(freqHz)}`;
      ctx.fillStyle = "#374151";
      ctx.font = "11px Inter, sans-serif";
      ctx.fillText(label, PLOT_LEFT - 6, y + 4);
      // tick
      ctx.strokeStyle = "#9ca3af";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PLOT_LEFT - 4, y);
      ctx.lineTo(PLOT_LEFT, y);
      ctx.stroke();
    }

    // Axis titles
    ctx.fillStyle = "#6b7280";
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Time (s)", PLOT_LEFT + plotW / 2, CANVAS_HEIGHT - 1);

    // Rotated frequency title
    ctx.save();
    ctx.translate(11, PLOT_TOP + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Frequency (Hz)", 0, 0);
    ctx.restore();

    // Color bar (legend) at right
    const barX   = PLOT_LEFT + plotW + 6;
    const barW   = 10;
    const barH   = plotH;
    const barTop = PLOT_TOP;
    const grad = ctx.createLinearGradient(0, barTop + barH, 0, barTop);
    grad.addColorStop(0, "rgb(240,240,240)");
    grad.addColorStop(0.33, "rgb(130,130,210)");
    grad.addColorStop(0.66, "rgb(50,60,220)");
    grad.addColorStop(1, "rgb(20,20,160)");
    ctx.fillStyle = grad;
    ctx.fillRect(barX, barTop, barW, barH);
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barTop, barW, barH);

    ctx.fillStyle = "#6b7280";
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${spectrogram.maximumDb} dB`, barX + barW + 3, barTop + 10);
    ctx.fillText(`${spectrogram.minimumDb} dB`, barX + barW + 3, barTop + barH);

  }, [spectrogram]);

  return (
    <figure className="chart-figure">
      <div className="spectrogram-frame">
        <canvas
          ref={canvasRef}
          className="spectrogram-canvas"
          role="img"
          aria-label="Query STFT spectrogram showing frequency content over time"
        />
        {frequencyBand && <span className="spectrogram-band" style={{
          top: `${(PLOT_TOP + (1 - frequencyBand.maximum / spectrogram.maximumFrequencyHz) * (CANVAS_HEIGHT - PLOT_TOP - PLOT_BOTTOM)) / CANVAS_HEIGHT * 100}%`,
          bottom: `${(PLOT_BOTTOM + frequencyBand.minimum / spectrogram.maximumFrequencyHz * (CANVAS_HEIGHT - PLOT_TOP - PLOT_BOTTOM)) / CANVAS_HEIGHT * 100}%`,
          left: `${PLOT_LEFT / CANVAS_WIDTH * 100}%`,
          right: `${PLOT_RIGHT / CANVAS_WIDTH * 100}%`,
        }} aria-hidden="true" />}
        {cursorSeconds !== undefined && <span className="spectrogram-cursor" style={{ left: `${(PLOT_LEFT + Math.min(1, cursorSeconds / Math.max(spectrogram.durationSeconds, .001)) * (CANVAS_WIDTH - PLOT_LEFT - PLOT_RIGHT)) / CANVAS_WIDTH * 100}%` }} aria-hidden="true" />}
      </div>
      <p className="chart-caption">
        Duration: {spectrogram.durationSeconds.toFixed(2)} s · Max frequency:{" "}
        {Math.round(spectrogram.maximumFrequencyHz).toLocaleString()} Hz ·
        Darker = louder (dB scale from {spectrogram.minimumDb} to {spectrogram.maximumDb} dB)
        {frequencyBand && ` · Peak search band: ${frequencyBand.minimum}–${frequencyBand.maximum.toLocaleString()} Hz`}
      </p>
    </figure>
  );
}
