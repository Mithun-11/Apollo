# Apollo frontend

This Next.js app is the browser recognition screen. It records ten seconds from the microphone,
encodes a mono WAV clip, and sends it to the FastAPI `/recognize` route through the `/backend/*`
rewrite.

## Run locally

Start the backend first from `backend/`:

```powershell
cd ..\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Then run the frontend:

```powershell
npm ci
Copy-Item .env.local.example .env.local
npm run dev
```

Open <http://localhost:3000>, click **Listen**, and allow microphone access. `BACKEND_URL` in
`.env.local` defaults to `http://localhost:8000`.

## Checks

```powershell
npm run lint
npm run typecheck
npm run build
```

The frontend does not access Supabase directly and must never contain the backend service key.
