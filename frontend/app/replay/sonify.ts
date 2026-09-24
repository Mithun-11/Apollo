/**
 * Plays the recording's stars (spectral peaks) as pure sine tones at their own times and
 * pitches. Nothing else of the sound is kept, which is the point of the demonstration.
 */

import type { PeakDisplay } from "../../lib/api";

export function playStars(peaks: PeakDisplay[]): () => void {
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = 0.9;
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -18;
  limiter.ratio.value = 8;
  master.connect(limiter).connect(context.destination);

  const loudest = Math.max(...peaks.map((peak) => peak.amplitudeDb), -1);
  const quietest = Math.min(...peaks.map((peak) => peak.amplitudeDb), loudest - 1);
  const start = context.currentTime + 0.08;
  for (const peak of peaks) {
    const level = (peak.amplitudeDb - quietest) / Math.max(1, loudest - quietest);
    const at = start + peak.timeSeconds;
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = peak.frequencyHz;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(0.05 + 0.1 * level, at + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    oscillator.connect(envelope).connect(master);
    oscillator.start(at);
    oscillator.stop(at + 0.25);
  }
  return () => {
    void context.close();
  };
}
