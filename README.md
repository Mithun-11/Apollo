# Apollo

Apollo recognizes songs from short microphone recordings and estimates the matching source
timestamp. Its explainable pipeline is:

```text
audio → mono/resample → STFT → spectral peaks → constellation fingerprints
      → indexed SQLite lookup → time-offset voting → match
```

## Requirements

- Python 3.13.11
- Node.js 22.19.0
- npm 11.8.0

## Backend

Create the environment from `backend/`, then initialize the local database from the same folder:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m app.database
```

SQLite is included with the supported Python installation, so no separate SQLite server or package
is needed. Initialization creates an empty local catalog; it cannot recover the former Supabase
fingerprints. Add locally licensed catalog audio with the command below, or obtain the shared
`data/apollo.db` snapshot from the team.

The default database is `data/apollo.db`. Set `APOLLO_DB_PATH` to use another snapshot. Normal API
startup fails clearly when the database is missing; it never creates an empty catalog implicitly.
Generated database files are ignored by Git and should be distributed separately.

Add a song without storing its audio:

```powershell
python -m app.catalog "C:\path\to\song.wav" --name "Song title" --spotify-url "https://open.spotify.com/track/..."
```

Start the API:

```powershell
uvicorn app.main:app --reload
```

Backend checks:

```powershell
python -m ruff check app tests
python -m mypy app
python -m pytest
python -m pip check
python -m pip_audit --local
```

## Frontend

From `frontend/`:

```powershell
npm ci
npm run dev
```

The frontend calls FastAPI only through the Next.js `/backend/*` proxy. `BACKEND_URL` defaults to
`http://127.0.0.1:8000`.

## Storage

`data/schema.sql` defines `songs` and `acoustic_fingerprints`. Fingerprint hashes remain 16-digit
hexadecimal strings in signal code and are mapped losslessly to signed 64-bit SQLite integers at
the database boundary. Recognition performs batched indexed lookups and preserves the existing
time-offset scoring behavior. Catalog audio and microphone uploads are never persisted.
