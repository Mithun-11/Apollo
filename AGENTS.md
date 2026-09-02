# Apollo agent guide

This file is the persistent onboarding context for coding agents working in this repository. Keep it accurate and concise. Add subsystem-specific `AGENTS.md` files only if the frontend and backend eventually need genuinely different rules.

## Start every task here

1. Read the relevant section of `PROJECT_PLAN.md` and all of `CONSTRAINTS.md`.
2. Inspect the files involved, their tests, and one existing comparable pattern before editing.
3. State any assumption that would affect behavior, API shape, signal parameters, schema, or scope.
4. Make the smallest complete change and run the relevant checks below.
5. Report what changed, what was verified, and any known limitation. Do not commit or push unless explicitly asked.

If the plan, code, and user request disagree, stop and name the conflict. The user's latest explicit instruction wins; update the documentation before implementing a changed architectural decision.

## Project purpose and priority

Apollo is a university signal-processing project that recognizes songs from short audio clips and estimates the matching timestamp.

The learning/demo priority is the explainable signal pipeline:

```text
audio → mono/resample → STFT/spectrogram → peak detection
      → constellation map → deterministic fingerprints
      → hash lookup → time-offset voting → match
```

Correct, visible signal processing matters more than production infrastructure or UI polish. Build in the staged order in `PROJECT_PLAN.md`; do not jump to later stages because they look easier.

## Current state

- Stage 0 scaffolding and the Stage 1 Python teacher demo are complete.
- The repository has pinned Python and npm environments, CI, dependency smoke coverage,
  and synthetic signal/demo tests.
- The reusable signal service loads and normalizes audio, extracts spectral peaks, creates
  deterministic fingerprints, and matches songs by time-offset voting.
- The local demo fingerprints ignored catalog audio, reads a user-supplied clip from
  `demo-clip/`, and saves the waveform, spectrogram, peak, constellation, and vote visualizations.
- The Next.js frontend is only the generated empty page.
- No FastAPI routes, Supabase project, database schema, migration, storage bucket, or
  frontend API client exists yet.
- The next implementation milestone is the Stage 2 reliable signal core.

Never describe a planned file, endpoint, table, or feature as already implemented.

## Stack and fixed toolchain

- Python 3.13.11
- NumPy, SciPy, librosa, soundfile, and Matplotlib for signal work
- FastAPI, Uvicorn, and supabase-py for later backend integration
- Next.js 16.3.4, React 19.2.4, TypeScript 5.9.3, and Tailwind CSS 4.1.18
- Node.js 22.19.0 and npm 11.8.0
- pytest, Ruff, and mypy for backend checks; ESLint and TypeScript for frontend checks

Use Context7 or current official documentation before relying on framework/library-specific syntax. Do not upgrade, add, or replace a dependency as a side effect of feature work.

## Repository map

```text
backend/
  app/                  Python application package
    services/           Pure signal-processing services
  tests/                Backend and signal tests
  requirements.txt      Exact Python dependency lock
  pyproject.toml         pytest, Ruff, and mypy configuration

frontend/
  app/                   Next.js App Router UI
  package.json           Frontend scripts and direct dependencies
  package-lock.json      Exact npm dependency lock

demo-data/               Local ignored songs/query clips; README is tracked
.github/                 CI, Dependabot, and pull-request template
PROJECT_PLAN.md          Approved staged roadmap and planned contracts
CONSTRAINTS.md           Non-negotiable quality and safety floor
README.md                Human setup and collaboration instructions
```

Create new directories only when the current task produces a real file for them. Do not scaffold empty abstractions for future stages.

## Architecture boundaries

Preserve this dependency direction:

```text
UI → frontend/lib/api.ts → Next.js /backend/* proxy
   → FastAPI routes → signal services → Supabase adapter
```

- Signal services accept ordinary Python values, NumPy arrays, paths, or file-like inputs and return typed Python results.
- Signal services must not import FastAPI or Supabase, read CLI input, access global mutable state, print instead of returning results, generate plots as a required side effect, or rely on hard-coded local paths.
- Plotting/demo code calls signal services; signal services do not call plotting/demo code.
- Matching consumes fingerprint records as data and must not care whether they came from an in-memory collection or Supabase.
- FastAPI routes validate/translate HTTP input and call services. Never place FFT, peak detection, hashing, or matching logic in a route.
- React components never access Supabase or hard-code FastAPI URLs. All backend requests and response types belong in `frontend/lib/api.ts` once it exists.
- Keep Supabase service-role credentials backend-only. No secret may use a `NEXT_PUBLIC_` variable.

## Signal-processing rules

- Centralize sample rate, FFT/window size, hop length, peak neighborhood, anchor fan-out, time-delta limits, and match threshold in one configuration object/module when Stage 1 introduces them.
- Give every fingerprint configuration an explicit version. Persisted/query fingerprints with different versions must never be compared.
- Fingerprints must be deterministic across processes and machines. Never use Python's randomized built-in `hash()` for stored hashes.
- Keep time units explicit in names and types: frames, samples, seconds, and hertz are not interchangeable.
- Normalize catalog songs and queries through the same preprocessing path.
- Prefer clear NumPy/SciPy operations over custom frameworks or speculative optimization. Measure before optimizing.
- Hardware/audio behavior needs calibration knobs; do not hide important signal constants throughout the code.

## Coding conventions

### Python

- Use type hints for public functions and small typed result models where multiple values would otherwise be ambiguous.
- Use `snake_case` for files/functions/variables and `PascalCase` for classes.
- Keep functions focused and deterministic where practical; validate at file/API boundaries rather than repeatedly inside trusted helpers.
- Raise descriptive exceptions from services; entry points translate them into CLI messages or API errors.
- Tests live under `backend/tests/` and should use synthetic signals or tiny legal fixtures.

### TypeScript and React

- Keep TypeScript strict; do not add `any`, `@ts-ignore`, or lint suppressions to get green checks.
- Use accessible semantic HTML and explicit loading, empty, and error states.
- Keep components small and local until reuse is proven; do not create a component framework for the first screen.
- Browser microphone and file input are untrusted boundaries. Validate again in FastAPI.

## Required verification

Run only the checks relevant to changed areas, then run the complete affected group before handoff.

Backend, from `backend/` with `.venv` active:

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

For dependency or lockfile changes, also run:

```bash
python -m pip check
python -m pip_audit --local
npm ci
npm audit --audit-level=high
```

Do not skip/delete tests, loosen thresholds, add suppressions, or change expected behavior merely to make checks pass.

## Always, ask first, never

Always:

- Preserve exact dependency lockfiles and cross-platform Windows/macOS compatibility.
- Add the smallest runnable test for non-trivial signal or matching logic.
- Keep generated plots, caches, local environments, and audio outside Git.
- Update the plan/README/API documentation when a public contract or setup command changes.

Ask first:

- API endpoint or response-shape changes.
- Fingerprint algorithm/configuration changes after data has been generated.
- Database schema/migration, CI, runtime version, or dependency changes.
- Adding authentication, deployment, or public network exposure.

Never:

- Commit secrets, real `.env` files, Supabase keys, or copyrighted audio.
- Edit an applied migration; create the next numbered migration.
- Add ORM, Alembic, Docker, Redis, Celery, FFmpeg, direct PostgreSQL drivers, background workers, or another state-management layer without a measured need and approval.
- Let frontend code call Supabase directly or put database/DSP logic in UI/API adapters.
- Invent completed features, tests, benchmark results, or database state.

## Git collaboration

- Keep `main` working and use short-lived `feature/*`, `fix/*`, or `chore/*` branches.
- Keep commits atomic and use `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, or `chore:` prefixes.
- Do not mix dependency upgrades, formatting sweeps, refactors, and behavior changes in one pull request.
- Do not overwrite or discard another developer's uncommitted work.
- Never force-push shared branches.
