# Apollo frontend

This Next.js application records up to ten seconds from the microphone, encodes the captured mono
PCM samples as WAV, and sends them to `POST /backend/recognize/explain`.

The page shows recording state, live level/waveform feedback, local playback, the recognition
result, and bounded signal/matching evidence returned by FastAPI. It does not connect to Supabase.

## Run locally

Start FastAPI on port 8000, then run from `frontend/`:

```powershell
npm ci
Copy-Item .env.local.example .env.local
npm run dev
```

Open <http://localhost:3000> and allow microphone access. `BACKEND_URL` controls the server used by
the Next.js `/backend/*` rewrite and defaults to `http://127.0.0.1:8000`.

## Checks

```powershell
npm run lint
npm run typecheck
npm run build
npm audit --audit-level=high
```

Keep request functions and response types in `frontend/lib/api.ts`. Never add Supabase credentials
or direct database calls to browser code.
