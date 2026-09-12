# Apollo

Apollo is a university signal-processing project for recognizing songs from short audio clips. The
reusable Python fingerprinting core is wrapped by FastAPI, Supabase persistence, and a Next.js
microphone interface.

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the staged roadmap,
[SIGNAL_PROCESSING_GUIDE.md](SIGNAL_PROCESSING_GUIDE.md) for the Stage 1 theory and implementation,
and [CONSTRAINTS.md](CONSTRAINTS.md) for the project-wide quality rules.

## Project status

The signal core, FastAPI/Supabase integration, catalog CLI, and explainable microphone frontend
are wired together. The `Current state` section in [AGENTS.md](AGENTS.md) is the authoritative
progress marker.

## Required versions

- Python 3.13.11
- Node.js 22.19.0
- npm 11.8.0

Do not upgrade dependencies directly on `main`. Both ecosystems use committed exact versions, and updates should arrive through reviewed pull requests.

## Backend setup

Windows PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

macOS zsh:

```bash
cd backend
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Backend checks:

```bash
python -m ruff check app tests
python -m mypy app
python -m pytest
python -m pip_audit --local
```

The virtual environment is local and must never be committed.

Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `backend/.env`, then start the API from `backend/`:

```powershell
uvicorn app.main:app --reload
```

When the backend starts, it loads the song metadata and fingerprint catalog into an in-memory
cache and prints a progress bar plus the cached fingerprint total. Recognition checks this local
snapshot instead of querying Supabase for each recording. Restart the backend after adding songs
through the CLI, API, or Supabase so the cache refreshes.

Fingerprint a downloaded song without storing its audio:

```powershell
python -m app.catalog "..\..\Songs\song.wav" --name "Song title" --spotify-url "https://open.spotify.com/track/..."
```

The example assumes a sibling layout: `Apollo/` and `Songs/` are next to each other. You can also
pass a filename from that sibling folder; the catalog command resolves it without storing an
absolute machine-specific path.

The frontend proxies `/backend/*` to `BACKEND_URL` (default `http://127.0.0.1:8000`).

The API keeps `POST /recognize` as the compact recognition contract and adds
`POST /recognize/explain` for the dashboard. The explain endpoint returns the same recognition
fields plus bounded waveform, spectrogram, peak, fingerprint-alignment, offset-vote, and pipeline
count data. Explanation data is temporary; no audio or raw fingerprint hashes are persisted or
returned. The browser also provides a live waveform, coarse input level, stoppable countdown, and
local playback of the captured WAV.

## Stage 1 signal demo

Place at least two full songs in `demo-data/` and your short query clips in `demo-clip/`.
To create a clip from a full song, run this from `backend/`:

```bash
python -m app.create_clip "Cold.wav" 60 8
```

This extracts 8 seconds starting at 60 seconds and writes `clip_1.wav` to `demo-clip/`.
Later clips become `clip_2.wav`, `clip_3.wav`, and so on.

Then run the demo from `backend/`, passing only the clip filename:

```bash
python -m app.demo "your-clip.wav"
```

The command fingerprints the catalog in memory, identifies which full song contains the clip,
prints its source timestamp, and saves the signal-pipeline and time-offset-vote plots under
`artifacts/stage1/`. Local audio and generated output are ignored by Git.

## Frontend setup

```bash
cd frontend
npm ci
npm run dev
```

Open <http://localhost:3000>. Frontend checks are:

```bash
npm run lint
npm run typecheck
npm run build
npm audit --audit-level=high
```

## Local data and secrets

- Copy environment examples to their untracked local equivalents when those integrations are implemented.
- The schema is applied from `supabase/migrations/20260911000000_initial_schema.sql` and stores
  song name, Spotify URL, and acoustic fingerprints only.
- Put demonstration songs and excerpts under `demo-data/`. Audio there is ignored so copyrighted music cannot be committed accidentally.

## Git workflow

Work on short-lived `feature/*`, `fix/*`, or `chore/*` branches. Open a pull request into `main`, let CI pass on Windows and macOS, and have the other developer review it. Do not commit generated output, secrets, dependency folders, or local environments.

## Graphify setup

Graphify data is local and ignored by Git. After installing Graphify, initialize each clone and
enable automatic code-index refreshes:

```bash
graphify extract . --code-only
graphify hook install
```

The hooks refresh code changes after commits and checkouts. `AGENTS.md`, not the local graph, remains
the source of truth for the current project stage.
