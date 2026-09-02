# Apollo

Apollo is a university signal-processing project for recognizing songs from short audio clips. The first milestone proves the fingerprinting algorithm in Python; FastAPI, Supabase, and the Next.js interface wrap that reusable signal core afterward.

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the staged roadmap,
[SIGNAL_PROCESSING_GUIDE.md](SIGNAL_PROCESSING_GUIDE.md) for the Stage 1 theory and implementation,
and [CONSTRAINTS.md](CONSTRAINTS.md) for the project-wide quality rules.

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

## Stage 1 signal demo

Place at least two full songs in `demo-data/` and your short query clips in `demo-clip/`.
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
- The Supabase project and database schema do not exist yet; they are created in Stage 3.
- Put demonstration songs and excerpts under `demo-data/`. Audio there is ignored so copyrighted music cannot be committed accidentally.

## Git workflow

Work on short-lived `feature/*`, `fix/*`, or `chore/*` branches. Open a pull request into `main`, let CI pass on Windows and macOS, and have the other developer review it. Do not commit generated output, secrets, dependency folders, or local environments.
