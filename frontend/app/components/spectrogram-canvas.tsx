"use client";

import { useEffect, useRef } from "react";
import type { PeakDisplay, SpectrogramDisplay } from "../../lib/api";
import ChartCursor from "./chart-cursor";

const CANVAS_WIDTH  = 900;
const CANVAS_HEIGHT = 420;
const PLOT_LEFT     = 58;
const PLOT_TOP      = 18;
const PLOT_RIGHT    = 18;
const PLOT_BOTTOM   = 44;

function colorFor(value: number, minimum: number, maximum: number): [number, number, number] {
  const range = maximum - minimum || 1;
  const t = Math.max(0, Math.min(1, (value - minimum) / range));
  const stops = [[15, 8, 32], [74, 20, 91], [151, 39, 89], [232, 88, 47], [255, 221, 135]];
  const index = Math.min(3, Math.floor(t * 4));
  const blend = t * 4 - index;
  return [0, 1, 2].map((channel) => Math.round(stops[index][channel] * (1 - blend) + stops[index + 1][channel] * blend)) as [number, number, number];
}

export default function SpectrogramCanvas({
  spectrogram,
  cursorSeconds,
  frequencyBand,
  overlayPeaks,
}: {
  spectrogram: SpectrogramDisplay;
  cursorSeconds?: number;
  frequencyBand?: { minimum: number; maximum: number };
  overlayPeaks?: PeakDisplay[];
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

    // Dark chart background
    ctx.fillStyle = "#0f1e24";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Plot area background
    const plotW = CANVAS_WIDTH  - PLOT_LEFT - PLOT_RIGHT;
    const plotH = CANVAS_HEIGHT - PLOT_TOP  - PLOT_BOTTOM;
    ctx.fillStyle = "#152830";
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
      ctx.fillStyle = "#8eb8c0";
      ctx.font = "14px Inter, sans-serif";
      ctx.fillText("No spectrogram data available.", PLOT_LEFT + 16, PLOT_TOP + 36);
    }

    if (overlayPeaks) {
      for (const peak of overlayPeaks.slice(0, 1000)) {
        const x = PLOT_LEFT + peak.timeSeconds / Math.max(spectrogram.durationSeconds, .001) * plotW;
        const y = PLOT_TOP + (1 - peak.frequencyHz / Math.max(spectrogram.maximumFrequencyHz, 1)) * plotH;
        ctx.beginPath();
        ctx.fillStyle = peak.matched ? "#f7c66d" : "#88e2e0";
        ctx.arc(x, y, peak.matched ? 3.7 : 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Grid lines (frequency)
    const freqTickCount = 6;
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
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
    ctx.strokeStyle = "#2c454d";
    ctx.lineWidth = 1;
    ctx.strokeRect(PLOT_LEFT, PLOT_TOP, plotW, plotH);

    // Axis labels — time
    ctx.fillStyle = "#8eb8c0";
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center";
    for (let i = 0; i <= timeTickCount; i++) {
      const t = (i / timeTickCount) * spectrogram.durationSeconds;
      const x = PLOT_LEFT + (i / timeTickCount) * plotW;
      ctx.fillText(`${t.toFixed(1)}s`, x, CANVAS_HEIGHT - 8);
      // tick
      ctx.strokeStyle = "#739ba3";
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
      ctx.fillStyle = "#8eb8c0";
      ctx.font = "11px Inter, sans-serif";
      ctx.fillText(label, PLOT_LEFT - 6, y + 4);
      // tick
      ctx.strokeStyle = "#739ba3";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PLOT_LEFT - 4, y);
      ctx.lineTo(PLOT_LEFT, y);
      ctx.stroke();
    }

    // Axis titles
    ctx.fillStyle = "#8eb8c0";
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
    grad.addColorStop(0, "rgb(15,8,32)");
    grad.addColorStop(0.33, "rgb(108,26,91)");
    grad.addColorStop(0.66, "rgb(218,76,58)");
    grad.addColorStop(1, "rgb(255,221,135)");
    ctx.fillStyle = grad;
    ctx.fillRect(barX, barTop, barW, barH);
    ctx.strokeStyle = "#2c454d";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barTop, barW, barH);

    ctx.fillStyle = "#8eb8c0";
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${spectrogram.maximumDb} dB`, barX + barW + 3, barTop + 10);
    ctx.fillText(`${spectrogram.minimumDb} dB`, barX + barW + 3, barTop + barH);

  }, [spectrogram, overlayPeaks]);

  return (
    <figure className="chart-figure">
      <ChartCursor describe={(x, y) => {
        const plotX = Math.max(0, Math.min(0.999, (x * CANVAS_WIDTH - PLOT_LEFT) / (CANVAS_WIDTH - PLOT_LEFT - PLOT_RIGHT)));
        const plotY = Math.max(0, Math.min(0.999, (y * CANVAS_HEIGHT - PLOT_TOP) / (CANVAS_HEIGHT - PLOT_TOP - PLOT_BOTTOM)));
        const row = Math.floor((1 - plotY) * spectrogram.valuesDb.length);
        const column = Math.floor(plotX * (spectrogram.valuesDb[0]?.length ?? 0));
        const db = spectrogram.valuesDb[Math.min(row, spectrogram.valuesDb.length - 1)]?.[column];
        return `${(plotX * spectrogram.durationSeconds).toFixed(2)} s · ${Math.round((1 - plotY) * spectrogram.maximumFrequencyHz)} Hz${db === undefined ? "" : ` · ${db.toFixed(1)} dB`}`;
      }}><div className="spectrogram-frame">
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
      </div></ChartCursor>
      <p className="chart-caption">
        Duration: {spectrogram.durationSeconds.toFixed(2)} s · Max frequency:{" "}
        {Math.round(spectrogram.maximumFrequencyHz).toLocaleString()} Hz ·
        Brighter = louder (dB scale from {spectrogram.minimumDb} to {spectrogram.maximumDb} dB)
        {frequencyBand && ` · Peak search band: ${frequencyBand.minimum}–${frequencyBand.maximum.toLocaleString()} Hz`}
      </p>
    </figure>
  );
}
