# Apollo Recognition Explainability Implementation Plan

## 1. Purpose

This document is an implementation specification for adding an educational recognition dashboard
to Apollo. It is intentionally explicit so that an implementation agent can complete the work in
small, verifiable steps without redesigning the project.

The feature should explain how a ten-second microphone recording becomes a song and timestamp
result:

```text
recorded query
-> normalized waveform
-> STFT spectrogram
-> spectral peaks / constellation
-> deterministic fingerprints
-> matching database hashes
-> time-offset votes
-> winning song and source interval
```

The finished page should show the query signal, the fingerprints that contributed to the match,
the winning time-offset vote, and a short plain-language explanation. All diagnostic data is
temporary and must be discarded after the HTTP response and browser session.

## 2. Required scope

Implement the following features:

1. A live waveform, volume indication, and countdown while the existing ten-second recording is
   being captured. This is display-only; recognition still starts after recording finishes.
2. Local playback of the captured recording from the browser `Blob`.
3. A downsampled query waveform after recording.
4. A downsampled query spectrogram.
5. A constellation view containing the query's detected spectral peaks.
6. Highlighting for query peaks and fingerprints that contributed to the winning match.
7. A fingerprint-alignment view with a query timeline and a source-song timeline.
8. A time-offset vote histogram with the winning offset and match threshold highlighted.
9. A decision summary containing the number of peaks, generated fingerprints, matching hashes,
   winning aligned votes, confidence, timestamp, and matched source interval.
10. A useful no-match explanation that still shows the query analysis.
11. Optional, after the required scope is stable: a compact top-three candidate comparison and
    per-stage processing times.

## 3. Explicit non-goals

Do not implement any of the following as part of this work:

- recognition while audio is still being recorded;
- streaming uploads, WebSockets, server-sent events, progress polling, or background jobs;
- storage of query audio, generated images, or explanation data;
- storage or display of the complete catalog-song waveform;
- storage or display of the complete catalog-song spectrogram or constellation map;
- a database schema or migration change;
- Supabase Storage;
- hum recognition, pitch tracking, or dynamic time warping;
- authentication, deployment, or public network exposure;
- a browser catalog-management screen;
- a charting or visualization dependency;
- changes to fingerprint calibration or `fingerprint_version`;
- a full visualization for every candidate song;
- PDF/report export in the first implementation;
- advanced zooming, synchronized cursors, or elaborate animation before the static views work.

The source-song side of the alignment view will show only the fingerprints that matched the query.
The existing database does not contain enough data to reconstruct the full source waveform,
spectrogram, or unmatched source peaks.

## 4. Approval gate before implementation

This plan proposes a new additive HTTP endpoint. `AGENTS.md` requires approval before API endpoint
or response-shape changes. Before writing implementation code, confirm the endpoint name and
response contract with the project owner and update `PROJECT_PLAN.md` to record the approved
contract.

The recommended endpoint is:

```text
POST /recognize/explain
```

Do not change the current `POST /recognize` response. It must continue to serve the existing stable
contract. The frontend may switch to the new endpoint after the new endpoint is tested.

No database approval is needed if this plan is followed because no migration or persisted field is
required.

## 5. Existing implementation that must be reused

Read these files before editing:

- `backend/app/services/signal.py`: signal configuration, audio loading, peak extraction,
  fingerprint creation, and offset voting;
- `backend/app/catalog.py`: Supabase ingestion and recognition orchestration;
- `backend/app/main.py`: upload validation, temporary files, and API routes;
- `backend/tests/test_signal.py`: comparable signal tests;
- `frontend/app/page.tsx`: current microphone capture and page state;
- `frontend/lib/api.ts`: the only allowed frontend backend-call adapter;
- `frontend/app/globals.css`: current visual system;
- `supabase/migrations/20260911000000_initial_schema.sql`: existing data available during a match.

Preserve this dependency direction:

```text
UI -> frontend/lib/api.ts -> Next.js /backend/* proxy
   -> FastAPI route -> recognition/explanation orchestration
   -> signal services + Supabase adapter
```

Do not put FFT, peak extraction, hashing, or matching logic in FastAPI or React. Do not make React
call Supabase directly. Do not make the pure signal service generate plots as a required side
effect.

## 6. Why matched fingerprint visualization needs no schema change

Each persisted fingerprint already contains:

```text
song_id
fingerprint_version
hash_value
catalog anchor_frame
```

While processing the query, retain a transient trace for each generated fingerprint:

```text
hash_value
query anchor_frame
query target_frame
anchor frequency_bin
target frequency_bin
delta_frames
```

For a query fingerprint and catalog fingerprint with the same hash:

```text
candidate offset_frame = catalog anchor_frame - query anchor_frame
```

If `candidate offset_frame` equals the winning offset, that fingerprint contributed to the winning
alignment. Because the hash payload contains the anchor frequency, target frequency, and frame
delta, the query trace provides enough frequency information to draw that matched fingerprint on
both timelines. The catalog row supplies its source-song position.

The complete catalog constellation cannot be reconstructed because unmatched frequency data was
not persisted. Do not attempt to reverse the BLAKE2b hash.

## 7. Recommended API contract

The new endpoint accepts the same multipart field as `POST /recognize`:

```text
audio: WAV, MP3, FLAC, or OGG upload
```

Use camelCase in the JSON response because the existing frontend API contract uses camelCase.

### 7.1 Shared recognition fields

The nested `recognition` object should have exactly the same logical fields and nullability as the
current response:

```json
{
  "matched": true,
  "song": {
    "id": "uuid",
    "name": "Example Song",
    "spotifyUrl": "https://open.spotify.com/track/..."
  },
  "timestampSeconds": 83.4,
  "confidence": 0.72,
  "matchCount": 68
}
```

### 7.2 Complete explanation response shape

Use this shape unless the project owner approves a documented revision:

```json
{
  "recognition": {
    "matched": true,
    "song": {
      "id": "uuid",
      "name": "Example Song",
      "spotifyUrl": "https://open.spotify.com/track/..."
    },
    "timestampSeconds": 83.4,
    "confidence": 0.72,
    "matchCount": 68
  },
  "explanation": {
    "queryDurationSeconds": 10.0,
    "sampleRate": 22050,
    "waveformEnvelope": [
      {"timeSeconds": 0.0, "minimum": -0.41, "maximum": 0.53}
    ],
    "spectrogram": {
      "valuesDb": [[-80, -73, -55], [-76, -44, -31]],
      "minimumDb": -80,
      "maximumDb": 0,
      "maximumFrequencyHz": 11025,
      "durationSeconds": 10.0
    },
    "peaks": [
      {
        "timeSeconds": 1.21,
        "frequencyHz": 441.4,
        "amplitudeDb": -8.3,
        "matched": true
      }
    ],
    "matchedFingerprints": [
      {
        "queryAnchorSeconds": 1.21,
        "queryTargetSeconds": 1.72,
        "sourceAnchorSeconds": 84.61,
        "sourceTargetSeconds": 85.12,
        "anchorFrequencyHz": 441.4,
        "targetFrequencyHz": 882.9
      }
    ],
    "offsetVotes": [
      {"offsetSeconds": 83.4, "count": 68, "winning": true}
    ],
    "sourceInterval": {
      "startSeconds": 83.4,
      "endSeconds": 93.4
    },
    "counts": {
      "peaks": 235,
      "fingerprints": 1720,
      "matchingHashes": 91,
      "winningVotes": 68
    },
    "matchThreshold": 5,
    "candidateVotes": [],
    "processingTimesMs": null
  }
}
```

For no-match results:

- `recognition.matched` is `false`;
- `recognition.song` and `recognition.timestampSeconds` are `null`;
- `sourceInterval` is `null`;
- `matchedFingerprints` is empty;
- query waveform, spectrogram, peaks, counts, and any non-winning offset votes remain available;
- the frontend explains whether there were no matching hashes or insufficient aligned votes.

Do not expose Supabase credentials, local paths, uploaded filenames, raw audio bytes, or exception
details. Raw fingerprint hashes are not necessary for the visualization and should not be returned.

## 8. Payload limits and deterministic selection

Explanation payloads must remain bounded. Use named constants in one explanation module:

```python
MAX_WAVEFORM_COLUMNS = 600
MAX_SPECTROGRAM_FREQUENCY_BINS = 128
MAX_SPECTROGRAM_TIME_BINS = 256
MAX_DISPLAY_PEAKS = 1_000
MAX_DISPLAY_MATCHES = 300
MAX_OFFSET_BARS = 200
SPECTROGRAM_MIN_DB = -80
```

These values are display limits, not signal-algorithm calibration. They do not change persisted
fingerprints or matching behavior.

Selection must be deterministic:

- choose the strongest peaks by descending `amplitude_db`, using time and frequency as tie-breakers;
- return selected peaks ordered by time and then frequency for rendering;
- choose matched fingerprints in query time order and then frequency order;
- if more matches exist than the display cap, sample evenly across the ordered match list rather
  than returning only the earliest part;
- preserve the winning vote even when reducing the number of histogram bars;
- never use Python's built-in `hash()`.

Convert NumPy arrays and NumPy scalar types to ordinary Python lists, `int`, and `float` before
returning JSON.

## 9. Backend design

### 9.1 Add a trace model without changing persisted fingerprints

In `backend/app/services/signal.py`, add a frozen, slotted dataclass similar to:

```python
@dataclass(frozen=True, slots=True)
class FingerprintTrace:
    fingerprint: Fingerprint
    anchor_frequency_bin: int
    target_frequency_bin: int
    target_frame: int
```

Add a function with an explicit typed result:

```python
def create_fingerprints_with_traces(
    peaks: Sequence[Peak],
    config: SignalConfig = DEFAULT_CONFIG,
) -> tuple[tuple[Fingerprint, ...], tuple[FingerprintTrace, ...]]:
    ...
```

Move the existing anchor-target loop into this function. Make the existing
`create_fingerprints()` return only the fingerprint portion of the new function. There must be one
implementation of fingerprint construction, not two slightly different loops.

The following invariant must hold:

```python
create_fingerprints(peaks, config) == (
    create_fingerprints_with_traces(peaks, config)[0]
)
```

Do not add trace fields to database rows and do not change fingerprint hashes.

### 9.2 Preserve query analysis once

Avoid decoding audio or calculating the STFT more than once. Add a typed internal analysis result,
either in `backend/app/catalog.py` or a small pure service module:

```python
@dataclass(frozen=True, slots=True)
class QueryAnalysis:
    samples: FloatArray
    sample_rate: int
    spectrogram_db: Float64Array
    peaks: tuple[Peak, ...]
    fingerprints: tuple[Fingerprint, ...]
    traces: tuple[FingerprintTrace, ...]
```

Add `analyze_query_file(path, config)` that calls, in order:

1. `load_audio`;
2. `extract_peaks`;
3. `create_fingerprints_with_traces`.

The current catalog-ingestion path does not require traces. It may continue to call
`fingerprint_file`, but shared fingerprint logic must remain single-source.

### 9.3 Retain the matching catalog rows

The current `recognize_file` builds an in-memory catalog from Supabase rows and then discards it.
The explanation path needs that catalog long enough to derive matched pairs.

Refactor internal orchestration so both recognition paths can reuse:

```python
def fetch_matching_catalog(
    query: Sequence[Fingerprint],
    client: Client,
    config: SignalConfig,
) -> dict[str, list[Fingerprint]]:
    ...
```

This function must preserve the existing behavior:

- query only hashes present in the query;
- filter by `fingerprint_version`;
- use the existing batch size;
- return ordinary fingerprint records grouped by song ID;
- make no schema changes.

Then:

- `recognize_file` continues returning the current response;
- a new `recognize_file_with_explanation` uses the same query analysis, catalog, and
  `match_fingerprints` result to build the richer response.

Do not make the existing route call Supabase twice.

### 9.4 Derive winning matched fingerprints

For a successful match, a trace contributes to the displayed winning alignment when a catalog
fingerprint satisfies both conditions:

```text
catalog.hash_value == trace.fingerprint.hash_value
catalog.anchor_frame - trace.fingerprint.anchor_frame == result.offset_frame
```

For every selected display match, calculate:

```python
query_anchor_seconds = query_anchor_frame * hop_length / sample_rate
query_target_seconds = query_target_frame * hop_length / sample_rate
source_anchor_seconds = catalog_anchor_frame * hop_length / sample_rate
source_target_seconds = source_anchor_seconds + delta_frames * hop_length / sample_rate
anchor_frequency_hz = anchor_frequency_bin * sample_rate / n_fft
target_frequency_hz = target_frequency_bin * sample_rate / n_fft
```

The source interval is:

```python
start_seconds = result.timestamp_seconds
end_seconds = result.timestamp_seconds + query_duration_seconds
```

Do not silently round these values in the backend. Round only for display in React.

Multiple catalog records may match one query fingerprint. Count every vote exactly as the existing
matcher does, but deduplicate identical visualization lines before applying the display cap.

### 9.5 Build waveform display data

The waveform view must not return all audio samples. Divide the sample array into at most
`MAX_WAVEFORM_COLUMNS` consecutive regions. For each region return:

```text
region midpoint time
minimum amplitude
maximum amplitude
```

Handle clips shorter than the maximum column count without producing empty regions. Preserve the
first and last portions of the clip. Returned amplitudes should remain within the normalized
`[-1, 1]` range.

### 9.6 Build spectrogram display data

Do not return the full `float64` spectrogram. Create evenly spaced frequency and time indices up to
the configured display limits and select those cells. Clip values to
`[SPECTROGRAM_MIN_DB, 0]`, round to integer decibels, and convert the matrix to nested Python lists.

Return the original physical extents separately:

- duration in seconds;
- maximum frequency in hertz;
- minimum and maximum displayed decibels.

The frontend can map matrix coordinates to those extents. Display downsampling must not feed back
into peak detection or fingerprint creation.

### 9.7 Build peak display data

Select at most `MAX_DISPLAY_PEAKS`. Each point contains:

```text
timeSeconds
frequencyHz
amplitudeDb
matched
```

A peak is matched when it appears as an anchor or target in a displayed winning fingerprint. This
field describes the displayed winning evidence; it does not mean the peak was absent from other
fingerprints.

### 9.8 Build vote histogram data

The current `MatchResult.offset_votes` includes votes for the winning song. Convert frames to
seconds and mark the winning offset. If there are more than `MAX_OFFSET_BARS`, retain:

- the winning offset;
- the strongest remaining offsets;
- deterministic ordering by offset for rendering.

The histogram must show the configured `match_threshold`. It must not recalculate or modify the
winner.

For no-match output, it is acceptable for the first implementation to return an empty histogram
because `match_fingerprints` currently returns `None` without diagnostics. Do not rewrite the
matcher solely to produce rejected votes in the first slice. Rejected-vote diagnostics may be a
later enhancement.

### 9.9 Optional top-candidate comparison

Do this only after the required single-winner explanation is stable.

For each song, its candidate score is the largest vote count for any one offset, not the total of
all scattered votes. Return at most three candidates sorted by:

1. descending best aligned vote count;
2. song name or ID as a deterministic tie-breaker.

Fetching names for the top candidates may use one batched query to the existing `songs` table. Do
not issue one query per song.

### 9.10 Optional processing times

Use `time.perf_counter()` around orchestration boundaries only:

- decode/normalize;
- STFT and peak extraction;
- fingerprint creation;
- database lookup;
- offset voting;
- total.

Timings are explanatory diagnostics, not benchmark assertions. Do not place timing calls inside
the pure numeric loops and do not log uploaded data.

### 9.11 Add the API route

In `backend/app/main.py`, add the approved endpoint using the existing upload helper and error
envelope. The route must:

1. initialize `path` to `None`;
2. save and validate the upload;
3. call `recognize_file_with_explanation`;
4. translate expected invalid-audio errors to the approved error envelope;
5. delete the temporary file in `finally`.

As part of this work, make `_save_upload` delete its own partially written temporary file if it
raises before returning the path. This prevents oversized or failed uploads from being orphaned.
Do not expose exception text for unexpected internal or Supabase failures.

## 10. Frontend types and API adapter

All response types and the new call belong in `frontend/lib/api.ts`. Do not declare duplicate API
types inside components and do not use `any`.

Add types corresponding exactly to the approved response:

```typescript
export type WaveformEnvelopePoint = {
  timeSeconds: number;
  minimum: number;
  maximum: number;
};

export type SpectrogramDisplay = {
  valuesDb: number[][];
  minimumDb: number;
  maximumDb: number;
  maximumFrequencyHz: number;
  durationSeconds: number;
};

export type PeakDisplay = {
  timeSeconds: number;
  frequencyHz: number;
  amplitudeDb: number;
  matched: boolean;
};

export type MatchedFingerprintDisplay = {
  queryAnchorSeconds: number;
  queryTargetSeconds: number;
  sourceAnchorSeconds: number;
  sourceTargetSeconds: number;
  anchorFrequencyHz: number;
  targetFrequencyHz: number;
};

export type OffsetVoteDisplay = {
  offsetSeconds: number;
  count: number;
  winning: boolean;
};
```

Add `RecognitionExplanationResponse` and:

```typescript
export async function recognizeAudioWithExplanation(
  audio: Blob,
): Promise<RecognitionExplanationResponse> {
  // POST multipart audio to /backend/recognize/explain
}
```

Keep `recognizeAudio` unless the project owner explicitly removes the original feature. Use the
same defensive error-message extraction as the existing function.

## 11. Frontend component plan

The current page is small, but the new dashboard justifies focused local components. Create only
components that are immediately used. Suggested files under `frontend/app/` are:

```text
frontend/app/page.tsx
frontend/app/live-waveform.tsx
frontend/app/spectrogram-canvas.tsx
frontend/app/constellation-plot.tsx
frontend/app/fingerprint-alignment.tsx
frontend/app/vote-histogram.tsx
frontend/app/recognition-explanation.tsx
```

Do not create a generic design system or chart framework.

### 11.1 Page state machine

Use an explicit union rather than several booleans that can contradict each other:

```typescript
type RecognitionState =
  | { phase: "ready" }
  | { phase: "requesting-permission" }
  | { phase: "recording"; secondsRemaining: number }
  | { phase: "processing" }
  | { phase: "complete"; response: RecognitionExplanationResponse }
  | { phase: "error"; message: string };
```

The page must reset the previous response when a new recording begins. Every exit path must stop
media tracks, disconnect audio nodes, close the `AudioContext`, cancel animation frames/timers, and
revoke object URLs.

### 11.2 Live waveform and volume indicator

The live waveform is a browser visualization only. Continue collecting the same audio chunks for
the WAV encoder. In the AudioWorklet message handler:

- append the chunk to the existing recording buffer;
- place the newest chunk in a `useRef` for drawing;
- calculate a lightweight RMS level for the volume indicator;
- do not call React `setState` for every audio block.

Use `requestAnimationFrame` in `LiveWaveform` to draw the most recent samples onto a `<canvas>`.
Use React state at a lower frequency only for countdown text and coarse volume status. The canvas
needs an accessible text description such as "Live microphone waveform".

### 11.3 Countdown and controls

While recording, show:

- seconds remaining;
- a clear recording status;
- a Stop button that allows a shorter recording;
- a Cancel button only if it can be implemented with reliable cleanup.

Do not permit two simultaneous recordings. Disable the start button until cleanup finishes.

### 11.4 Local playback

After encoding the WAV `Blob`, create a browser object URL and render an `<audio controls>` element.
The object URL is local and must be revoked when replaced or when the component unmounts. Do not
send the URL to the backend and do not persist it.

### 11.5 Spectrogram canvas

Render the `valuesDb` matrix on a `<canvas>`:

1. map `minimumDb` to the darkest color;
2. map `maximumDb` to the brightest color;
3. draw time left-to-right;
4. draw low frequency at the bottom and high frequency at the top;
5. label the time axis in seconds and frequency axis in hertz/kilohertz.

Use a small fixed color interpolation function rather than a dependency. Keep enough contrast for
peak overlays. Include a nearby textual statement of duration and maximum frequency.

### 11.6 Constellation overlay

Use SVG over or immediately below the spectrogram. Map each peak using:

```text
x = timeSeconds / durationSeconds
y = 1 - frequencyHz / maximumFrequencyHz
```

Use muted points for ordinary peaks and a high-contrast accent for matched peaks. Do not render a
DOM element for an unbounded number of points; the backend cap must be enforced.

### 11.7 Fingerprint alignment view

Render two horizontal SVG timelines:

```text
Query:  0 seconds ---------------- query duration
                         |  |  |
                         |  |  | matched fingerprints
                         |  |  |
Song:   source start ------------ source end
```

Each displayed fingerprint may be represented by its anchor marker and a thin line to the
corresponding source anchor. Keep unmatched source content blank because it is unknown. Label the
source axis with absolute song timestamps and the query axis relative to zero.

If 300 lines are visually noisy, reduce opacity and emphasize a smaller representative subset on
hover. Static readability is more important than animation.

### 11.8 Vote histogram

Use SVG bars. The x-axis is candidate source offset in seconds and the y-axis is aligned vote
count. Include:

- an accent color for the winning bar;
- a horizontal or annotated threshold marker for `matchThreshold`;
- text for winning offset and vote count;
- a textual fallback list containing the strongest few offsets.

Do not infer confidence from bar height in React. Display the confidence returned by the backend.

### 11.9 Decision summary

For a successful result, show:

```text
Apollo generated {fingerprints} query fingerprints.
{matchingHashes} hashes also existed in the catalog.
{winningVotes} fingerprints agreed on an offset of {timestamp}.
The recording aligns with {sourceStart}–{sourceEnd} in {songName}.
```

For no match, choose a truthful message based on available counts:

- zero fingerprints: the recording did not contain enough usable spectral structure;
- zero matching hashes: none of the query fingerprints occurred in the catalog;
- matching hashes but no accepted result: matches did not align strongly enough at one timestamp.

Never promise that `confidence` is a statistical probability. Label it "match confidence" or
"aligned fingerprint ratio" and explain it briefly.

## 12. Visual layout

Keep the current dark visual language but allow the page to become wider than the current
460-pixel card. A practical desktop layout is:

```text
+----------------------------------------------------------+
| Apollo / recording controls / status                     |
+----------------------------------------------------------+
| Match summary                                             |
+----------------------------+-----------------------------+
| Query spectrogram          | Pipeline counts             |
| + constellation overlay    | and explanation             |
+----------------------------+-----------------------------+
| Fingerprint alignment                                    |
+----------------------------------------------------------+
| Time-offset vote histogram                               |
+----------------------------------------------------------+
```

On small screens, stack every panel vertically. Use semantic headings, visible focus styles,
`aria-live` for status changes, and text summaries for canvas/SVG information.

Recommended colors:

- neutral gray for ordinary data;
- blue/cyan for detected query features;
- green or gold for winning matched evidence;
- red only for an error or clipping warning.

Do not rely on color alone; matched points should also be larger or have a distinct outline.

## 13. Backend tests

Add the smallest focused tests under `backend/tests/`.

### 13.1 Signal trace tests

Test that:

- fingerprints produced with traces exactly equal `create_fingerprints` output;
- every trace references its corresponding fingerprint;
- trace ordering is deterministic;
- fingerprint hashes remain unchanged for the existing test peaks;
- fingerprint versions remain enforced.

### 13.2 Display transformation tests

Test that:

- waveform output never exceeds the configured column cap;
- waveform times are ordered and amplitudes remain normalized;
- spectrogram dimensions never exceed both caps;
- spectrogram values are ordinary integers within the configured dB range;
- peak selection is deterministic and bounded;
- matched-point selection is deterministic and bounded.

### 13.3 Alignment tests

Create a small synthetic query and shifted catalog. Assert that:

- the recognized song is unchanged;
- the original `timestamp_seconds` is unchanged;
- every returned source anchor minus query anchor equals the winning offset within floating-point
  tolerance;
- target times use the same delta as their query fingerprints;
- `sourceInterval.endSeconds - sourceInterval.startSeconds` equals query duration;
- no raw hashes are present in the serialized explanation.

### 13.4 No-match tests

Test at least:

- no query fingerprints;
- query hashes absent from the catalog;
- hashes exist but no offset reaches `match_threshold`.

The explanation response must remain structurally valid in each case.

### 13.5 API tests

Use FastAPI `TestClient` with the recognition function and Supabase access patched or replaced by a
small fake. Do not require the shared development database.

Test:

- successful `/recognize/explain` response shape;
- no-match response shape;
- unsupported extension;
- invalid audio;
- oversized upload and partial temporary-file cleanup;
- missing multipart field using the project's approved error envelope;
- the existing `/recognize` contract remains unchanged;
- `/health` still returns `{"status": "ok"}`.

## 14. Frontend verification

There is no direct frontend test framework in the current package. Do not add one as a side effect
of this feature. First rely on strict TypeScript, ESLint, production build, and a documented manual
checklist. A browser automation dependency can be proposed later in a dedicated approved change.

Manual checks:

1. Deny microphone permission and verify a useful error.
2. Record a successful ten-second sample.
3. Confirm the countdown changes once per second.
4. Confirm the live waveform moves without audible microphone feedback.
5. Confirm media tracks stop after recording.
6. Play the local recording.
7. Confirm every explanation panel renders for a successful match.
8. Confirm displayed source start equals the recognition timestamp.
9. Confirm source end equals start plus query duration.
10. Confirm the winning vote bar and threshold are visible.
11. Submit an unrelated or poor recording and verify the no-match explanation.
12. Start a second recording and verify the first result and object URL are cleaned up.
13. Resize to a narrow mobile viewport and verify panels stack without horizontal overflow.
14. Navigate with the keyboard and verify buttons, audio controls, and links remain accessible.

## 15. Implementation sequence

Implement in this order. Complete and verify each slice before beginning the next.

### Slice 0: Approve and document the contract

- Obtain approval for `POST /recognize/explain` and its response.
- Update `PROJECT_PLAN.md` with the additive contract and explainability scope.
- Do not describe it as implemented yet.

### Slice 1: Fingerprint traces

- Add `FingerprintTrace` and `create_fingerprints_with_traces`.
- Make `create_fingerprints` reuse it.
- Add deterministic trace tests.
- Run backend Ruff, mypy, and pytest.

### Slice 2: Explanation transformations

- Add bounded waveform, spectrogram, peak, matched-pair, and histogram builders.
- Keep them pure and independently testable.
- Add size, type, ordering, and alignment tests.
- Run backend checks.

### Slice 3: Shared recognition orchestration

- Extract query analysis and matching-catalog retrieval without changing behavior.
- Keep `recognize_file` response unchanged.
- Add `recognize_file_with_explanation`.
- Test successful and no-match results with a fake Supabase client or isolated data.
- Run backend checks.

### Slice 4: Explain endpoint

- Add `POST /recognize/explain`.
- Add API contract and upload rejection tests.
- Fix partial temporary-file cleanup.
- Re-run every backend check.

### Slice 5: Frontend data contract

- Add strict explanation types and `recognizeAudioWithExplanation` to `frontend/lib/api.ts`.
- Switch the page submission to the new call.
- Render the textual decision summary before adding charts.
- Run lint and typecheck.

### Slice 6: Static explanation views

- Add the spectrogram canvas.
- Add constellation points.
- Add fingerprint alignment.
- Add the offset vote histogram.
- Add textual fallbacks and responsive layout.
- Run lint, typecheck, and build.

### Slice 7: Recording experience

- Add live waveform and coarse volume indication.
- Add countdown and reliable stop handling.
- Add local playback with object-URL cleanup.
- Perform the manual microphone checklist.
- Run all frontend checks.

### Slice 8: Optional enhancements

- Add top-three candidate bars only if the required flow is stable.
- Add processing timings only if they improve the presentation.
- Add restrained animation only after static accessibility and responsiveness are correct.

### Slice 9: Final verification and documentation

- Run all required backend and frontend checks.
- Run the complete microphone flow against the development Supabase catalog.
- Verify on both Windows and macOS through CI.
- Update `README.md`, `PROJECT_PLAN.md`, and the `Current state` section of `AGENTS.md` only after
  the feature is actually working.
- Record known limitations: the source-song graph contains matched fingerprint evidence only, not
  a complete stored waveform or spectrogram.

## 16. Required commands

From `backend/` with `.venv` active:

```bash
python -m ruff check app tests
python -m mypy app
python -m pytest
```

From `frontend/`:

```bash
npm run lint
npm run typecheck
npm run build
```

Do not delete or skip failing tests, loosen existing thresholds, add lint/type suppressions, or
regenerate lockfiles to get green checks.

## 17. Acceptance criteria

The required scope is complete only when all of the following are true:

- the existing `/recognize` contract and behavior remain compatible;
- `/recognize/explain` returns a successful typed explanation for a known clip;
- no database migration or new table/column exists;
- no audio or explanation artifact is persisted;
- the query is decoded and transformed only once per explanation request;
- displayed fingerprints use the exact hashes and winning offset used by recognition;
- the source interval begins at the returned recognition timestamp;
- the query spectrogram and peak coordinates use explicit seconds and hertz;
- every explanation array is deterministically bounded;
- successful and no-match results both render without frontend exceptions;
- microphone resources, timers, animation frames, and object URLs are cleaned up;
- no secret, local path, raw audio, or raw fingerprint hash appears in the response;
- backend Ruff, mypy, and pytest pass;
- frontend lint, typecheck, and build pass;
- the final documentation states that only matched source fingerprints are visualized.

## 18. Common implementation mistakes to avoid

- Do not recompute fingerprints with a different configuration for display.
- Do not create a second fingerprint-pairing loop that can drift from the real algorithm.
- Do not use browser-side DSP as the authoritative recognition explanation.
- Do not return full NumPy arrays or NumPy scalars directly as JSON.
- Do not send the complete raw waveform in the response.
- Do not use fingerprint hashes as React keys unless duplicates are handled; the same hash can
  occur at multiple anchor frames.
- Do not treat all equal hashes as winning evidence; their frame difference must equal the winning
  offset.
- Do not describe confidence as a probability of correctness.
- Do not claim the source-song timeline is a complete waveform or constellation.
- Do not introduce direct Supabase access in the frontend.
- Do not put plotting or signal math in the API route.
- Do not add a migration merely to simplify a graph.
- Do not modify or inspect `backend/.env` while implementing this feature.
- Do not overwrite unrelated uncommitted changes or the unrelated root `package-lock.json`.

## 19. Supervisor demonstration sequence

Use the feature in this order during the demonstration:

1. Start recording and point out the live waveform and input level.
2. Play a known song sample and wait for the fixed recording period.
3. Show the normalized query waveform and spectrogram.
4. Reveal the sparse constellation peaks and explain why peaks are more robust than all pixels.
5. Highlight the fingerprint pairs whose hashes existed in the catalog.
6. Show those fingerprints aligned on the query and source timelines.
7. Show the vote histogram and explain that many fingerprints independently agree on one offset.
8. Reveal the song, confidence, and source interval.
9. If time permits, submit an unrelated sound and show why Apollo returns no match.

The intended message is: Apollo does not only return a title. It exposes the signal-processing
evidence that caused a specific song and timestamp to win.
