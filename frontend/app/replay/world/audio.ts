/**
 * The replay's sound layer, synthesised with Web Audio so nothing is downloaded. It exists only
 * while the replay is open (never while Apollo is listening) and has one master volume.
 */

export type Cue = "whoosh" | "ignite" | "thunder" | "riser" | "lock";

export class ReplayAudio {
  private readonly context: AudioContext;
  private readonly master: GainNode;
  private readonly noise: AudioBuffer;
  private rainGain: GainNode | null = null;
  private rainSource: AudioBufferSourceNode | null = null;
  private volume = 0.7;
  private muted = false;

  constructor() {
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.context.destination);
    // Two seconds of white noise: the raw material of wind, rain, crackle and thunder.
    this.noise = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  }

  setVolume(volume: number) {
    this.volume = volume;
    this.apply();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.apply();
  }

  private apply() {
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, 0.05);
  }

  private noiseSource(loop = false): AudioBufferSourceNode {
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    source.loop = loop;
    return source;
  }

  private envelope(gain: GainNode, at: number, attack: number, peak: number, release: number) {
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
  }

  play(cue: Cue) {
    if (this.context.state === "suspended") void this.context.resume();
    const now = this.context.currentTime;
    switch (cue) {
      case "whoosh": {
        // Air rushing past: band-passed noise sweeping up, then down.
        const source = this.noiseSource();
        const filter = this.context.createBiquadFilter();
        filter.type = "bandpass";
        filter.Q.value = 1.4;
        filter.frequency.setValueAtTime(300, now);
        filter.frequency.exponentialRampToValueAtTime(1600, now + 0.9);
        filter.frequency.exponentialRampToValueAtTime(400, now + 2);
        const gain = this.context.createGain();
        this.envelope(gain, now, 0.8, 0.2, 1.3);
        source.connect(filter).connect(gain).connect(this.master);
        source.start(now);
        source.stop(now + 2.2);
        break;
      }
      case "ignite": {
        // A soft crackle: a handful of tiny high clicks.
        for (let index = 0; index < 7; index += 1) {
          const at = now + index * 0.07 + Math.random() * 0.05;
          const source = this.noiseSource();
          const filter = this.context.createBiquadFilter();
          filter.type = "highpass";
          filter.frequency.value = 3500;
          const gain = this.context.createGain();
          this.envelope(gain, at, 0.004, 0.08, 0.05);
          source.connect(filter).connect(gain).connect(this.master);
          source.start(at, Math.random());
          source.stop(at + 0.08);
        }
        break;
      }
      case "thunder": {
        const source = this.noiseSource();
        const filter = this.context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(900, now);
        filter.frequency.exponentialRampToValueAtTime(120, now + 2.5);
        const gain = this.context.createGain();
        this.envelope(gain, now, 0.06, 0.5, 2.8);
        source.connect(filter).connect(gain).connect(this.master);
        source.start(now);
        source.stop(now + 3);
        break;
      }
      case "riser": {
        // Tension before the lock: a rising, opening tone.
        const tone = this.context.createOscillator();
        tone.type = "sawtooth";
        tone.frequency.setValueAtTime(90, now);
        tone.frequency.exponentialRampToValueAtTime(420, now + 3.6);
        const filter = this.context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(400, now);
        filter.frequency.exponentialRampToValueAtTime(2400, now + 3.6);
        const gain = this.context.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.1, now + 3.5);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.7);
        tone.connect(filter).connect(gain).connect(this.master);
        tone.start(now);
        tone.stop(now + 3.8);
        break;
      }
      case "lock": {
        // A deep boom, and a bright shimmer that rings out.
        const boom = this.context.createOscillator();
        boom.type = "sine";
        boom.frequency.setValueAtTime(110, now);
        boom.frequency.exponentialRampToValueAtTime(38, now + 1.2);
        const boomGain = this.context.createGain();
        this.envelope(boomGain, now, 0.01, 0.9, 2.2);
        boom.connect(boomGain).connect(this.master);
        boom.start(now);
        boom.stop(now + 2.4);
        [880, 1318.5, 1760, 2637].forEach((frequency, index) => {
          const bell = this.context.createOscillator();
          bell.type = "sine";
          bell.frequency.value = frequency;
          const gain = this.context.createGain();
          this.envelope(gain, now + 0.02 * index, 0.02, 0.07 / (index + 1), 3.2);
          bell.connect(gain).connect(this.master);
          bell.start(now);
          bell.stop(now + 3.6);
        });
        break;
      }
    }
  }

  /** Continuous rain at `level` 0 to 1, the storm's strength. */
  rain(level: number) {
    if (level > 0.01 && !this.rainSource) {
      const source = this.noiseSource(true);
      const filter = this.context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 2400;
      filter.Q.value = 0.5;
      this.rainGain = this.context.createGain();
      this.rainGain.gain.value = 0;
      source.connect(filter).connect(this.rainGain).connect(this.master);
      source.start();
      this.rainSource = source;
    }
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(level * 0.16, this.context.currentTime, 0.2);
    if (level <= 0.01 && this.rainSource) {
      const source = this.rainSource;
      this.rainSource = null;
      this.rainGain = null;
      source.stop(this.context.currentTime + 0.5);
    }
  }

  dispose() {
    this.rainSource?.stop();
    void this.context.close();
  }
}
