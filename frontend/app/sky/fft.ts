/**
 * The live sky's short-time Fourier transform: a Hann-windowed radix-2 FFT, reduced to
 * log-spaced bands between the sky's lowest and highest pitch. The server computes the real
 * fingerprints; this only paints what the microphone hears while it listens.
 */

import { MAX_FREQUENCY_HZ, MIN_FREQUENCY_HZ } from "./geometry";

export const FFT_SIZE = 2048;
export const BAND_COUNT = 112;

const hann = Float32Array.from(
  { length: FFT_SIZE },
  (_, index) => 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (FFT_SIZE - 1)),
);

function fftMagnitudes(frame: Float32Array): Float32Array {
  const real = new Float32Array(FFT_SIZE);
  const imag = new Float32Array(FFT_SIZE);
  for (let index = 0; index < FFT_SIZE; index += 1) real[index] = frame[index] * hann[index];
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < FFT_SIZE; i += 1) {
    let bit = FFT_SIZE >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
    }
  }
  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    for (let start = 0; start < FFT_SIZE; start += size) {
      let wReal = 1;
      let wImag = 0;
      for (let k = 0; k < size / 2; k += 1) {
        const a = start + k;
        const b = a + size / 2;
        const tReal = wReal * real[b] - wImag * imag[b];
        const tImag = wReal * imag[b] + wImag * real[b];
        real[b] = real[a] - tReal;
        imag[b] = imag[a] - tImag;
        real[a] += tReal;
        imag[a] += tImag;
        const nextReal = wReal * stepReal - wImag * stepImag;
        wImag = wReal * stepImag + wImag * stepReal;
        wReal = nextReal;
      }
    }
  }
  const magnitudes = new Float32Array(FFT_SIZE / 2);
  for (let index = 0; index < FFT_SIZE / 2; index += 1) {
    magnitudes[index] = Math.hypot(real[index], imag[index]);
  }
  return magnitudes;
}

const bandEdgesCache = new Map<number, Int32Array>();

function bandEdges(sampleRate: number): Int32Array {
  const cached = bandEdgesCache.get(sampleRate);
  if (cached) return cached;
  const edges = new Int32Array(BAND_COUNT + 1);
  const low = Math.log(MIN_FREQUENCY_HZ);
  const high = Math.log(MAX_FREQUENCY_HZ);
  for (let band = 0; band <= BAND_COUNT; band += 1) {
    const hz = Math.exp(low + ((high - low) * band) / BAND_COUNT);
    edges[band] = Math.min(FFT_SIZE / 2 - 1, Math.round((hz * FFT_SIZE) / sampleRate));
  }
  bandEdgesCache.set(sampleRate, edges);
  return edges;
}

/** Band levels in dB (low pitch first) for one FFT_SIZE-sample frame. */
export function bandLevels(frame: Float32Array, sampleRate: number): Float32Array {
  const magnitudes = fftMagnitudes(frame);
  const edges = bandEdges(sampleRate);
  const levels = new Float32Array(BAND_COUNT);
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const from = edges[band];
    const to = Math.max(from + 1, edges[band + 1]);
    let peak = 0;
    for (let bin = from; bin < to; bin += 1) peak = Math.max(peak, magnitudes[bin]);
    levels[band] = 20 * Math.log10(peak + 1e-9);
  }
  return levels;
}

/** The centre pitch of a band, in Hz. */
export function bandFrequency(band: number): number {
  const low = Math.log(MIN_FREQUENCY_HZ);
  const high = Math.log(MAX_FREQUENCY_HZ);
  return Math.exp(low + ((high - low) * (band + 0.5)) / BAND_COUNT);
}
