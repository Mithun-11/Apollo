"use client";

import { type RefObject, useEffect, useRef } from "react";
import { BAND_COUNT, FFT_SIZE, bandFrequency, bandLevels } from "./fft";
import {
  INK,
  type SkyFrame,
  easeOut,
  fitCanvas,
  frequencyToY,
  horizonY,
  timeToX,
} from "./geometry";
import { paintColor as paint } from "./paint";
import { drawStar } from "./stars";

const HOP = FFT_SIZE / 2;
const DYNAMIC_RANGE_DB = 52;
const STARS_PER_COLUMN = 3;

export type LiveCheck = { seconds: number; kind: "confirmed" | "possible" | "none" };

type Star = { time: number; frequency: number; level: number; born: number };

type LiveSkyProps = {
  chunksRef: RefObject<Float32Array[]>;
  sampleRateRef: RefObject<number>;
  recording: boolean;
  durationSeconds: number;
  checks: LiveCheck[];
  /** 0 to 1: how much of the live painting to keep showing (fades out when the replay starts). */
  opacity: number;
};

export default function LiveSky({
  chunksRef,
  sampleRateRef,
  recording,
  durationSeconds,
  checks,
  opacity,
}: LiveSkyProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const checksRef = useRef(checks);
  const opacityRef = useRef(opacity);
  const recordingRef = useRef(recording);
  const resetRef = useRef(true);

  useEffect(() => {
    checksRef.current = checks;
    opacityRef.current = opacity;
  }, [checks, opacity]);

  useEffect(() => {
    recordingRef.current = recording;
    if (recording) resetRef.current = true;
  }, [recording]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const maxColumns = 1200;
    const paintCanvas = document.createElement("canvas");
    paintCanvas.width = maxColumns;
    paintCanvas.height = BAND_COUNT;
    const paintContext = paintCanvas.getContext("2d");
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 480;
    glowCanvas.height = 200;
    const glowContext = glowCanvas.getContext("2d");

    let pending = new Float32Array(0);
    let chunkIndex = 0;
    let columns: Float32Array[] = [];
    let energies: number[] = [];
    let stars: Star[] = [];
    let loudestDb = -30;
    let dirty = false;

    const reset = () => {
      pending = new Float32Array(0);
      chunkIndex = 0;
      columns = [];
      energies = [];
      stars = [];
      loudestDb = -30;
      paintContext?.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
      glowContext?.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
    };

    const consume = (now: number) => {
      const chunks = chunksRef.current;
      const sampleRate = sampleRateRef.current || 48_000;
      if (!chunks || chunkIndex >= chunks.length) return;
      let total = pending.length;
      for (let index = chunkIndex; index < chunks.length; index += 1) total += chunks[index].length;
      const merged = new Float32Array(total);
      merged.set(pending, 0);
      let offset = pending.length;
      for (; chunkIndex < chunks.length; chunkIndex += 1) {
        merged.set(chunks[chunkIndex], offset);
        offset += chunks[chunkIndex].length;
      }
      let start = 0;
      while (merged.length - start >= FFT_SIZE && columns.length < maxColumns) {
        const frame = merged.subarray(start, start + FFT_SIZE);
        const levels = bandLevels(frame, sampleRate);
        let columnPeak = -120;
        for (const value of levels) columnPeak = Math.max(columnPeak, value);
        loudestDb = Math.max(loudestDb - 0.02, columnPeak);
        const normalized = new Float32Array(BAND_COUNT);
        for (let band = 0; band < BAND_COUNT; band += 1) {
          normalized[band] = Math.min(
            1,
            Math.max(0, (levels[band] - (loudestDb - DYNAMIC_RANGE_DB)) / DYNAMIC_RANGE_DB),
          );
        }
        let energy = 0;
        for (let index = 0; index < FFT_SIZE; index += 8) energy += frame[index] * frame[index];
        energies.push(Math.sqrt(energy / (FFT_SIZE / 8)));
        columns.push(normalized);
        writeColumn(columns.length - 1, normalized);
        findStars(columns.length - 2, sampleRate, now);
        start += HOP;
      }
      pending = merged.slice(start);
      dirty = true;
    };

    const writeColumn = (index: number, levels: Float32Array) => {
      if (!paintContext) return;
      const image = paintContext.createImageData(1, BAND_COUNT);
      for (let band = 0; band < BAND_COUNT; band += 1) {
        const [r, g, b, a] = paint(levels[band]);
        const row = BAND_COUNT - 1 - band;
        image.data.set([r, g, b, a], row * 4);
      }
      paintContext.putImageData(image, index, 0);
    };

    // A star is a local maximum in a small patch of time and pitch, like the server's peaks.
    const findStars = (index: number, sampleRate: number, now: number) => {
      if (index < 1 || index + 1 >= columns.length) return;
      const column = columns[index];
      const found: { band: number; level: number }[] = [];
      for (let band = 2; band < BAND_COUNT - 2; band += 1) {
        const level = column[band];
        if (level < 0.62) continue;
        let isPeak = true;
        for (let dc = -1; dc <= 1 && isPeak; dc += 1) {
          const neighbour = columns[index + dc];
          for (let db = -3; db <= 3; db += 1) {
            if ((dc !== 0 || db !== 0) && neighbour[band + db] !== undefined && neighbour[band + db] > level) {
              isPeak = false;
              break;
            }
          }
        }
        if (isPeak) found.push({ band, level });
      }
      found.sort((a, b) => b.level - a.level);
      for (const { band, level } of found.slice(0, STARS_PER_COLUMN)) {
        stars.push({ time: (index * HOP) / sampleRate, frequency: bandFrequency(band), level, born: now });
      }
    };

    const draw = (now: number) => {
      const frame: SkyFrame = fitCanvas(canvas);
      context.clearRect(0, 0, frame.width, frame.height);
      if (resetRef.current && recordingRef.current) {
        reset();
        resetRef.current = false;
      }
      if (recordingRef.current) consume(now);
      const alpha = opacityRef.current;
      if (alpha <= 0.01 || columns.length === 0) return;
      const sampleRate = sampleRateRef.current || 48_000;
      const elapsed = (columns.length * HOP) / sampleRate;
      const left = timeToX(0, durationSeconds, frame);
      const right = timeToX(durationSeconds, durationSeconds, frame);
      const top = frequencyToY(Number.POSITIVE_INFINITY, frame);
      const bottom = frequencyToY(0, frame);
      // Paint columns covering the whole listening window, so time maps the same way as the replay.
      const sourceWidth = Math.min(maxColumns, (durationSeconds * sampleRate) / HOP);

      if (dirty && glowContext) {
        glowContext.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
        glowContext.filter = "blur(3px)";
        glowContext.drawImage(paintCanvas, 0, 0, sourceWidth, BAND_COUNT, 0, 0, glowCanvas.width, glowCanvas.height);
        glowContext.filter = "none";
        dirty = false;
      }

      context.save();
      context.globalAlpha = alpha;
      context.globalCompositeOperation = "screen";
      context.imageSmoothingEnabled = true;
      context.drawImage(glowCanvas, left, top, right - left, bottom - top);
      context.globalAlpha = alpha * 0.55;
      context.drawImage(paintCanvas, 0, 0, sourceWidth, BAND_COUNT, left, top, right - left, bottom - top);
      context.restore();

      // The lake carries the loudness as ripples, mirrored under the horizon.
      const shore = horizonY(frame) + frame.height * 0.012;
      const lakeDepth = frame.height * 0.2;
      context.strokeStyle = `rgba(255, 246, 230, ${0.16 * alpha})`;
      context.lineWidth = 1.2;
      context.beginPath();
      const step = Math.max(1, Math.floor(energies.length / 400));
      for (let index = 0; index < energies.length; index += step) {
        const x = timeToX((index * HOP) / sampleRate, durationSeconds, frame);
        const length = Math.min(1, energies[index] * 5) * lakeDepth * 0.55;
        context.moveTo(x, shore + 4);
        context.lineTo(x, shore + 4 + length);
      }
      context.stroke();

      if (recordingRef.current) {
        const x = timeToX(elapsed, durationSeconds, frame);
        const beam = context.createLinearGradient(x, top, x, bottom);
        beam.addColorStop(0, "rgba(255, 201, 138, 0)");
        beam.addColorStop(1, `rgba(255, 201, 138, ${0.55 * alpha})`);
        context.fillStyle = beam;
        context.fillRect(x - 1, top, 2, bottom - top);
      }

      for (const star of stars) {
        const age = reducedMotion ? 1 : (now - star.born) / 700;
        const ignite = easeOut(age);
        const flash = reducedMotion ? 0 : Math.max(0, 1 - age) * 1.4;
        const size = (9 + star.level * 16) * (0.4 + 0.6 * ignite) * (1 + flash);
        drawStar(
          context,
          timeToX(star.time, durationSeconds, frame),
          frequencyToY(star.frequency, frame),
          size,
          INK.star,
          alpha * (0.35 + 0.65 * ignite),
        );
      }

      for (const check of checksRef.current) {
        const x = timeToX(check.seconds, durationSeconds, frame);
        context.fillStyle =
          check.kind === "confirmed" ? INK.thread : check.kind === "possible" ? INK.comet : "rgba(255,246,230,0.45)";
        context.globalAlpha = alpha;
        context.beginPath();
        context.arc(x, horizonY(frame) + 2, check.kind === "none" ? 3 : 5, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
      }
    };

    let animation = 0;
    let last = 0;
    const loop = (now: number) => {
      animation = requestAnimationFrame(loop);
      if (now - last < 33) return; // ~30 fps: smooth enough, and leaves the laptop free to recognize.
      last = now;
      draw(now);
    };
    animation = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animation);
  }, [chunksRef, sampleRateRef, durationSeconds]);

  return <canvas ref={canvasRef} className="data-sky" aria-hidden="true" />;
}
