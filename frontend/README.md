# Apollo frontend

The Next.js interface records a short microphone clip, sends it through the server-side
`/backend/*` proxy, and renders the recognition result and bounded signal explanation.

```powershell
npm ci
npm run dev
```

Set `BACKEND_URL` only when FastAPI is not available at `http://127.0.0.1:8000`. Browser code must
not access SQLite or contain database paths.

For playback at the recognized timestamp, create a Web API app at
https://developer.spotify.com/dashboard and register the redirect URI
`http://127.0.0.1:3000/api/spotify`. Copy `.env.local.example` to `.env.local`, set
`SPOTIFY_CLIENT_ID` to the app's Client ID, and restart Next.js. No client secret is needed.
Open Apollo at `http://127.0.0.1:3000` (Spotify does not accept `localhost` redirect URIs).
For HTTPS deployments, set `SPOTIFY_REDIRECT_URI` to that origin plus `/api/spotify` and
register that exact URI in the dashboard. Add any other test accounts in the app's User Management.

Click **Play on Spotify at …** after recognition and authorize Spotify in the popup once.
The connected account must have Premium, and Spotify must have an active playback device:
if prompted, open Spotify and play any song, then click Apollo's button again.
Playback starts the catalog's Spotify track at the detected source timestamp, so the catalog
must link to the same recording. Authorization uses PKCE and HttpOnly cookies; tokens are
refreshed only on a playback click. No Spotify requests run during recognition.

Checks:

```powershell
npm run lint
npm run typecheck
npm run build
node --test --test-isolation=none tests/spotify.test.mjs
npm audit --audit-level=high
```
