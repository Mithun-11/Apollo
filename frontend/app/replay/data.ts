/**
 * Everything the chapters draw, derived once from the server's explanation, the replay evidence
 * and the recording itself. Nothing here is invented: it re-projects measured values onto the sky.
 */

import type {
  RecognitionEvidence,
  RecognitionExplanationResponse,
  SkyPeak,
} from "../../lib/api";
import { MAX_FREQUENCY_HZ, MIN_FREQUENCY_HZ } from "../sky/geometry";
import { paintColor } from "../sky/paint";

const SKY_ROWS = 180;

export type ReplayData = {
  response: RecognitionExplanationResponse;
  evidence: RecognitionEvidence | null;
  duration: number;
  sampleRate: number;
  /** The recording's spectrogram re-painted on the sky's log-pitch axis (columns = time). */
  sky: HTMLCanvasElement;
  /** The same sky, one soft blur deep, for the glow pass. */
  skyGlow: HTMLCanvasElement;
  /** Loudness per sky column, 0..1, to light the spectrum beam in chapter 2. */
  columnLevels: Float32Array[];
  /** The recording's samples (for the magnifier and the star sonification). */
  samples: Float32Array | null;
  samplesRate: number;
  /** The song's stars over the matched window, placed on the recording's time axis. */
  songStars: SkyPeak[];
  speedFactor: number;
  pitchFactor: number;
  matched: boolean;
  songName: string;
};

export function buildSky(response: RecognitionExplanationResponse): {
  sky: HTMLCanvasElement;
  skyGlow: HTMLCanvasElement;
  columnLevels: Float32Array[];
} {
  const { valuesDb, minimumDb, maximumDb, maximumFrequencyHz } = response.explanation.spectrogram;
  const rows = valuesDb.length;
  const columns = rows > 0 ? valuesDb[0].length : 0;
  const sky = document.createElement("canvas");
  sky.width = Math.max(1, columns);
  sky.height = SKY_ROWS;
  const columnLevels: Float32Array[] = Array.from({ length: columns }, () => new Float32Array(SKY_ROWS));
  const context = sky.getContext("2d");
  if (context && rows > 1 && columns > 0) {
    const image = context.createImageData(columns, SKY_ROWS);
    const low = Math.log(MIN_FREQUENCY_HZ);
    const high = Math.log(MAX_FREQUENCY_HZ);
    const range = Math.max(1, maximumDb - minimumDb);
    for (let row = 0; row < SKY_ROWS; row += 1) {
      const hz = Math.exp(high - ((high - low) * row) / (SKY_ROWS - 1));
      const source = (hz / maximumFrequencyHz) * (rows - 1);
      const lower = Math.floor(source);
      const fraction = source - lower;
      for (let column = 0; column < columns; column += 1) {
        const a = valuesDb[Math.min(rows - 1, lower)][column];
        const b = valuesDb[Math.min(rows - 1, lower + 1)][column];
        const normalized = ((a + (b - a) * fraction) - minimumDb) / range;
        const level = Math.pow(Math.max(0, (normalized - 0.2) / 0.8), 1.15);
        columnLevels[column][row] = level;
        const [r, g, bl, alpha] = paintColor(level);
        image.data.set([r, g, bl, alpha], (row * columns + column) * 4);
      }
    }
    context.putImageData(image, 0, 0);
  }
  const skyGlow = document.createElement("canvas");
  skyGlow.width = 480;
  skyGlow.height = 200;
  const glowContext = skyGlow.getContext("2d");
  if (glowContext) {
    glowContext.filter = "blur(3px)";
    glowContext.drawImage(sky, 0, 0, skyGlow.width, skyGlow.height);
  }
  return { sky, skyGlow, columnLevels };
}

export async function decodeRecording(url: string): Promise<{ samples: Float32Array; rate: number } | null> {
  try {
    const bytes = await (await fetch(url)).arrayBuffer();
    const context = new OfflineAudioContext(1, 1, 22_050);
    const buffer = await context.decodeAudioData(bytes);
    return { samples: buffer.getChannelData(0), rate: buffer.sampleRate };
  } catch {
    return null;
  }
}

/** The song's stars mapped onto the recording's clock (an edit plays the song faster or slower). */
export function songStarsOnRecording(evidence: RecognitionEvidence | null, speedFactor: number): SkyPeak[] {
  const sky = evidence?.songSky;
  if (!sky) return [];
  return sky.peaks.map((peak) => ({
    ...peak,
    timeSeconds: peak.timeSeconds / Math.max(speedFactor, 0.01),
  }));
}

export const formatCount = (value: number) => Math.round(value).toLocaleString("en-US");

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
