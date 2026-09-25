"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TitleCard from "../title-card";
import { type ChapterSpec, HIGHLIGHT, buildChapters } from "./chapters";
import type { ReplayData } from "./data";
import { playStars } from "./sonify";
import { type WorldLabel, ReplayWorld } from "./world";
import { ReplayAudio } from "./world/audio";

type ReplayProps = {
  data: ReplayData;
  mode: "highlight" | "class";
  recordingUrl: string;
  onExit: () => void;
  onClassMode: () => void;
  onHome: () => void;
};

export default function Replay({ data, mode, recordingUrl, onExit, onClassMode, onHome }: ReplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<ReplayWorld | null>(null);
  const [labels, setLabels] = useState<WorldLabel[]>([]);
  const [noise, setNoise] = useState(false);
  const [playing, setPlaying] = useState<"stars" | "recording" | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const audioRef = useRef<ReplayAudio | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const allChapters = useMemo(() => buildChapters(data), [data]);
  const chapters = useMemo(
    () => (mode === "class" ? allChapters : allChapters.filter((chapter) => HIGHLIGHT.includes(chapter.id))),
    [allChapters, mode],
  );
  const [index, setIndex] = useState(0);
  const chapter: ChapterSpec = chapters[Math.min(index, chapters.length - 1)];
  const firstStop = useRef(chapters[0].id);
  // The world is built once per replay, for the mode it was opened in.
  const openedAs = useRef(mode);
  // At the lock the world asks for the recording to play: the very sound that was matched.
  const onLockRef = useRef<() => void>(() => {});
  useEffect(() => {
    firstStop.current = chapters[0].id;
  }, [chapters]);

  // Build the world once per replay.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let world: ReplayWorld;
    let audio: ReplayAudio | null = null;
    try {
      audio = new ReplayAudio();
    } catch {
      audio = null; // No Web Audio: the replay simply stays silent.
    }
    audioRef.current = audio;
    try {
      world = new ReplayWorld(canvas, data, {
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        highlight: openedAs.current === "highlight",
        onLock: () => onLockRef.current(),
        onCue: (cue) => audio?.play(cue),
      });
    } catch {
      audio?.dispose();
      audioRef.current = null;
      return;
    }
    worldRef.current = world;
    world.goTo(firstStop.current);
    const onResize = () => world.resize();
    window.addEventListener("resize", onResize);
    let animation = 0;
    let lastLabels = 0;
    const loop = (now: number) => {
      animation = requestAnimationFrame(loop);
      const next = world.frame(now);
      audio?.rain(world.stormLevel());
      if (now - lastLabels > 50) {
        lastLabels = now;
        setLabels(next);
      }
    };
    animation = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animation);
      window.removeEventListener("resize", onResize);
      world.dispose();
      worldRef.current = null;
      audio?.dispose();
      audioRef.current = null;
    };
  }, [data]);

  const stopSound = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setPlaying(null);
  }, []);

  const go = useCallback(
    (next: number) => {
      const bounded = Math.max(0, Math.min(chapters.length - 1, next));
      stopSound();
      setNoise(false);
      worldRef.current?.setNoise(false);
      setIndex(bounded);
      worldRef.current?.goTo(chapters[bounded].id);
    },
    [chapters, stopSound],
  );

  // The highlight flies itself; class mode waits for the presenter.
  useEffect(() => {
    if (mode !== "highlight" || chapter.id === "verdict") return;
    const timer = window.setTimeout(() => go(index + 1), (chapter.settle + 2.4) * 1000);
    return () => window.clearTimeout(timer);
  }, [mode, chapter, index, go]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
      if (["ArrowRight", "PageDown", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        go(index + 1);
      } else if (["ArrowLeft", "PageUp", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        go(index - 1);
      } else if (event.key === " ") {
        event.preventDefault();
        worldRef.current?.replayChapter();
      } else if (event.key.toLowerCase() === "n" && chapter.id === "stars") {
        setNoise((current) => {
          worldRef.current?.setNoise(!current);
          return !current;
        });
      } else if (event.key.toLowerCase() === "m") {
        setMuted((current) => {
          audioRef.current?.setMuted(!current);
          return !current;
        });
      } else if (event.key === "Escape") {
        onExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, chapter.id, onExit]);

  useEffect(() => stopSound, [stopSound]);

  const playTheStars = () => {
    stopSound();
    stopRef.current = playStars(data.response.explanation.peaks);
    worldRef.current?.startListening();
    setPlaying("stars");
    const timer = window.setTimeout(() => setPlaying(null), (data.duration + 0.5) * 1000);
    const stop = stopRef.current;
    stopRef.current = () => {
      window.clearTimeout(timer);
      stop();
    };
  };

  const playTheRecording = () => {
    stopSound();
    const audio = new Audio(recordingUrl);
    void audio.play();
    worldRef.current?.startListening();
    setPlaying("recording");
    audio.onended = () => setPlaying(null);
    stopRef.current = () => audio.pause();
  };

  useEffect(() => {
    onLockRef.current = () => playTheRecording();
  });

  const verdict = chapter.id === "verdict";
  return (
    <div className={`replay replay-${mode}`}>
      <canvas ref={canvasRef} className="replay-world" aria-hidden="true" />

      <div className="replay-labels" aria-hidden="true">
        {labels
          .filter((label) => label.visible)
          .map((label) => (
            <div key={label.id} className={`world-label world-label-${label.tone}`} style={{ transform: `translate(${label.x}px, ${label.y}px)` }}>
              <span>{label.text}</span>
              {label.detail ? <small>{label.detail}</small> : null}
            </div>
          ))}
      </div>

      {chapter.id === "sound" && data.samples ? <SampleLens samples={data.samples} rate={data.samplesRate} /> : null}

      {verdict ? (
        <div className="replay-verdict">
          <TitleCard
            recognition={data.response.recognition}
            onWatch={() => go(0)}
            onClassMode={mode === "class" ? () => go(0) : onClassMode}
            onHome={onHome}
          />
        </div>
      ) : (
        <section className="caption" aria-live="polite" key={chapter.id}>
          <p className="caption-kanji" lang="ja">{chapter.kanji}</p>
          <h2 className="caption-title">{chapter.title}</h2>
          {mode === "class" ? <p className="caption-sentence">{chapter.sentence}</p> : null}
          {chapter.id === "listen" ? (
            <div className="caption-actions">
              <button type="button" className="action action-primary" onClick={playing === "stars" ? stopSound : playTheStars}>
                {playing === "stars" ? "Stop" : "Play only the stars"}
              </button>
              <button type="button" className="action" onClick={playing === "recording" ? stopSound : playTheRecording}>
                {playing === "recording" ? "Stop" : "Play the recording"}
              </button>
            </div>
          ) : null}
          {chapter.id === "stars" && mode === "class" ? (
            <button
              type="button"
              className={noise ? "action action-primary" : "action"}
              aria-pressed={noise}
              onClick={() => {
                worldRef.current?.setNoise(!noise);
                setNoise(!noise);
              }}
            >
              {noise ? "Remove the noise" : "Add noise"}
            </button>
          ) : null}
        </section>
      )}

      {chapter.figure && !verdict ? (
        <p className="figure" key={`${chapter.id}-figure`}>
          <strong>{chapter.figure.value}</strong>
          <span>{chapter.figure.unit}</span>
        </p>
      ) : null}

      <nav className="journey" aria-label="Replay stops">
        <ol>
          {chapters.map((item, position) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={position === index ? "step" : undefined}
                className={position === index ? "journey-stop journey-stop-current" : position < index ? "journey-stop journey-stop-past" : "journey-stop"}
                onClick={() => go(position)}
              >
                {item.short}
              </button>
            </li>
          ))}
        </ol>
        <div className="journey-keys">
          <button type="button" className="journey-arrow" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous stop">
            <Arrow direction="left" />
          </button>
          <button type="button" className="journey-arrow" onClick={() => go(index + 1)} disabled={index === chapters.length - 1} aria-label="Next stop">
            <Arrow direction="right" />
          </button>
          <div className="journey-sound">
            <button
              type="button"
              className="journey-mute"
              aria-pressed={muted}
              onClick={() => {
                audioRef.current?.setMuted(!muted);
                setMuted(!muted);
              }}
            >
              {muted ? "Sound off" : "Sound on"}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              aria-label="Replay volume"
              disabled={muted}
              onChange={(event) => {
                const next = Number(event.target.value);
                audioRef.current?.setVolume(next);
                setVolume(next);
              }}
            />
          </div>
          <button type="button" className="journey-exit" onClick={onExit}>
            Leave
          </button>
        </div>
      </nav>
    </div>
  );
}

function Arrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d={direction === "left" ? "M15 5 L8 12 L15 19" : "M9 5 L16 12 L9 19"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A magnifier over the lake: 25 ms of the actual recording, one dot per number. */
function SampleLens({ samples, rate }: { samples: Float32Array; rate: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const windowSize = Math.round(rate * 0.025);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const size = 280;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    // Centre the lens on the loudest stretch, where the wave is easiest to see.
    let loudest = 0;
    let at = 0;
    for (let index = 0; index + windowSize < samples.length; index += windowSize) {
      let energy = 0;
      for (let offset = 0; offset < windowSize; offset += 4) energy += Math.abs(samples[index + offset]);
      if (energy > loudest) {
        loudest = energy;
        at = index;
      }
    }
    const slice = samples.subarray(at, at + windowSize);
    const peak = Math.max(0.05, ...Array.from(slice, Math.abs));
    context.clearRect(0, 0, size, size);
    context.strokeStyle = "rgba(255, 246, 230, 0.35)";
    context.lineWidth = 1;
    context.beginPath();
    slice.forEach((value, index) => {
      const x = 22 + (index / (slice.length - 1)) * (size - 44);
      const y = size / 2 - (value / peak) * (size / 2 - 40);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    context.fillStyle = "#fff6e6";
    slice.forEach((value, index) => {
      const x = 22 + (index / (slice.length - 1)) * (size - 44);
      const y = size / 2 - (value / peak) * (size / 2 - 40);
      context.beginPath();
      context.arc(x, y, 2.3, 0, Math.PI * 2);
      context.fill();
    });
  }, [samples, windowSize]);
  return (
    <figure className="lens">
      <canvas ref={canvasRef} />
      <figcaption>
        25 milliseconds of your recording: {windowSize.toLocaleString("en-US")} numbers, one dot each
      </figcaption>
    </figure>
  );
}
