# Apollo Current Implementation and Work Plan

## Objective

Apollo identifies the original recording behind a short microphone clip and estimates the source
timestamp. The main academic value is the visible signal-processing chain, not production-scale
infrastructure.

```text
audio → mono/resample → STFT/spectrogram → spectral peaks
      → deterministic fingerprints → cached hash matching
      → time-offset voting → accepted match or no match
```

## Implemented system

### Catalog ingestion

- `python -m app.catalog` and `POST /songs` accept WAV, MP3, FLAC, or OGG source audio.
- The same preprocessing and fingerprint configuration is used for catalog songs and queries.
- Supabase stores song ID, name, Spotify URL, fingerprint version, hash, and anchor frame.
- Audio is processed temporarily and is never stored by Apollo.
- Fingerprints are inserted in batches; a failed insert removes the partially created song row.

### Startup catalog cache

- FastAPI lifespan startup loads all songs and current-version fingerprints from Supabase.
- Reads are deterministic and paginated; Rich prints fingerprint progress and final totals.
- The cache is two in-memory mappings: song ID to metadata and song ID to fingerprints.
- Recognition performs no Supabase catalog reads after startup.
- Cache-load failure prevents backend startup. Catalog changes require a backend restart.
- The cache belongs to one backend process; multiple workers each load their own copy.

### Recognition and explanation

- `POST /recognize` returns the compact recognition contract.
- `POST /recognize/explain` returns that same recognition object plus bounded waveform,
  spectrogram, spectral-peak, matched-fingerprint, source-interval, and offset-vote data.
- Matching uses equal fingerprint hashes and votes on
  `catalog_anchor_frame - query_anchor_frame`.
- A winner must pass the absolute vote, query-support, and runner-up separation thresholds.
- Missing/weak/ambiguous evidence returns a normal no-match response.

### Browser interface

- Next.js records up to ten seconds of mono PCM audio with an `AudioWorklet`.
- The page shows recording state, level/waveform feedback, playback, recognition, and explanation.
- Browser requests go through `/backend/*`; frontend code never receives Supabase credentials.

### Verification and security

- Backend coverage includes signal processing, cache pagination/grouping, catalog ingestion,
  recognition evidence, upload validation, lifespan loading, and API response contracts.
- Frontend lint, strict TypeScript, and production build checks are configured.
- GitHub CI runs backend and frontend checks on Windows and macOS and audits dependencies.
- Supabase tables use row-level security; only the backend service role receives table access.

## Current interfaces

| Interface | Current behavior |
|---|---|
| `GET /health` | Backend process health |
| `POST /songs` | Store metadata and generated fingerprints |
| `POST /recognize` | Compact match/no-match result |
| `POST /recognize/explain` | Match/no-match result with bounded evidence |
| `python -m app.catalog` | Add one local source file to Supabase |

Public response shapes, the database schema, and fingerprint-producing configuration are stable
boundaries. Change them only with explicit review.

## Remaining work

- Build a legal evaluation catalog and record accuracy for 3/5/10-second clips, gain changes,
  noise, unrelated audio, and supported formats.
- Calibrate acceptance thresholds from those measurements instead of guessing.
- Verify microphone behavior and dependency installation on the presentation machines.
- Prepare the final explanation around the spectrogram, constellation peaks, fingerprints, and
  time-offset vote evidence already returned by the application.

Authentication, deployment, hum/cover recognition, background workers, and distributed caching are
not part of the current scope.
