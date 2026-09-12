# Apollo

Apollo is a university signal-processing project that recognizes a song from a short microphone
recording and estimates where the recording occurs in the source track.

```text
microphone audio → mono/resample → STFT → spectral peaks → fingerprints
                 → cached catalog lookup → time-offset voting → match + explanation
```

The backend uses FastAPI, Supabase, NumPy, SciPy, and librosa. The browser interface uses Next.js
and records a mono WAV clip locally before sending it to the backend.

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the current implementation and remaining work,
[SIGNAL_PROCESSING_GUIDE.md](SIGNAL_PROCESSING_GUIDE.md) for the algorithm, and
[CONSTRAINTS.md](CONSTRAINTS.md) for the quality rules.

## Required versions

- Python 3.13.11
- Node.js 22.19.0
- npm 11.8.0

## Backend

Create the environment from `backend/`.

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

macOS zsh:

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `backend/.env`, apply
`supabase/migrations/20260911000000_initial_schema.sql` to the Supabase project, then start the API:

```powershell
python -m uvicorn app.main:app --reload --port 8000
```

Startup loads all song metadata and current-version fingerprints from Supabase into process memory.
The backend terminal shows a Rich progress bar and the final song/fingerprint totals. Startup fails
if the catalog cannot be loaded, and requests are not served until loading finishes.

Recognition reads only this in-memory snapshot. Restart the backend after adding, changing, or
deleting catalog rows. Each backend worker has its own cache.

## Add a song

Source audio stays outside Git and is never persisted by Apollo. The CLI accepts an absolute path,
a path relative to the repository, or a filename from a sibling `Songs/` directory:

```powershell
python -m app.catalog "..\..\Songs\song.wav" --name "Song title" --spotify-url "https://open.spotify.com/track/..."
```

`POST /songs` provides the same ingestion path over HTTP. Both paths store only song metadata and
versioned fingerprints in Supabase. Restart the backend afterward to refresh recognition data.

## Frontend

From `frontend/`:

```powershell
npm ci
Copy-Item .env.local.example .env.local
npm run dev
```

Open <http://localhost:3000> and allow microphone access. The page records for up to ten seconds,
shows live level/waveform feedback and local playback, then calls
`POST /backend/recognize/explain`. The Next.js rewrite forwards `/backend/*` to `BACKEND_URL`, which
defaults to `http://127.0.0.1:8000`.

## API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Returns `{"status":"ok"}` |
| `POST /songs` | Fingerprints an uploaded song and stores metadata/fingerprints |
| `POST /recognize` | Returns match, song, timestamp, confidence, and match count |
| `POST /recognize/explain` | Returns recognition plus bounded visualization/evidence data |

Uploads must be WAV, MP3, FLAC, or OGG and no larger than 50 MB. Temporary upload files are deleted
after processing. The frontend never connects to Supabase directly.

## Checks

Backend, from `backend/`:

```powershell
python -m ruff check app tests
python -m mypy app
python -m pytest
python -m pip_audit --local
```

Frontend, from `frontend/`:

```powershell
npm run lint
npm run typecheck
npm run build
npm audit --audit-level=high
```

## Git workflow

Use short-lived `feature/*`, `fix/*`, or `chore/*` branches. Do not commit real environment files,
credentials, copyrighted audio, generated output, dependency folders, or local environments.
