"use client";

import { useEffect, useRef, useState } from "react";
import type { PairExample, RecognitionExplanationResponse, WaveformEnvelopePoint } from "../lib/api";
import ConstellationPlot from "./constellation-plot";
import FingerprintAlignment from "./fingerprint-alignment";
import SpectrogramCanvas from "./spectrogram-canvas";
import VoteHistogram from "./vote-histogram";

const STEPS = ["Capture", "Spectrum", "Peaks", "Fingerprints", "Catalog", "Alignment", "Decision"] as const;
const seconds = (value: number) => `${value.toFixed(2)} s`;

function decisionText(reason: string): string {
  switch (reason) {
    case "accepted": return "The leading song passed both decision rules.";
    case "no_fingerprints": return "This recording did not produce usable fingerprints.";
    case "no_catalog_hits": return "No query fingerprints were found in the catalog.";
    case "no_valid_offsets": return "Catalog fingerprints matched, but none pointed to a possible song start.";
    case "below_threshold": return "Some fingerprints matched, but too few agreed on one position.";
    case "ambiguous": return "The leading song did not clearly beat another song.";
    default: return "Apollo could not establish a match.";
  }
}

function WaveformEnvelope({ points, duration, cursor }: { points: WaveformEnvelopePoint[]; duration: number; cursor: number }) {
  const x = (time: number) => 28 + time / Math.max(duration, 0.001) * 700;
  const y = (value: number) => 100 - Math.max(-1, Math.min(1, value)) * 66;
  const top = points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.timeSeconds)} ${y(point.maximum)}`).join(" ");
  const bottom = [...points].reverse().map((point) => `L ${x(point.timeSeconds)} ${y(point.minimum)}`).join(" ");
  return (
    <figure className="chart-figure">
      <svg className="waveform-plot" viewBox="0 0 760 218" role="img" aria-label="Normalized waveform of the recorded query">
        <rect width="760" height="218" rx="12" fill="#f7f8f8" />
        <line x1="28" x2="728" y1="100" y2="100" stroke="#cbd5d9" />
        {points.length > 0 && <path d={`${top} ${bottom} Z`} fill="#a8dee2" opacity=".7" />}
        <path d={top} fill="none" stroke="#087f8b" strokeWidth="1.5" />
        <line x1={x(cursor)} x2={x(cursor)} y1="21" y2="177" stroke="#ca8933" strokeWidth="2" />
        <circle cx={x(cursor)} cy="100" r="5" fill="#ca8933" />
        <text x="28" y="197" fill="#52646b" fontSize="12">0 s</text>
        <text x="728" y="197" textAnchor="end" fill="#52646b" fontSize="12">{seconds(duration)}</text>
        <text x="380" y="197" textAnchor="middle" fill="#52646b" fontSize="12">Time · amplitude −1 to +1</text>
      </svg>
      <figcaption className="chart-caption">{points.length} displayed envelope regions from the normalized recording.</figcaption>
    </figure>
  );
}

function PairPlot({ pairs, duration, maximumFrequency, cursor }: { pairs: PairExample[]; duration: number; maximumFrequency: number; cursor: number }) {
  if (pairs.length === 0) return <p className="story-empty">No fingerprint pairs were generated from this recording.</p>;
  const selected = pairs.reduce((best, pair) => Math.abs(pair.anchorSeconds - cursor) < Math.abs(best.anchorSeconds - cursor) ? pair : best, pairs[0]);
  const x = (time: number) => 48 + time / Math.max(duration, 0.001) * 672;
  const y = (frequency: number) => 298 - frequency / Math.max(maximumFrequency, 1) * 266;
  return (
    <figure className="chart-figure">
      <svg className="pair-plot" viewBox="0 0 760 340" role="img" aria-label="Actual anchor and target peak pairs from this recording">
        <rect width="760" height="340" rx="12" fill="#f7f8f8" />
        <rect x="48" y="32" width="672" height="266" fill="#fff" stroke="#d9e3e5" />
        {pairs.map((pair, index) => (
          <g key={`${pair.anchorSeconds}-${pair.targetSeconds}-${index}`} opacity={pair === selected ? 1 : .28}>
            <line x1={x(pair.anchorSeconds)} y1={y(pair.anchorFrequencyHz)} x2={x(pair.targetSeconds)} y2={y(pair.targetFrequencyHz)} stroke={pair === selected ? "#c5802b" : "#087f8b"} strokeWidth={pair === selected ? 3 : 1.5} />
            <circle cx={x(pair.anchorSeconds)} cy={y(pair.anchorFrequencyHz)} r={pair === selected ? 6 : 3} fill="#087f8b" />
            <circle cx={x(pair.targetSeconds)} cy={y(pair.targetFrequencyHz)} r={pair === selected ? 6 : 3} fill="#c5802b" />
          </g>
        ))}
        <text x="48" y="324" fill="#52646b" fontSize="12">0 s</text>
        <text x="720" y="324" textAnchor="end" fill="#52646b" fontSize="12">{seconds(duration)}</text>
        <text x="48" y="24" fill="#52646b" fontSize="12">{Math.round(maximumFrequency).toLocaleString()} Hz</text>
      </svg>
      <div className="fingerprint-formula" aria-label="Fingerprint ingredients"><span>{Math.round(selected.anchorFrequencyHz)} Hz anchor</span><b>+</b><span>{Math.round(selected.targetFrequencyHz)} Hz target</span><b>+</b><span>Δ {selected.deltaFrames} frames</span><b>→</b><strong>versioned fingerprint</strong></div>
      <figcaption className="chart-caption">Example: {Math.round(selected.anchorFrequencyHz)} Hz at {seconds(selected.anchorSeconds)} → {Math.round(selected.targetFrequencyHz)} Hz at {seconds(selected.targetSeconds)} · Δ {selected.deltaFrames} frames. {pairs.length} representative pairs shown.</figcaption>
    </figure>
  );
}

export default function RecognitionExplanation({ response, recordingUrl }: { response: RecognitionExplanationResponse; recordingUrl: string }) {
  const { recognition, explanation } = response;
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundError, setSoundError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [showTechnical, setShowTechnical] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef(0);
  const lastAudioTimeRef = useRef(0);
  const stepDuration = Math.max(explanation.queryDurationSeconds, 0.1);
  const totalDuration = STEPS.length * stepDuration;
  const step = Math.min(STEPS.length - 1, Math.floor(progress / stepDuration));
  const actuallyPlaying = playing && progress < totalDuration - 0.001;
  const cursor = Math.min(explanation.queryDurationSeconds, progress % stepDuration);
  const config = explanation.signalConfig;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReducedMotion(media.matches);
      if (media.matches) {
        audioRef.current?.pause();
        setPlaying(false);
      }
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!actuallyPlaying || reducedMotion) return;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      const audio = audioRef.current;
      let next = progressRef.current;
      if (soundEnabled && audio && !audio.paused) {
        let currentStep = Math.floor(next / stepDuration);
        const audioTime = audio.currentTime;
        if (audioTime + 0.25 < lastAudioTimeRef.current) currentStep += 1;
        lastAudioTimeRef.current = audioTime;
        next = Math.min(totalDuration - 0.001, currentStep * stepDuration + Math.min(audioTime, stepDuration - 0.001));
      } else if (!soundEnabled && last) {
        next = Math.min(totalDuration - 0.001, next + Math.min((now - last) / 1000, 0.1) * speed);
      }
      if (next !== progressRef.current) {
        progressRef.current = next;
        setProgress(next);
      }
      if (next >= totalDuration - 0.001) {
        audio?.pause();
        setPlaying(false);
        return;
      }
      last = now;
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [actuallyPlaying, reducedMotion, soundEnabled, speed, stepDuration, totalDuration]);

  useEffect(() => {
    const audio = audioRef.current;
    const pauseWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        audio?.pause();
        setPlaying(false);
      }
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", pauseWhenHidden);
      audio?.pause();
    };
  }, []);

  const setReplayPosition = (value: number) => {
    const next = Math.max(0, Math.min(totalDuration - 0.001, value));
    progressRef.current = next;
    setProgress(next);
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = Math.min(next % stepDuration, Math.max(0, audio.duration - 0.001) || stepDuration);
      lastAudioTimeRef.current = audio.currentTime;
    }
  };

  const tryPlayAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
    audio.currentTime = Math.min(progressRef.current % stepDuration, Math.max(0, audio.duration - 0.001) || stepDuration);
    lastAudioTimeRef.current = audio.currentTime;
    void audio.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSoundEnabled(false);
      setSoundError("The recording could not play. The visual replay will continue silently.");
    });
  };

  const toggleSound = () => {
    if (soundEnabled) {
      audioRef.current?.pause();
      setSoundEnabled(false);
      return;
    }
    setSoundError(null);
    setSoundEnabled(true);
    if (actuallyPlaying) tryPlayAudio();
  };

  const toggleReplay = () => {
    if (actuallyPlaying) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    if (progress >= totalDuration - 0.01) setReplayPosition(0);
    if (soundEnabled) tryPlayAudio();
    setPlaying(true);
  };

  const goTo = (index: number) => {
    audioRef.current?.pause();
    setPlaying(false);
    setReplayPosition(Math.max(0, Math.min(STEPS.length - 1, index)) * stepDuration);
  };
  const descriptions = [
    { summary: "Apollo records a short nearby sound and converts it to a normalized mono signal for analysis.", measure: `${seconds(explanation.queryDurationSeconds)} recorded · ${explanation.sampleRate.toLocaleString()} samples/second`, technical: "The waveform is an envelope of normalized audio samples. Its horizontal axis is time; its vertical axis is amplitude." },
    { summary: "A short-time Fourier transform reveals which frequencies are present at each moment.", measure: `${config.fftSize.toLocaleString()} samples/window · ${config.hopLength} samples/hop`, technical: "Each overlapping window is transformed to frequency bins. Color represents level in dB relative to the loudest spectral value. The display matrix is downsampled." },
    { summary: "Apollo keeps strong local frequency peaks as landmarks that can survive a noisy room.", measure: `${explanation.counts.peaks.toLocaleString()} peaks · ${config.minimumFrequencyHz}–${config.maximumFrequencyHz.toLocaleString()} Hz`, technical: `Peaks must be at least ${config.peakFloorDb} dB, within the search band, and among the strongest ${config.peaksPerSecond} per second. This plot shows ${explanation.peaks.length} selected display peaks.` },
    { summary: "A fingerprint describes the relationship between an anchor peak and a later target peak.", measure: `${explanation.counts.fingerprints.toLocaleString()} fingerprints · up to ${config.fanOut} targets/anchor`, technical: `Version ${config.fingerprintVersion} hashes the anchor frequency bin, target frequency bin and frame difference. These are real query pairs; hash values stay out of the display.` },
    { summary: "Apollo checks the query fingerprints against its indexed song catalog.", measure: `${explanation.counts.matchingHashes.toLocaleString()} distinct hashes found in the catalog`, technical: `The lookup uses fingerprint version and hash value. A hash hit is only a possible correspondence; the matching timestamps must also agree.${recognition.matched && ((recognition.speedFactor ?? 1) !== 1 || (recognition.pitchFactor ?? 1) !== 1) ? " For this edited recording, Apollo also mapped the detected peaks onto the song's time and frequency grid before the successful lookup." : ""}` },
    { summary: "Matching fingerprints vote for where this recording begins inside a catalog song.", measure: explanation.sourceInterval ? `Accepted start: ${seconds(explanation.sourceInterval.startSeconds)}` : "No accepted source alignment", technical: "Catalog anchor frame minus query anchor frame gives a candidate offset. Lines are a bounded sample of accepted evidence, not source audio." },
    { summary: decisionText(explanation.decision.reason), measure: `${explanation.decision.leadingVotes} leading votes · ${explanation.decision.runnerUpVotes} best other song`, technical: `A match requires at least ${explanation.decision.minimumVotes} votes and ${explanation.decision.minimumWinnerRatio}× the best other song. Votes within ±${explanation.decision.offsetToleranceFrames} frame are combined. The chart shows clustered votes for the leading song.` },
  ];
  const detail = descriptions[step];

  return (
    <section className="story" aria-labelledby="story-title">
      <audio ref={audioRef} src={recordingUrl} preload="auto" loop />
      <div className="story-heading">
        <div><p className="eyebrow">THE SIGNAL STORY · REPLAY OF THIS RECORDING</p><h2 id="story-title">See how Apollo reached its answer.</h2><p>Explore each step or play the guided sequence. Every visual uses evidence from your recording.</p></div>
        <div className={`story-verdict ${recognition.matched ? "story-verdict--match" : ""}`}><span>{recognition.matched ? "MATCH FOUND" : "NO MATCH"}</span><strong>{recognition.song?.name ?? "Evidence was insufficient"}</strong>{recognition.timestampSeconds !== null && <small>Starting at {seconds(recognition.timestampSeconds)} in the song</small>}</div>
      </div>
      <nav className="story-steps" aria-label="Recognition stages">{STEPS.map((title, index) => <button key={title} type="button" className={`story-step ${step === index ? "story-step--active" : ""}`} onClick={() => goTo(index)} aria-current={step === index ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span>{title}</button>)}</nav>
      <div className="story-body">
        <div className="story-visual">
          <div className="story-visual-head"><span>{String(step + 1).padStart(2, "0")} / {STEPS[step]}</span><span>RECORDING {seconds(cursor)} / {seconds(explanation.queryDurationSeconds)}</span></div>
          {step === 0 && <WaveformEnvelope points={explanation.waveformEnvelope} duration={explanation.queryDurationSeconds} cursor={cursor} />}
          {step === 1 && <SpectrogramCanvas spectrogram={explanation.spectrogram} cursorSeconds={cursor} frequencyBand={{ minimum: config.minimumFrequencyHz, maximum: config.maximumFrequencyHz }} />}
          {step === 2 && <ConstellationPlot peaks={explanation.peaks} durationSeconds={explanation.queryDurationSeconds} maximumFrequencyHz={explanation.spectrogram.maximumFrequencyHz} cursorSeconds={cursor} />}
          {step === 3 && <PairPlot pairs={explanation.pairExamples} duration={explanation.queryDurationSeconds} maximumFrequency={config.maximumFrequencyHz} cursor={cursor} />}
          {step === 4 && <div className="lookup-visual"><div className="lookup-node"><span>QUERY</span><strong>{explanation.counts.lookupFingerprints.toLocaleString()}</strong><small>fingerprints checked</small></div><div className="lookup-path" aria-hidden="true"><span>version {config.fingerprintVersion} + hash</span><i /></div><div className="lookup-node lookup-node--catalog"><span>CATALOG INDEX</span><strong>{explanation.counts.matchingHashes.toLocaleString()}</strong><small>distinct hashes found</small></div><p>Matching hashes are candidate evidence. The next step checks whether their times agree.</p></div>}
          {step === 5 && <FingerprintAlignment matches={explanation.matchedFingerprints} queryDurationSeconds={explanation.queryDurationSeconds} sourceInterval={explanation.sourceInterval} cursorSeconds={cursor} />}
          {step === 6 && <VoteHistogram votes={explanation.decision.clusteredOffsetVotes} threshold={explanation.decision.minimumVotes} timestampSeconds={explanation.decision.leadingOffsetSeconds} accepted={recognition.matched} />}
          <div className="story-clip-track" aria-hidden="true"><span style={{ width: `${Math.min(100, cursor / stepDuration * 100)}%` }} /></div>
        </div>
        <aside className="story-detail"><p className="story-detail-index">STEP {String(step + 1).padStart(2, "0")} / 07</p><h3>{STEPS[step]}</h3><p className="story-summary">{detail.summary}</p><div className="story-measure"><span>FROM THIS RECORDING</span><strong>{detail.measure}</strong></div>
          {step === 6 && explanation.candidateVotes.length > 0 && <div className="candidate-list" aria-label="Leading catalog candidates">{explanation.candidateVotes.map((candidate) => <div key={candidate.songName}><span>{candidate.songName}</span><strong>{candidate.votes} votes</strong></div>)}</div>}
          <button className="technical-toggle" type="button" onClick={() => setShowTechnical((current) => !current)} aria-expanded={showTechnical}>{showTechnical ? "Hide technical detail −" : "Show technical detail +"}</button>{showTechnical && <p className="technical-copy">{detail.technical}</p>}
        </aside>
      </div>
      <div className="story-controls">
        <button type="button" className="story-control-secondary" onClick={() => goTo(step - 1)} disabled={step === 0}>← Previous</button>
        <button type="button" className="story-play" onClick={toggleReplay} disabled={reducedMotion}>{actuallyPlaying ? "Pause replay" : "▶ Play explanation"}</button>
        <button type="button" className="story-control-secondary" onClick={() => goTo(step + 1)} disabled={step === STEPS.length - 1}>Next →</button>
        <button type="button" className={`story-sound ${soundEnabled ? "story-sound--on" : ""}`} onClick={toggleSound} aria-pressed={soundEnabled} aria-label={`Recording sound ${soundEnabled ? "on" : "off"}. Click to turn ${soundEnabled ? "off" : "on"}.`}>{soundEnabled ? "♪ Sound on" : "♪ Sound off"}</button>
        <label className="story-speed">Speed <select value={speed} onChange={(event) => { const next = Number(event.target.value); setSpeed(next); if (audioRef.current) audioRef.current.playbackRate = next; }}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select></label>
      </div>
      <p className="story-sound-help">Sound is off by default. Turn it on to hear the same moment shown by the graph cursor. Each stage plays the recording once.</p>
      {soundError && <p className="story-audio-error" role="alert">{soundError}</p>}
      <label className="story-scrub">Replay position <input type="range" min="0" max={totalDuration - .001} step="0.01" value={progress} onChange={(event) => { audioRef.current?.pause(); setPlaying(false); setReplayPosition(Number(event.target.value)); }} /></label>
      {step <= 3 && <label className="story-scrub story-scrub--cursor">Inspect recording time <input type="range" min="0" max={stepDuration - .001} step="0.01" value={progress % stepDuration} onChange={(event) => { audioRef.current?.pause(); setPlaying(false); setReplayPosition(step * stepDuration + Number(event.target.value)); }} /><output>{seconds(cursor)}</output></label>}
      {reducedMotion && <p className="story-motion-note">Animation is paused because your device requests reduced motion. Every stage remains available with the step controls.</p>}
    </section>
  );
}
