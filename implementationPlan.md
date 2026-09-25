# Apollo Frontend Enhancement Plan

**Constraint:** Zero backend changes. All new features use existing API responses (`/recognize`, `/recognize/explain`) or are computed entirely in the browser from data already returned.

---

## User Review Required

> [!IMPORTANT]
> This plan adds **no new backend endpoints or data fields**. Every feature either uses data already in `RecognitionExplanationResponse`, derives new visualizations client-side from that data, or is a pure frontend simulation. Review the scope carefully — some items are large and could be phased.

> [!WARNING]
> Several features (Interactive Spectrogram, Fingerprint Sandbox, Noise Simulator) involve client-side Web Audio / Canvas work that is CPU-intensive. They should be lazy-loaded and behind user interaction to avoid impacting initial page load.

---

## Open Questions

1. **Multi-page vs. single page?** The current app is one scrolling page. Some features below (Algorithm Lab, Catalog Browser) could live on separate routes. Do you want to keep everything on one page, or introduce Next.js routing with a sidebar/nav?
2. **Tailwind vs. vanilla CSS?** The project already uses Tailwind v4. Should the implementer continue with Tailwind utility classes + globals.css, or move toward a different styling approach?
3. **Priority ordering:** There are ~15 feature groups below. Do you want them all in one pass, or should I mark tiers (must-have / nice-to-have)?

---

## Proposed Changes

### Overview

The plan is organized into **6 areas**:

| Area | Goal |
|---|---|
| A. Live Recognition Experience | Make the recording/listening phase feel more alive and informative |
| B. Seven-Stage Walkthrough Enhancements | Richer graphs, better interactivity, clearer narrative |
| C. New Frontend-Only Simulations | Educational tools that run entirely in the browser |
| D. "Why This Song Won" Verdict Panel | Surface every backend decision field into a compelling summary |
| E. Visual Design & Responsiveness | Polish the overall aesthetic, typography, animations |
| F. Project Structure & Code Quality | Component organization, accessibility, performance |

---

### A. Live Recognition Experience

> **Data source:** All existing — uses live AudioWorklet samples, `/recognize` responses, and recording metadata.

---

#### A1. Real-Time Frequency Spectrum Bar

##### [NEW] `app/components/live-spectrum.tsx`

Add a live frequency-domain visualization beside the existing waveform during recording. Use `AnalyserNode.getFloatFrequencyData()` from the already-open `AudioContext` to show a real-time spectrum bar (like an EQ visualizer). This gives the user an immediate sense of "the system is looking at frequencies" before the explanation phase.

- Canvas-based, ~120 frequency bins, colored by the same teal palette
- Label frequency axis with the 100 Hz – 5 kHz band that Apollo actually searches, subtly highlighted
- Updates at `requestAnimationFrame` rate, pauses when not recording

##### [MODIFY] [`page.tsx`](file:///D:/Apollo/frontend/app/page.tsx)

- Instantiate `AnalyserNode` alongside the existing `AudioWorkletNode` in `openMicrophone()`
- Pass the analyser ref to the new `LiveSpectrum` component
- Render both `LiveWaveform` and `LiveSpectrum` side-by-side in the `.live-input` container

---

#### A2. Check Status Timeline

##### [MODIFY] [`page.tsx`](file:///D:/Apollo/frontend/app/page.tsx)

Replace the simple `check-list` with a horizontal timeline that plots each check result at its timestamp:

- Each check is a dot on a 0–15 s axis
- Color: gray (no match), amber (possible match), green (confirmed match)
- On hover/focus: tooltip showing `"3.2 s — Possible match: Cold (feat. Future)"`
- The two consecutive green dots that triggered early stop get a connecting line and a "✓ Confirmed" label
- Uses existing `CheckEvent` data plus the `RecognitionResponse` from each early check (currently only `text` is stored — also store the `response.song?.name` and `response.matched` in the check event)

---

#### A3. Recording Confidence Ring

##### [NEW] `app/components/confidence-ring.tsx`

During recording, show a radial progress indicator around the Listen button area:

- Inner ring: recording time progress (0 → 15 s)
- Outer ring: "match confidence" — starts at 0%, jumps when a check returns matched, fills to 100% on confirmed match
- Animates smoothly with CSS `conic-gradient` + JS updates
- Uses existing check responses — no new API calls

---

#### A4. Post-Match Hero Card

##### [MODIFY] [`page.tsx`](file:///D:/Apollo/frontend/app/page.tsx)

When a match is found, replace the plain text result with a visually rich card:

- Large song name with gradient text
- Formatted timestamp `"Starting at 1:23 in the song"` with a visual timeline bar showing where in the song the clip landed
- Speed/pitch edit badge: `"🎵 Nightcore 1.25×"` or `"🎤 Deep voice −2.1 st"` styled as a pill
- Confidence percentage bar: `recognition.confidence` rendered as a filled gauge
- Spotify link styled as a branded button with the Spotify green
- The `sourceInterval` from explanation (once loaded) used to show a mini song-position bar

All data is already in `RecognitionResponse` and `RecognitionExplanationResponse`.

---

### B. Seven-Stage Walkthrough Enhancements

> **Data source:** All from the existing `RecognitionExplanation` response. No new backend data needed unless marked.

---

#### B1. Dark-Themed Charts

##### [MODIFY] [`spectrogram-canvas.tsx`](file:///D:/Apollo/frontend/app/spectrogram-canvas.tsx), [`constellation-plot.tsx`](file:///D:/Apollo/frontend/app/constellation-plot.tsx), [`fingerprint-alignment.tsx`](file:///D:/Apollo/frontend/app/fingerprint-alignment.tsx), [`vote-histogram.tsx`](file:///D:/Apollo/frontend/app/vote-histogram.tsx), [`recognition-explanation.tsx`](file:///D:/Apollo/frontend/app/recognition-explanation.tsx)

Currently all chart SVGs/canvases use white backgrounds with light gray plot areas, which clash with the dark teal page theme. Restyle all charts to match:

- **Background:** `#0f1e24` (dark teal) instead of `#ffffff`
- **Plot area:** `#152830` instead of `#f9fafb`
- **Grid lines:** `rgba(255,255,255,0.06)` instead of `rgba(0,0,0,0.07)`
- **Axis text:** `#8eb8c0` instead of `#374151`
- **Spectrogram colormap:** switch to the "inferno" or "magma" palette (dark → orange/yellow → white) which reads better on dark backgrounds
- **Data colors:** keep teal for unmatched peaks, gold for matched — already compatible
- **Borders and ticks:** subtle `#2c454d`

This is purely CSS/Canvas color changes — no structural modifications.

---

#### B2. Interactive Cursor Crosshair

##### [MODIFY] All chart components

Add a crosshair cursor when the user hovers over any chart:

- Vertical + horizontal dashed lines following the mouse
- Corner tooltip showing the exact `(time, frequency)` or `(time, amplitude)` values
- On the spectrogram: show dB value at the hovered cell
- On the constellation plot: highlight the nearest peak and show its `amplitudeDb`
- On the vote histogram: highlight the hovered bar and show its vote count + offset

Implementation: each chart component receives an `onHover` callback. A shared `CursorOverlay` component renders the crosshair and tooltip positioned absolutely over the chart.

---

#### B3. Spectrogram ↔ Peaks Overlay Toggle

##### [MODIFY] [`recognition-explanation.tsx`](file:///D:/Apollo/frontend/app/recognition-explanation.tsx)

Add a toggle button on the Peaks step (step 2/3) that overlays the constellation peaks on top of the spectrogram canvas. This visually connects "here are the frequencies" (spectrogram) with "here are the peaks we kept" (constellation):

- Render the spectrogram canvas as the background
- Overlay the peak dots (from `explanation.peaks`) on top, using the same coordinate mapping
- Toggle: "Show spectrogram behind" / "Peaks only"
- Both datasets are already returned — just composite them

---

#### B4. Fingerprint Pair Animation

##### [MODIFY] [`recognition-explanation.tsx`](file:///D:/Apollo/frontend/app/recognition-explanation.tsx)

On the Fingerprints step (step 3), animate the "formula" display:

- When cursor reaches a new pair, animate the anchor dot appearing, then a line drawing to the target dot, then the formula bar sliding in with the computed values
- Use CSS keyframes (not a library) — scale up, fade in, draw line
- The `pairExamples` array already has all 12 representative pairs

---

#### B5. Catalog Lookup Animation

##### [MODIFY] [`recognition-explanation.tsx`](file:///D:/Apollo/frontend/app/recognition-explanation.tsx)

The current catalog step (step 4) is a static two-box diagram. Make it a flowing animation:

- Fingerprint "cards" fly from the Query box toward the Catalog box
- Some pass through (matching hashes) — these glow gold
- Some bounce off (no match) — these fade
- A counter increments as matches are found: `"142 / 1,247 checked..."`
- Final state: the same two numbers currently shown (`lookupFingerprints`, `matchingHashes`)
- All data is from `explanation.counts` — the animation is purely illustrative using those totals

---

#### B6. Alignment Step — Dual Waveform

##### [MODIFY] [`fingerprint-alignment.tsx`](file:///D:/Apollo/frontend/app/fingerprint-alignment.tsx)

Replace the plain colored bands on the alignment chart with mini waveform envelopes:

- **Query band:** render the `waveformEnvelope` data (already available from step 0) as a tiny waveform inside the blue band
- **Source band:** show the `sourceInterval` range as a labeled bar (we don't have the source waveform — no backend change — so just use a styled gradient representing the full song with the matched interval highlighted)
- The alignment lines then visually connect a point in the waveform to a point in the song

---

#### B7. Decision Step — Rich Verdict

##### [MODIFY] [`recognition-explanation.tsx`](file:///D:/Apollo/frontend/app/recognition-explanation.tsx), [`vote-histogram.tsx`](file:///D:/Apollo/frontend/app/vote-histogram.tsx)

Enhance the final decision step with a structured verdict panel:

- **Vote comparison gauge:** horizontal bar chart comparing `leadingVotes` vs `runnerUpVotes` vs `minimumVotes` threshold — visually obvious why the song won or didn't
- **Acceptance checklist:** show each decision rule as a row with ✓/✗:
  - `"≥ 20 votes"` → ✓ (68 votes)
  - `"≥ 2× runner-up"` → ✓ (68 vs 12)
  - `"Offset ≥ 0"` → ✓
- **Candidate table:** the existing `candidateVotes` array shown as a ranked table with vote bars
- All data is in `explanation.decision` and `explanation.candidateVotes`

---

#### B8. Step Transition Animations

##### [MODIFY] [`globals.css`](file:///D:/Apollo/frontend/app/globals.css), [`recognition-explanation.tsx`](file:///D:/Apollo/frontend/app/recognition-explanation.tsx)

Add smooth transitions between walkthrough steps:

- Cross-fade the chart content when switching steps (CSS `opacity` + `transform` transition, 300ms)
- Slide the detail panel text in from the right on step change
- Progress indicator: a horizontal dotted line connecting the 7 step buttons, with a filled dot sliding to the active step
- Respect `prefers-reduced-motion` — instant switch when reduced motion is enabled

---

### C. New Frontend-Only Simulations

> These are **pure client-side features** that demonstrate signal processing concepts using Web Audio API and Canvas. They do not call the backend at all.

---

#### C1. Interactive Spectrogram Playground

##### [NEW] `app/components/spectrogram-playground.tsx`

A standalone educational tool (shown below the main walkthrough, or on a separate tab):

- User can **generate a tone** (sine, square, sawtooth) at a chosen frequency using `OscillatorNode`
- Or **play a short built-in sample** (a chord, a drum hit — bundled as small PCM arrays)
- The page runs a **client-side FFT** (using Web Audio `AnalyserNode` or a small JS FFT) and renders the spectrogram in real time
- User adjusts **FFT size** (512, 1024, 2048, 4096) and **hop length** via sliders
- The spectrogram updates live, showing how window size affects time-frequency resolution
- Labels: "Larger FFT → better frequency resolution, worse time resolution"
- A "Use Apollo's settings" button snaps to `fftSize=2048, hop=512` (from `signalConfig`)

No backend call — entirely client-side Web Audio.

---

#### C2. Peak Detection Simulator

##### [NEW] `app/components/peak-simulator.tsx`

An interactive demo of how peak detection works:

- Shows a small (e.g., 32×32) synthetic spectrogram grid with random "energy" values
- User can adjust:
  - Neighborhood size (the 15×9 local maximum window)
  - Amplitude floor (the −60 dB threshold)
  - Peaks per second budget
- Peaks highlight in real time as parameters change
- Caption explains: "Apollo uses a 15 bin × 9 frame neighborhood. Only the local maximum survives."
- Parameter values from `signalConfig` are shown as defaults

Pure client-side computation on a tiny synthetic grid.

---

#### C3. Fingerprint Hash Explainer

##### [NEW] `app/components/hash-explainer.tsx`

An animated breakdown of how a single fingerprint hash is computed:

- Shows an anchor peak and target peak on a mini constellation
- Draws the pairing line
- Extracts: `f_anchor_bin`, `f_target_bin`, `Δt_frames`
- Animated formula: `BLAKE2b("3|{f_anchor}|{f_target}|{Δt}")` → 16-hex-digit hash
- User can change anchor/target positions and watch the hash change
- The actual hash is not computed (that requires BLAKE2b), but the **inputs** are shown, and the concept of "different peaks → different hash" is demonstrated

All values come from `pairExamples` in the explanation response or are user-editable synthetic values.

---

#### C4. Offset Voting Simulator

##### [NEW] `app/components/vote-simulator.tsx`

Interactive demonstration of how time-offset voting works:

- A mini scenario: show 5 query fingerprints, each with an anchor frame
- Show 5 catalog fingerprints for the correct song, each with an anchor frame
- `source_offset = catalog_frame - query_frame` → each pair "votes" for an offset
- A live histogram builds as votes accumulate
- User can drag catalog frames around and watch the histogram change
- Caption: "When multiple fingerprints agree on the same offset, the song is found at that position"
- Parameters (`offsetToleranceFrames`, `minimumVotes`, `minimumWinnerRatio`) from `signalConfig`/`decision` shown

Pure client-side interactive simulation.

---

#### C5. Noise Robustness Demo

##### [NEW] `app/components/noise-demo.tsx`

Show why constellation fingerprints survive noise:

- Take a small set of peaks from the actual recognition result (`explanation.peaks`, first ~50)
- Let the user "add noise" with a slider — this randomly adds extra peak dots
- Show that the **original peaks** (and their pairings) mostly survive because they are the strongest
- A fingerprint match counter shows how many hashes still match as noise increases
- Caption: "Noise adds peaks, but the loudest original peaks remain, so their fingerprints still match"

Uses existing peak data from the explanation response + client-side random noise generation.

---

### D. "Why This Song Won" Verdict Panel

> **Data source:** All from existing `RecognitionExplanationResponse`. This is a new UI component that synthesizes multiple fields into a cohesive narrative.

---

#### D1. Verdict Summary Component

##### [NEW] `app/components/verdict-summary.tsx`

A prominent panel shown immediately after the matched song result (before the seven-stage walkthrough), giving a plain-language summary of why this specific song was identified:

- **Opening sentence:** Generated from `decision.reason`:
  - `"accepted"` → "Apollo identified **{song}** with high confidence."
  - `"below_threshold"` → "Apollo detected a possible match but couldn't confirm it."
  - `"ambiguous"` → "Two songs scored similarly — Apollo couldn't pick a winner."
- **Evidence summary:** "Found **{matchingHashes}** matching fingerprint patterns out of **{lookupFingerprints}** checked. **{leadingVotes}** fingerprints agreed that this clip starts at **{timestamp}** in the song."
- **Why not another song:** "The closest competitor received only **{runnerUpVotes}** votes (Apollo requires **{minimumWinnerRatio}×** margin)." — shows a visual comparison bar
- **Edit detection:** If `speedFactor ≠ 1` or `pitchFactor ≠ 1`, explain: "The recording was playing at **{speed}×** speed. Apollo tested **78 playback adjustments** to find this match."
- **Confidence meter:** A horizontal gauge from 0–100% using `recognition.confidence`

All data fields referenced above already exist in the API response.

---

### E. Visual Design & Responsiveness

---

#### E1. Typography & Micro-Animations

##### [MODIFY] [`globals.css`](file:///D:/Apollo/frontend/app/globals.css)

- Add `font-feature-settings: "cv02", "cv03", "cv04"` to Inter for refined number rendering
- Use `tabular-nums` on all numeric displays (already partially done — extend globally)
- Add subtle `backdrop-filter: blur(12px)` to the card for glassmorphism depth
- Button hover: add a subtle glow `box-shadow: 0 0 20px rgba(165, 225, 223, 0.15)` on the Listen button
- Step buttons: add a subtle scale + glow transition on active state
- Loading states: replace "Recognizing and explaining…" with a shimmer skeleton placeholder

---

#### E2. Responsive Layout Improvements

##### [MODIFY] [`globals.css`](file:///D:/Apollo/frontend/app/globals.css)

- **Tablet (768–1040px):** The `.story-body` grid already collapses to single column. Ensure charts don't overflow and step buttons remain scrollable.
- **Mobile (< 640px):** 
  - Stack the source picker vertically
  - Make the verdict panel full-width
  - Collapse the 7-step nav into a dropdown select
  - Charts should have a minimum height of 250px to remain readable
  - Touch: add `touch-action: pan-y` on chart containers to prevent accidental zoom

---

#### E3. Progressive Disclosure

##### [MODIFY] [`recognition-explanation.tsx`](file:///D:/Apollo/frontend/app/recognition-explanation.tsx)

- Default the walkthrough to collapsed state with a "See how Apollo found this song →" button
- When expanded, show the step nav and chart area
- The verdict summary (D1) is always visible; the detailed walkthrough is opt-in
- This reduces cognitive overload for casual users while preserving depth for academic review

---

### F. Project Structure & Code Quality

---

#### F1. Component Directory

##### [NEW] `app/components/` directory

Move all visualization components into a dedicated directory:

| Current | Proposed |
|---|---|
| `app/live-waveform.tsx` | `app/components/live-waveform.tsx` |
| `app/spectrogram-canvas.tsx` | `app/components/spectrogram-canvas.tsx` |
| `app/constellation-plot.tsx` | `app/components/constellation-plot.tsx` |
| `app/fingerprint-alignment.tsx` | `app/components/fingerprint-alignment.tsx` |
| `app/vote-histogram.tsx` | `app/components/vote-histogram.tsx` |
| `app/recognition-explanation.tsx` | `app/components/recognition-explanation.tsx` |

Update all imports in `page.tsx` and `recognition-explanation.tsx`. This is a mechanical refactor.

---

#### F2. Accessibility Audit

##### [MODIFY] All components

- Ensure all interactive chart elements have `role="img"` with descriptive `aria-label` (most already do)
- Add `aria-live="polite"` to the check timeline updates
- Ensure focus management: when the walkthrough opens, focus moves to the first step
- Keyboard navigation: arrow keys to switch steps, space to play/pause
- Ensure color contrast meets WCAG AA on the new dark-themed charts
- Verify `prefers-reduced-motion` disables all new animations

---

#### F3. Performance Guardrails

- Lazy-load simulation components (C1–C5) with `React.lazy()` + `Suspense`
- Memoize heavy chart renders with `React.memo` and stable prop references
- Throttle `requestAnimationFrame` loops to 30 fps on low-power devices (check `navigator.deviceMemory` or `navigator.hardwareConcurrency`)
- Canvas charts: reuse `ImageData` buffers when only the cursor position changes (avoid full repaint)

---

## Feature / Data Source Summary

| Feature | Uses Existing Backend Data | Needs New Backend Data | Pure Client-Side |
|---|---|---|---|
| A1. Live Spectrum Bar | | | ✓ (Web Audio AnalyserNode) |
| A2. Check Timeline | ✓ (expand CheckEvent) | | |
| A3. Confidence Ring | ✓ (check responses) | | |
| A4. Post-Match Hero Card | ✓ (RecognitionResponse + explanation) | | |
| B1. Dark-Themed Charts | ✓ (same data, new colors) | | |
| B2. Interactive Crosshair | ✓ (same data) | | |
| B3. Spectrogram + Peaks Overlay | ✓ (spectrogram + peaks) | | |
| B4. Fingerprint Pair Animation | ✓ (pairExamples) | | |
| B5. Catalog Lookup Animation | ✓ (counts) | | |
| B6. Alignment Dual Waveform | ✓ (waveformEnvelope + sourceInterval) | | |
| B7. Decision Verdict | ✓ (decision + candidateVotes) | | |
| B8. Step Transitions | ✓ (same data) | | |
| C1. Spectrogram Playground | | | ✓ (Web Audio + JS FFT) |
| C2. Peak Simulator | ✓ (signalConfig defaults) | | ✓ (synthetic grid) |
| C3. Hash Explainer | ✓ (pairExamples) | | ✓ (UI only) |
| C4. Vote Simulator | ✓ (decision params) | | ✓ (interactive demo) |
| C5. Noise Robustness Demo | ✓ (peaks) | | ✓ (client-side noise) |
| D1. Verdict Summary | ✓ (all decision fields) | | |
| E1–E3. Visual Polish | | | ✓ (CSS/layout) |
| F1–F3. Structure | | | ✓ (refactor) |

**Zero features require backend changes.** Every new capability either reuses existing API response fields or runs entirely in the browser.

---

## Verification Plan

### Automated Tests

```bash
# From frontend/
npm run lint
npm run typecheck
npm run build
```

### Manual Verification

- Record a song via microphone and browser tab — verify the full flow including new live spectrum, check timeline, and hero card
- Walk through all 7 stages — verify dark theme charts render correctly, crosshair works, transitions are smooth
- Test each simulation (C1–C5) independently
- Verify `prefers-reduced-motion` disables all animations
- Test on mobile viewport (375px) and tablet (768px)
- Test with a "no match" result to ensure verdict panel handles rejection cases
- Test with a speed/pitch-edited recording to verify edit detection UI
