# Apollo design: a painted sky for a song

This document is for reviewing the frontend redesign on branch `design`. It covers what the design
is trying to do, how it looks and moves, what every screen shows, how it is built, and what is
still open. Product context is in `PRODUCT.md`. The speed rules the design must obey are at the top
of `AGENTS.md`.

## 1. The brief

- **Why redesign:** the old frontend was a plain form with charts ("looks dead").
- **The demo:** a 6-minute university demo plus 2 minutes of Q&A. It runs on a gaming laptop
  (RTX 3050) connected to a classroom projector, at 1920×1080 or 1366×768. It will never be shown
  on a phone.
- **The audience:** a signals class and a teacher who has not studied the project. The teacher
  should be able to explain the pipeline back afterwards.
- **The look:** inspired by anime films such as Studio Ghibli and Makoto Shinkai's *Your Name*.
  All art is original. Explicitly not "gradient AI slop".
- **Hard constraint:** recognition speed and matching results must not change, and the answer must
  never wait for visuals (see `AGENTS.md`, "Speed comes first").

## 2. The idea in one sentence

**The recording becomes a night sky: the spectrogram is the sky, its peaks are the stars, the
fingerprints are pairs of stars, and the match is the moment the song's own stars slide onto the
recording's and tie to them with red threads.**

The metaphor is literal, not decoration. Every star, line and pillar on screen is drawn from
measured data for the recording just made. Nothing is a stock animation.

## 3. Visual system

### The world

- An evening scene just after sunset: a painted sky, a far ridge, a near hill, utility poles with
  sagging wires, and a still lake that reflects everything.
- **Sky:** warm gold and rose at the horizon, turning to deep blue-hour ultramarine and night
  higher up. It is deliberately *not* purple, which was changed after review: purple made the
  foreground hard to read.
- **Clouds:** cel-shaded in two or three flat tones with a lit rim, never smooth gradients. Warm,
  lit tops over cool slate-blue undersides.
- **Film grain and a soft vignette** make it feel painted rather than rendered.
- **Night falls to give data the stage:** the sky dims by about a quarter while listening and on the answer,
  and 50% in the replay. The white stars and red threads are then always the brightest things on
  screen.

### Colour means something

One colour per meaning, used consistently everywhere:

| Colour | Token | Means |
|---|---|---|
| Star white `#fff6e6` | `--star` | the recording (what the microphone heard) |
| Comet teal `#9fe3e0` | `--comet` | the catalog song (what Apollo knows) |
| Lantern amber `#ffc98a` | `--lantern` | analysis: the scanning beam, focus, numbers |
| Thread red `#e2323f` | `--thread` | the match only: threads and the verdict line |

Red is saved for the match, so its appearance is the payoff.

### Readability rules (after review feedback)

- **Text over the sky** always carries a dark shadow (`--shadow-text`).
- **Answer card and Listen controls** sit on a soft radial pool of night (`::before` scrims).
- **Replay captions** sit on dark water: a gradient that rises from the bottom of the screen.
- **Panels and buttons** use near-black `--lake-panel` (`rgba(4, 7, 20, 0.84)`), not tinted navy.
- **Floating labels in the 3D world** get a small dark backing.

### Typography

- **Display (titles, big numbers):** Shippori Mincho B1, a Japanese-style serif.
- **Text (sentences, buttons, labels):** Zen Kaku Gothic New.
- **Japanese accents:** a kanji above each replay stop (音, 空, 星, 結, 星空, 速度, 声, 結び, 聴く)
  and a vertical credit, 音の星空 ("the starry sky of sound"), at the left edge like a film credit.
- **Self-hosted in `frontend/app/fonts/`,** so the demo works offline.

### Motion

- **The camera flies** between stops like a crane move: it rises mid-flight and eases in.
- **Stars ignite:** a flash, then they settle to their brightness.
- **Text rises** into place with a short blur-in.
- **The answer title unveils** left to right, and a red rule draws in beneath it.
- **`prefers-reduced-motion`** is respected: the sky stops drifting and the ignite flashes are
  removed.

## 4. Screens and flow

### 4.1 Start

- The painted evening scene.
- At the bottom, over the lake: a source switch (Microphone / Browser tab), a round record button,
  "Listen", and a hint.

### 4.2 Listening: the sky paints itself

While recording, `sky/live-sky.tsx` runs its own FFT (in TypeScript) on the captured samples. It
only draws; recognition is untouched.

- **The spectrogram is painted into the sky in real time.** Time runs left to right across the
  15-second window. Pitch rises from bottom to top, 100 Hz to 5 kHz on a log axis. Brighter means
  louder.
- **An amber beam** marks "now".
- **Local maxima ignite as stars:** the same idea as the peaks Apollo fingerprints.
- **Lines hang into the lake** to show loudness.
- **Beads on the horizon** mark each live check: white = no match, teal = possible, red =
  confirmed.
- **For performance,** the painted sky holds still while listening, and the live sky draws at no
  more than 30 fps.

*Open point:* none of this is labelled on screen yet. Proposed: "time →", "pitch ↑", "each star =
a peak Apollo keeps".

### 4.3 The answer: a film title card

It appears **the moment a live check confirms**, before the explanation arrives.

- **The title card:** "Heard at **0:51** into", then the song name, large, with a red rule under it.
- **For edits and covers,** a detail band such as "Slowed to 89% of the original" or the key shift.
- **Buttons:**
  - **Watch how it was found:** a short highlight replay (shows "Preparing the replay…" until the
    data is ready).
  - **Class mode:** the full presenter-stepped replay.
  - **Play on Spotify at 0:51:** the link carries `#m:ss` so the song opens at the matched second.
    *Not yet confirmed on Spotify Premium.*
  - **Try another song:** back to the start screen and clears the sky; it does not start
    recording.
- **No match:** the card says "No song in the catalog matched", and you can still watch what was
  heard.

### 4.4 The replay: a camera journey through one 3D world

One three.js scene (`replay/world.ts`), with the camera flying between stops. The wide stops frame
the 3D sky **exactly** where the live sky was painted, so the replay continues the picture the
audience just watched instead of cutting to a new one.

| Stop | Kanji | What you see | What it teaches |
|---|---|---|---|
| Sound | 音 | The waveform standing in the sky; a round lens shows 25 ms of real samples as dots | Sound is just a list of numbers (e.g. 48,000 a second) |
| Spectrum | 空 | An analysis beam sweeps across and paints the sky slice by slice; the waveform lies down onto the lake | STFT: time → right, pitch → up |
| Stars | 星 | The camera drifts through the sky; peaks ignite. Press **N** (or the button) to add noise: the sky fogs, the stars stay | Peaks survive noise |
| Fingerprints | 結 | An anchor star, its target zone (amber bracket) and the pairs it makes | Two pitches + time gap = one hash |
| Catalog | 星空 | The camera pulls out to a galaxy: one constellation per catalog song. Lookups stream to them as shooting stars | Hash lookup; most hits are coincidences |
| Speed search (edits only) | 速度 | The stars stretch through every speed/pitch guess; the vote curve on the lake spikes at the right one | How edits are still found |
| Voice (covers only) | 声 | The voice lifts out of the band; the singer's melody line and the original's are tied by the time-warping path | Demucs + pitch tracking + DTW |
| Alignment | 結び | The song's own stars (teal) fly in and slide until red threads tie them to the recording's; offset votes rise from the lake as light pillars, and only the true offset stands tall | Offset voting: the core of the match |
| Listen | 聴く | Play the recording as only its stars (sine tones) against the real recording | A few hundred peaks keep the tune |
| Answer | 音の星空 | The title card again | |

- **Every stop** has a kanji, a title, one plain-English sentence built from **this recording's
  real numbers**, and one big figure (e.g. "344 fingerprints agree").
- **The highlight** (after "Watch how it was found") plays Spectrum → Stars → Catalog → (Speed
  search | Voice) → Alignment → Answer automatically, without the sentences.
- **Class mode** is driven by the presenter:
  - next: → ↓ Page Down (so clickers work);
  - previous: ← ↑ Page Up;
  - Space replays the current stop;
  - N adds noise on Stars;
  - Esc leaves;
  - a stop rail along the bottom can be clicked.
- A "How long it took" timing stop existed and was **removed at the user's request**.

## 5. Where the data comes from

- **Available immediately:** the answer and `/recognize/explain` (existing). They provide the
  waveform, spectrogram, peaks, fingerprints, votes and decision.
- **`POST /recognize/evidence` (new, `backend/app/evidence.py`):** called **only when the replay
  is opened**. It returns:
  - the votes and hash hits of every catalog song;
  - the catalog size;
  - the song's own peaks over the matched window, read from its file in `Songs/` (matched by
    title; same-title versions such as the two *Sparkle*s are told apart by fingerprint);
  - for edits, the speed/pitch vote curve;
  - for covers, the separated melody lines and the DTW path.

  Payloads never contain hash values (an existing test enforces this).
- **`score_candidate_changes`** was refactored out of `search_playback_speeds` so the curve reuses
  the real search. Recognition results were verified identical to `main` on 15 noisy edits.

## 6. Performance rules the design obeys

Full rules and time budgets are in `AGENTS.md`. Summary:

- **The answer never waits for visuals.** It shows on the first confirmed live check.
- **Heavy work only on request.** Evidence, decoding and building the 3D world start when the
  replay is opened. Opening it costs a few seconds: about 4 s for a normal song, 7 s for an edit.
- **Listening stays light:** the painted sky is paused and the live sky is capped at 30 fps.
- **Measured time from pressing Listen to the song showing** (production build, 1920×1080):
  about 3.4 s for a normal clip; about 9.6 s for the F1 0.89× edit.

## 7. File map

```text
frontend/app/
  page.tsx            recording flow (logic unchanged) + which layer shows when
  title-card.tsx      the answer card, Spotify link at the matched second
  globals.css         tokens, type, every component's styles
  fonts/              self-hosted fonts
  sky/
    painted-sky.tsx   WebGL shader: banded sky, clouds, lake reflection, grain
    horizon.tsx       SVG ridges, poles, wires, reflection
    live-sky.tsx      live FFT spectrogram + stars + checks while listening
    fft.ts, stars.ts, paint.ts, geometry.ts   shared maths and screen geometry
  replay/
    world.ts          the three.js world, camera stops, per-frame choreography
    replay.tsx        replay UI: captions, figures, lens, stop rail, keys
    chapters.ts       stop list and the sentences built from real numbers
    data.ts           builds replay data from the explanation + evidence
    sonify.ts         plays the stars as sine tones
frontend/lib/api.ts   API types incl. evidence
backend/app/evidence.py, backend/tests/test_evidence.py
```

Six old components were deleted: `constellation-plot`, `fingerprint-alignment`,
`spectrogram-canvas`, `vote-histogram`, `recognition-explanation` and `live-waveform`.

## 8. How to review it

1. Start the backend and the frontend (`npm run dev` or `npm run build && npm start` in
   `frontend/`).
2. Play a song in **another browser window** (not a hidden tab: Chrome throttles those). Press
   Listen and watch the sky paint.
3. On the answer, try each button. In Class mode, step through every stop with the arrow keys.
4. Try three kinds of clip: a normal song, a sped-up or slowed edit (Speed search stop) and a
   cover (Voice stop). Try a song that is not in the catalog too.
5. Check at 1920×1080 and 1366×768, ideally on the real projector: colours and contrast on a
   projector are the biggest risk.

## 9. Known limitations and open questions

- **The listening sky has no on-screen labels** yet (see 4.2).
- **The Spotify `#m:ss` start time** is untested on a Premium account.
- **The replay takes a few seconds to open**, because its data is fetched only on click. That is
  the trade-off for a fast answer.
- **Covers are slower with 25+ songs:** the early melody answer at 10 s sits near its acceptance
  margin, so it can fall back to the full 15 s.
- **Proposed, not built:**
  - bloom/glow post-processing;
  - a bigger "lock" moment in Alignment, where all threads fire at once and the real song plays
    from the matched second;
  - one continuous camera flight instead of stops;
  - a meteor shower on the answer.
- **Scope:** laptop and projector only; there is no mobile layout by design.
