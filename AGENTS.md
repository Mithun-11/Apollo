# Apollo agent guide

This file is the persistent working context for coding agents in this repository.

## Start every task here

1. Read `Current state`, `PROJECT_PLAN.md`, and all of `CONSTRAINTS.md`.
2. Inspect the affected files, tests, and one comparable existing pattern.
3. State assumptions that affect behavior, API shapes, signal parameters, schema, or scope.
4. Make the smallest complete change and run the relevant checks.
5. Report changes, verification, and limitations. Do not commit or push unless requested.

The user's latest explicit instruction wins when code and documentation disagree. Update the
documentation whenever an architectural decision changes.

## Purpose and current flow

Apollo recognizes an original song recording from a short microphone clip and estimates its source
timestamp.

```text
browser microphone
→ frontend/lib/api.ts
→ Next.js /backend/* rewrite
→ FastAPI upload route
→ signal analysis
→ in-memory catalog matching
→ recognition + explanation
```

Catalog data follows a separate write/startup path:

```text
local song → catalog CLI or POST /songs → Supabase metadata/fingerprints
Supabase → FastAPI lifespan startup → per-process CatalogCache
```

## Current state

- The deterministic signal core, explanation builders, Supabase adapter/schema, catalog CLI,
  FastAPI routes, startup catalog cache, microphone frontend, tests, and CI are implemented.
- `SignalConfig` centralizes preprocessing, STFT, peak, fingerprint, version, and match settings.
- Matching rejects weak or ambiguous winners with absolute, normalized-support, and runner-up gates.
- FastAPI startup loads all song metadata and current-version fingerprints in deterministic pages,
  prints Rich progress/totals, and fails startup when loading fails.
- Recognition uses only the startup snapshot. Restart the backend after any catalog change.
- `POST /songs` stores metadata and fingerprints; source audio and query uploads remain temporary.
- `POST /recognize` returns the compact contract. `POST /recognize/explain` returns the same result
  plus bounded waveform, spectrogram, peak, fingerprint-alignment, interval, and vote evidence.
- The Next.js page records up to ten seconds, shows live feedback/playback, and calls
  `/backend/recognize/explain`.
- Accuracy calibration against a broader recorded catalog remains unfinished.

Never describe optional or remaining work as implemented.

## Fixed stack

- Python 3.13.11
- NumPy, SciPy, librosa, and soundfile for signal processing
- FastAPI, Uvicorn, supabase-py, and Rich for the backend
- Next.js 16.3.4, React 19.2.4, TypeScript 5.9.3, and Tailwind CSS 4.1.18
- Node.js 22.19.0 and npm 11.8.0
- pytest, Ruff, mypy, ESLint, and TypeScript for checks

Use Context7 or current official documentation for framework/library-specific work. Do not change
dependencies or runtime versions as a side effect.

## Repository map

```text
backend/app/                 FastAPI, catalog adapter, and signal/explanation services
backend/tests/               Backend and signal tests
backend/requirements.txt     Exact Python dependency lock
frontend/app/                Next.js microphone interface
frontend/lib/api.ts          Backend request and response boundary
frontend/package-lock.json   Exact npm dependency lock
supabase/migrations/         Immutable numbered schema migrations
.github/                     CI, Dependabot, and pull-request template
PROJECT_PLAN.md              Current implementation and remaining work
SIGNAL_PROCESSING_GUIDE.md   Algorithm and implementation explanation
CONSTRAINTS.md               Non-negotiable quality and safety floor
```

## Architecture boundaries

- Signal services accept ordinary Python/NumPy values and return typed results.
- Signal services must not import FastAPI or Supabase, access database state, print results, or
  generate plots as a required side effect.
- FastAPI routes validate HTTP input, manage temporary files, and call catalog/signal services.
- Matching consumes fingerprint records as data and must not know whether they came from memory or
  a database.
- `catalog.py` owns Supabase translation, ingestion, startup loading, and response assembly.
- React components never call Supabase or hard-code FastAPI URLs. Requests/types belong in
  `frontend/lib/api.ts`.
- Credentials remain backend-only; never expose them through `NEXT_PUBLIC_*` variables.

## Signal rules

- Normalize catalog songs and queries through the same path.
- Keep sample/frame/second/hertz units explicit.
- Persist an explicit fingerprint version and never compare incompatible versions.
- Use deterministic hashes; never persist Python's randomized `hash()` output.
- Changing fingerprint-producing settings requires a new version and regenerated catalog rows.
- Acceptance thresholds may be calibrated without changing stored hashes.
- Keep hardware/audio calibration values centralized and measure before optimizing.

## Cache rules

- Cache song metadata and current-version fingerprints in process memory during FastAPI startup.
- Recognition must not fall back to Supabase when the cache is missing or lacks a song.
- A missing cache is a server error; an absent/weak song match is a normal no-match result.
- Catalog writes do not mutate the live cache. Restart the backend to refresh it.
- Do not add disk caches, Redis, refresh endpoints, workers, or invalidation machinery without a
  measured need and approval.

## Coding conventions

- Python: type public functions, keep units visible, validate boundaries, and raise descriptive
  service exceptions for entry points to translate.
- TypeScript: keep strict typing; do not add `any`, `@ts-ignore`, or lint suppressions.
- UI: use semantic accessible controls and explicit loading, empty, success, and error states.
- Tests use synthetic signals or tiny legal fixtures. Never add copyrighted audio.

## Required verification

Backend, from `backend/`:

```bash
python -m ruff check app tests
python -m mypy app
python -m pytest
```

Frontend, from `frontend/`:

```bash
npm run lint
npm run typecheck
npm run build
```

For dependency changes, also run `python -m pip check`, `python -m pip_audit --local`, `npm ci`,
and `npm audit --audit-level=high`.

Do not skip/delete tests, loosen thresholds, add suppressions, or change behavior merely to make
checks pass.

## Always, ask first, never

Always:

- Preserve exact lockfiles and Windows/macOS compatibility.
- Keep generated output, caches, environments, credentials, and audio outside Git.
- Update current documentation when a public contract or architectural decision changes.
- Create a new numbered migration; never edit an applied migration.

Ask first:

- API endpoint or response-shape changes.
- Fingerprint algorithm/configuration changes after catalog data exists.
- Database schema, CI, runtime version, or dependency changes.
- Authentication, deployment, or public network exposure.

Never:

- Commit secrets, real `.env` files, Supabase keys, or copyrighted audio.
- Add ORM, Alembic, Docker, Redis, Celery, FFmpeg, direct PostgreSQL drivers, background workers,
  or another state layer without measured need and approval.
- Put DSP/database logic in UI adapters or FastAPI routes.
- Invent test results, benchmarks, features, or database state.

## Git collaboration

- Keep `main` working and use short-lived `feature/*`, `fix/*`, or `chore/*` branches.
- Use atomic commits with `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, or `chore:` prefixes.
- Preserve other developers' uncommitted work and never force-push shared branches.
- Do not merge or push unless the user explicitly requests it.

## Graphify

When `graphify-out/graph.json` exists, query it first for codebase questions. Use `graphify path` for
relationships and `graphify explain` for focused concepts. Dirty ignored graph output is expected.
After modifying code, run `graphify update .` so the local graph stays current.
