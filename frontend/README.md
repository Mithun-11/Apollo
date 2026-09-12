# Apollo frontend

The Next.js interface records a short microphone clip, sends it through the server-side
`/backend/*` proxy, and renders the recognition result and bounded signal explanation.

```powershell
npm ci
npm run dev
```

Set `BACKEND_URL` only when FastAPI is not available at `http://127.0.0.1:8000`. Browser code must
not access SQLite or contain database paths.

Checks:

```powershell
npm run lint
npm run typecheck
npm run build
npm audit --audit-level=high
```
