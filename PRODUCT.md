# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary, demo day:** a university signal-processing class and its teacher, watching a
  laptop demo on a classroom projector. The teacher has not studied how the project works and
  grades on whether the demo alone makes him fully understand it; he weighs visualization and
  speed above all.
- **Presenters:** two students (about 6 minutes together including slides, then 2 minutes of
  questions) driving the laptop.
- **Everyday use:** anyone identifying a song from the microphone or a browser tab.

## Product Purpose

Apollo identifies a song from a few seconds of audio, like Shazam, using signal processing
built from scratch. Shazam hides everything behind one button; Apollo's purpose on demo day is
the opposite: make the audience see and understand every step between sound and answer, and
show that this is as complex as image blurring, encryption or ECG projects. Success: the
teacher can explain the pipeline back after the demo, and the answer still arrives fast.

## Positioning

Every visual is real evidence from the recording just made, not decoration: its spectrogram,
its peaks, its fingerprint hashes, the database votes, the alignment. Apollo also recognizes
sped-up/slowed/pitch-shifted edits (its own speed/pitch search) and covers, live versions and
crowds singing (vocal separation + melody/chroma DTW), which a plain fingerprint demo cannot show.

## Operating Context

- Runs on localhost (FastAPI backend, Next.js frontend) on a gaming laptop with an RTX 3050,
  projected in a classroom at typical projector resolutions (1920x1080, 1366x768).
- Audio comes from the laptop microphone or a shared browser tab (exact digital audio; keep the
  video in a separate window so Chrome does not throttle the Apollo tab).
- Normal use: short highlight after the answer. Class mode: a presenter-stepped replay in
  chapters (keyboard/clicker) covering every stage, one plain sentence and one real number each.

## Capabilities and Constraints

- Pipeline: audio → mono/resample → STFT spectrogram → peak constellation → paired hashes
  (f1, f2, Δt) → indexed SQLite lookup (about 3M+ hashes, 27 songs) → time-offset voting → match.
  Fallbacks: speed/pitch edit search (78 candidates), then melody matching (Demucs vocals, pYIN
  pitch, CENS chroma, 12-key DTW).
- Live checks every ~1 s stop as soon as two agree; a 10 s early answer covers covers; 15 s max.
- **Speed is non-negotiable:** visualization must never delay recognition. Extra evidence for
  visuals is fetched or computed after the answer.
- The existing explanation API returns waveform, spectrogram, peaks, matched fingerprints,
  offset votes, candidates, counts, and melody match details.

## Brand Commitments

- Name: Apollo. On-screen explanations in plain English.
- The previous look (by a teammate) may be fully replaced; all features, flows and factual copy
  meaning are preserved.

## Evidence on Hand

- Real measurements in PROGRESS.md (per-stage timings, accuracy on 41 cover videos, 24
  not-in-catalog cuts). Test clips in `D:\Signal Project\Clips`; catalog songs in
  `D:\Signal Project\Songs`.
- No testimonials, users, or benchmarks beyond these measurements; do not invent any.

## Product Principles

1. Show, don't claim: every number and shape on screen is computed from the actual recording.
2. The answer is never slower because of the show.
3. One idea per moment: each chapter teaches one step a newcomer can repeat back.
4. Legible from the back row: projector first.

## Accessibility & Inclusion

Honor reduced-motion preferences with a stepwise, low-motion version of every chapter. Colour
never carries meaning alone.
