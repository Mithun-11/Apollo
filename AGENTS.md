# Apollo agent guide

## Speed comes first

The answer is the product. Nothing may make it arrive later, including visuals, explanations and
replay data. The demo runs on one laptop: the backend, this page and the song playing in another
browser window all share its CPU and GPU. Anything heavy slows the live checks and stalls the video.

- **Show the answer on the first confirmed live check.** The title card appears while the page is
  still processing; `/recognize/explain` fills in afterwards. Never make the answer wait for
  explanation, evidence or animation data.
- **Heavy work runs only on request.** `/recognize/evidence`, decoding the recording and building
  the three.js replay start when someone opens the replay, never automatically after the answer.
  Do not add prefetching that runs while the song may still be playing.
- **Keep the recording path light.** The painted sky holds still while listening, and the live sky
  draws at no more than 30 fps. Don't add per-frame work, extra requests or large React re-renders
  during recording.
- **Keep the existing speed-ups** (see `PROGRESS.md`):
  - early answer at 10 s;
  - `liveChecksFailed` skips the repeated edit search;
  - no queueing behind live checks, and requests run in the thread pool;
  - one merged database lookup in the speed search;
  - SQLite `mmap_size`/`cache_size` pragmas;
  - Demucs preload;
  - live `/recognize` skips the melody step.
- **Time budgets:** measured 2026-09-25 with the 1920×1080 headless fake-mic harness and 25–27
  songs. Time is from pressing Listen to the song being shown.

  | Clip | Budget |
  |------|--------|
  | Normal clip (Heat Waves) | about 3.4 s |
  | F1 edit, 0.89× | about 9.6 s |
  | Cover | early answer at 10 s when the melody gap is at least 1.2; otherwise 15 s plus about 4 s |
  | Song not in the catalog | 15 s plus about 4 s |

- **Measure before and after.** Do this for any change to the recording or answer flow, to live
  checks, or to the backend recognition path. Run the same clips in a production build
  (`npm run build`, then `npm start`), since dev mode is slower. Report time-to-answer against these
  budgets. A regression is a bug, and design work is no excuse for one.
- **Catalog size costs time.** Every added song makes edit checks and melody matching slower, so
  say so when adding songs.

## Start every task

1. Inspect the relevant code, tests, and one comparable pattern before editing.
2. Treat `PROJECT_PLAN.md` and `CONSTRAINTS.md` as the current scope and quality floor.
   Read `PROGRESS.md` before touching recognition, matching, or the microphone flow; it records
   the current algorithm, its measurements, rejected ideas, and open items. Keep it updated.
3. State assumptions that affect behavior, API shape, signal parameters, schema, or scope.
4. Make the smallest complete change and run the relevant checks.
5. Report changes, verification, and limitations. Do not commit or push unless asked.

## Current state

Apollo has a deterministic signal core, local SQLite catalog, FastAPI routes, catalog CLI, and
Next.js microphone/explainability UI. Existing remote fingerprints are intentionally not migrated;
the catalog is regenerated into `data/apollo-v3.db` and shared outside Git.

```text
audio → mono/resample → STFT/spectrogram → peak detection
      → constellation map → deterministic fingerprints
      → SQLite hash lookup → time-offset voting → match
```

The API starts only when the configured database exists. Audio is processed temporarily and is
never stored.

## Architecture boundaries

```text
UI → frontend/lib/api.ts → Next.js /backend/* proxy
   → FastAPI routes → signal services → SQLite adapter
```

- Signal services accept ordinary Python/NumPy values and never import FastAPI or database code.
- Database conversion and connection behavior live in `backend/app/database.py`.
- Plotting/explanation code calls signal services; signal services do not call it.
- Matching consumes fingerprint records as data and remains independent of persistence.
- Routes validate HTTP input and delegate; DSP and SQL do not belong in route handlers.
- React never reads SQLite or hard-codes the FastAPI URL.

## Signal rules

- Keep signal parameters centralized in `SignalConfig` and preserve `fingerprint_version`.
- Never compare fingerprints with different versions.
- Never use Python's randomized `hash()` for stored hashes.
- Do not change the fingerprint algorithm or calibrated thresholds without approval and regenerated
  catalog data.
- Keep frames, samples, seconds, and hertz explicit.

## SQLite rules

- Use only Python's standard-library `sqlite3`; no ORM or database server.
- The schema is `data/schema.sql`; generated `data/*.db` files stay out of Git.
- Enable foreign keys on every connection. Keep WAL and `synchronous=NORMAL` unless measurements
  justify a change.
- Convert hashes only through the centralized lossless helpers.
- Insert a song and its fingerprints in one transaction with `executemany()`.
- Query hashes in bounded batches through `(fingerprint_version, hash_value)`; never load the full
  catalog during normal startup.
- Normal startup must report a missing database rather than silently create one.

## Coding rules

- Python public functions use type hints; keep functions focused and deterministic.
- TypeScript stays strict: no `any`, `@ts-ignore`, or lint suppression to force a pass.
- Validate uploads at FastAPI boundaries and preserve accessible loading/error/empty UI states.
- Do not add or upgrade dependencies as a side effect.
- Do not commit secrets, copyrighted audio, generated databases, caches, or local environments.

## Required verification

Backend from `backend/`:

```text
python -m ruff check app tests
python -m mypy app
python -m pytest
```

Frontend from `frontend/`:

```text
npm run lint
npm run typecheck
npm run build
```

For dependency changes also run `python -m pip check`, `python -m pip_audit --local`, `npm ci`, and
`npm audit --audit-level=high` for the affected ecosystem. Never skip/delete tests or weaken checks
to get green.

## Git

Use short-lived `feature/*`, `fix/*`, or `chore/*` branches. Do not discard another developer's
uncommitted work, force-push shared branches, or commit/push unless explicitly asked.

If `graphify-out/graph.json` exists, use graphify queries for codebase navigation and run
`graphify update .` after code changes.
