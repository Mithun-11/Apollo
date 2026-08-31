# Apollo Project Plan

## 1. Goal and priorities

Apollo is a 3–4 week university signal-processing project. The main objective is to demonstrate and explain the signal pipeline:

```text
audio
→ mono/resampling
→ STFT/spectrogram
→ spectral peak detection
→ constellation map
→ deterministic fingerprints
→ hash matching
→ time-offset voting
→ song and timestamp result
```

The first progress demonstration is due in 1–2 days. It will prove the signal-processing idea using Python only. FastAPI, Supabase, and the web interface will be added around the same reusable functions afterward.

Core recognition is required. Advanced interactive plots and hum search are stretch goals.

## 2. Capability and build order

| Capability | Depends on | Target |
|---|---|---|
| Python signal demonstration | Nothing | Teacher progress demo |
| Tested fingerprinting and matching core | Signal demonstration | Core |
| Song catalog and Supabase persistence | Matching core | Core |
| FastAPI contract | Catalog and matching | Core |
| Upload/microphone web interface | FastAPI | MVP |
| Advanced plots | Stable MVP | Stretch |
| Hum search using pitch tracking and DTW | Stable MVP | Stretch |

Build in this order so failures can be localized to the signal algorithm, database, API, or browser instead of debugging every layer at once.

## 3. Project and GitHub foundation

The actual repository root will be `Apollo/`. This plan remains outside that folder as a reference document.

- Create one private GitHub repository and add both developers as collaborators.
- Protect `main`: use short-lived branches and pull requests, require one review from the other developer, resolved comments, and passing CI. Do not force-push to `main`.
- Use focused commits such as `feat:`, `fix:`, `test:`, `docs:`, and `chore:`.
- Track each stage or independently reviewable slice with a GitHub Issue and link its pull request.
- Tag working milestones as `v0.1.0` for the teacher demo, `v0.2.0` for the integrated core, and `v1.0.0` for the final submission.
- Commit a short project specification, constraints, and agent instructions. Agents must not change API response shapes or move signal/database logic between layers without review.

The standing architecture is:

```text
UI
→ frontend/lib/api.ts
→ Next.js /backend/* proxy
→ FastAPI routes
→ reusable signal services
→ Supabase adapter
```

## 4. Reproducible Windows and macOS setup

A Python virtual environment is required on every development computer.

- Pin Python `3.13.11`, Node `22.19.0`, and npm `11.8.0` for both developers and CI.
- Each developer creates `backend/.venv` locally. Never commit the virtual environment.
- Commit one exact-pinned `backend/requirements.txt`, including test and development tools. Generate it from a clean environment and add platform markers only if Windows and macOS need different packages.
- Commit `.python-version` and document PowerShell and zsh creation/activation commands.
- Commit the frontend `package-lock.json`, `.nvmrc`, Node `engines`, and npm `packageManager` declarations.
- Use `npm ci` for existing checkouts and CI. Do not use an unreviewed `npm update` or regenerate the lockfile casually.
- Ignore `.venv`, `node_modules`, build output, generated demo plots, temporary uploads, local audio, and every real `.env` file. Commit only placeholder `.env.example` files.

New package releases cannot change the project by themselves: npm installs the committed lockfile and Python installs exact versions. Configure weekly Dependabot pull requests for npm, pip, and GitHub Actions, but never auto-merge them. Upgrade only after review and successful Windows/macOS checks.

## 5. Staged implementation

### Stage 0 — Repository setup (first half-day)

- Initialize Git/GitHub, ignore rules, runtime pins, Python virtual environment, dependency locks, README, and minimal CI.
- Define central signal parameters: sample rate, FFT/window size, hop length, peak neighborhood, anchor fan-out, time-delta limits, match threshold, and `fingerprintVersion`.
- Prepare 2–3 local songs and clean query excerpts outside Git. Commit only synthetic or public-domain test fixtures.

Acceptance: a fresh clone installs from the committed versions on Windows and macOS and can run the initial test command.

### Stage 1 — Python teacher demo (days 1–2)

Implement reusable signal functions first:

- `loadAudio` — decode, convert to mono, resample, and normalize consistently.
- `extractPeaks` — compute STFT/spectrogram and select local spectral peaks.
- `createFingerprints` — create stable anchor-target hashes; never use Python's randomized built-in `hash()`.
- `matchFingerprints` — count aligned time offsets and return a typed match result.

A small demo entry point will call these functions. It may use an in-memory dictionary for fingerprints, but the signal functions must not contain CLI prompts, hard-coded paths, FastAPI objects, React concerns, or Supabase calls.

The demo will:

1. Load 2–3 songs.
2. Display or save the waveform, spectrogram, spectral peaks, and constellation map.
3. Fingerprint the songs in memory.
4. Match a clean 5–10 second excerpt.
5. Print the predicted song and estimated timestamp.
6. Display the time-offset vote histogram that explains why the match won.

Acceptance: the excerpt matches its source song and the estimated timestamp is within approximately one second. Tag the working commit as `v0.1.0`.

### Stage 2 — Reliable signal core (days 3–7)

- Turn the prototype into deterministic, independently testable Python services without changing the core function boundaries.
- Support WAV, MP3, FLAC, and OGG through the pinned `soundfile`/librosa stack and verify each format on Windows and macOS.
- Keep all calibration parameters together and attach `fingerprintVersion` to generated fingerprints so incompatible configurations cannot be mixed.
- Add no-match behavior and a normalized confidence score based on aligned fingerprint votes.
- Create a 10–25 song evaluation catalog.
- Require correct matching for clean excerpts. Measure 3/5/10-second clips, amplitude changes, and several noise levels; record the first results as a regression baseline instead of inventing an accuracy target beforehand.

Acceptance: every clean evaluation excerpt matches correctly, unrelated audio produces no match, and repeated runs generate identical hashes and results.

### Stage 3 — Create Supabase and FastAPI (days 8–12)

No Supabase project, tables, bucket, or schema currently exists. This stage creates them from scratch; none are required for the teacher demo.

Database work:

- Create one shared non-production Supabase project and a private audio bucket.
- Commit the first numbered SQL migration before applying it.
- Create `songs` with ID, title, artist, storage path, duration, fingerprint version, and timestamps.
- Create `fingerprints` with fingerprint version, hash, song ID, and frame offset.
- Add cascade deletion, duplicate protection, and an index on `(fingerprint_version, hash)`.
- Insert and query fingerprints in configurable batches rather than one row/request per fingerprint.
- Keep query clips temporary; do not save them to Storage.
- Never edit an applied migration. One designated developer applies each merged migration to the shared project and records that it was applied.

FastAPI work:

- Keep Supabase credentials only in the backend. The service-role key must never appear in frontend variables, logs, commits, or API responses.
- Routes validate input and call the existing signal services. They must not contain FFT, peak detection, or matching logic.
- Use `UploadFile` for audio and enforce supported formats, a documented file-size/duration limit, successful decoding, and safe storage paths.

Stable API contract:

- `GET /health` → `{ "status": "ok" }`
- `POST /songs` with audio, title, and artist → song metadata and `fingerprintCount`
- `GET /songs` → catalog items
- `DELETE /songs/{id}` → `204`
- `POST /recognize` with multipart audio → `matched`, nullable `song`, nullable `timestampSeconds`, `confidence`, and `matchCount`
- Every error → `{ "error": { "code", "message" } }`

Acceptance: FastAPI tests prove that the HTTP routes return the same recognition result as the Python demo and that song ingestion persists/retrieves fingerprints correctly.

### Stage 4 — Web MVP (days 13–17)

- Create a Next.js/TypeScript frontend with one recognition screen and one basic catalog-management screen.
- Put every backend call and corresponding TypeScript response type in `frontend/lib/api.ts`.
- Proxy `/backend/*` through Next.js, with the FastAPI destination supplied by a server-side environment variable.
- Implement file upload first, followed by microphone permission, recording, stopping, preview, and direct WAV submission.
- Show waveform, processing state, errors, matched song, confidence, and timestamp.
- Keep React components free of signal processing, Supabase access, and hard-coded FastAPI URLs.

Acceptance: on Windows and macOS, a user can add a song, upload or record a query, receive a match, and delete a song through the browser.

### Stage 5 — Evaluation and presentation (days 18–21)

- Run the complete evaluation catalog and record recognition success, timestamp error, processing time, and known failure cases.
- Test noisy and short samples without silently weakening the recorded baseline.
- Verify setup from a fresh clone on Windows and macOS.
- Prepare the final demonstration and a concise explanation of sampling, STFT, peak selection, fingerprint construction, hashing, and offset voting.
- Use remaining time for advanced spectrogram, constellation, and matching-point views.

Do not start hum search until this stage is complete. Hum search is a separate pitch-sequence/DTW algorithm, not an extension of spectral fingerprint matching.

## 6. Why FastAPI and the web frontend will not require a rewrite

The Python-only start is deliberate. FastAPI is an input/output adapter, while the signal functions are the actual application core.

```text
Teacher demo: local file → signal services → result/plots
FastAPI later: uploaded file → same signal services → JSON
Web later: browser file → FastAPI → same signal services → JSON → UI
```

Integration should take a few focused days, not a major redesign, provided Stage 1 obeys these rules:

- Signal functions accept ordinary Python data/file-like inputs and return typed Python results.
- No function reads global CLI state, prints instead of returning results, or relies on hard-coded files.
- Plot generation is optional and separate from matching.
- Matching accepts fingerprint rows as data; it does not know whether they came from memory or Supabase.
- FastAPI and Supabase imports are introduced only in their adapter modules.

If the initial demo mixes all work into one notebook cell or script with global variables, integration will require extraction and cleanup. The plan avoids that by using reusable functions from the first day.

## 7. Verification and quality gates

- Local handoff checks should remain near 90 seconds; the full audio corpus runs in GitHub CI.
- Block merges on frontend lint/typecheck/tests/build, backend lint/typecheck/tests, secret scanning, and Windows/macOS installation checks.
- Dependency audits may report without blocking during the first two weeks. Before `v1.0.0`, fix or explicitly document every high/critical finding.
- Measure initial coverage and prevent it from falling; do not select an arbitrary coverage percentage before code exists.
- Test pure DSP with synthetic signals and tiny legal fixtures.
- Test correct song, offset, no-match, short clips, gain changes, noise, and repeatability.
- Test WAV/MP3/FLAC/OGG decoding on both operating systems.
- Test FastAPI contracts and upload rejection with `TestClient`.
- Keep Supabase integration tests isolated from the main development catalog.
- Add one browser flow covering add song → recognize → display result.

## 8. Assumptions and deferred work

- Apollo is greenfield and `Apollo/` is currently empty.
- The database and schema will be created in Stage 3.
- The project is a supervised university demonstration, not a public production service.
- Authentication is intentionally omitted. If management endpoints become publicly reachable, authentication becomes a required new stage.
- One shared development Supabase project is sufficient for two developers.
- Do not commit copyrighted catalog audio; keep it in private Supabase Storage or ignored local folders.
- Deferred until a demonstrated need: ORM, Alembic, Docker, Redis, Celery, FFmpeg, direct PostgreSQL drivers, background workers, production deployment, and hum search.

