# Apollo

Apollo is a song recognition app, like a small Shazam. You play a song near the microphone, and
Apollo tells you which song it is and where in the song you are. It can also handle clips that are
sped up or slowed down (like F1 edits), and covers sung by someone else.

It also shows how it found the answer. After a result you can open a 3D replay that walks through
each step using the real data from your recording.

## How it works

```text
audio → mono/resample → STFT → spectral peaks → constellation fingerprints
      → indexed SQLite lookup → time-offset voting → match
```

1. The recording is turned into a spectrogram (which pitches are loud at which moment).
2. Only the strongest points are kept. We call them stars.
3. Pairs of stars become fingerprints: two pitches and the time between them.
4. The fingerprints are looked up in the song database.
5. Most hits are random. The real song is the one where many hits agree on the same moment in the
   song.

If the clip is sped up, Apollo tries different speeds until the fingerprints line up. If it is a
cover, it separates the voice from the music, follows the melody and compares its shape against
every song in all 12 keys.

## The simulation (3D replay)

Once Apollo gives an answer, the result card has two buttons:

- **Watch how it was found** plays a short version that moves by itself.
- **Class mode** goes through every step and waits for you, so you can explain each one.

The replay is a 3D scene of a lake at night. Nothing in it is made up. The sound's spectrogram
becomes the sky and then a mountain range, the peaks become stars on the mountain tops, the
fingerprints are lines between stars, and the songs in the database form a galaxy above the
clouds. The camera flies through it in order: sound, spectrum, stars, fingerprints, catalog,
alignment (or speed search / voice for edits and covers), listen, and the answer.

Controls: arrow keys to move between steps, Space to replay a step, N to add noise on the Stars
step (the stars barely move, which is why fingerprints survive noise), M to mute, Esc to leave.

It is built with three.js (WebGL) and our own GLSL shaders, plus the `postprocessing` library for
glow, depth of field and grain. The replay only loads when you open it, so it never slows down the
recognition itself.

## Requirements

- Python 3.13.11
- Node.js 22.19.0
- npm 11.8.0

## Getting the database

The song database is not in Git. Download it from the latest release,
[`db-2026-09-25`](https://github.com/Mithun-11/Apollo/releases/tag/db-2026-09-25) (25 songs,
fingerprint version 3), and put it at `data/apollo-v3.db`. Back up your own copy first if you have
one.

From the `Apollo` folder:

```bash
curl -L -o data/apollo-v3.db https://github.com/Mithun-11/Apollo/releases/download/db-2026-09-25/apollo-v3.db
```

Or with the GitHub CLI:

```bash
gh release download db-2026-09-25 -p apollo-v3.db -D data --clobber
```

Set `APOLLO_DB_PATH` to use a database somewhere else. The API will not start without the
database, and it never creates an empty one by itself.

## Song catalog

These are the 25 songs in `db-2026-09-25`. Apollo can only recognize songs that are in the
database.

| # | Song |
|---|------|
| 1 | [Cold (feat. Future)](https://open.spotify.com/track/2NlTOhsAamXOaZciOXbITb) |
| 2 | [Lukiye](https://open.spotify.com/track/0lnzi6uXH3UVtkdiIsAMBc) |
| 3 | [Hall of Fame](https://open.spotify.com/track/0FB5ILDICqwK6xj7W1RP9u) |
| 4 | [Sparkle](https://open.spotify.com/track/1HNvADmPBGAExeyIHkcJtd) |
| 5 | [Sparkle (English Version)](https://open.spotify.com/track/2exeLldmRfwD9P0gSBYB9T) |
| 6 | [Bus Sohokari](https://open.spotify.com/track/3JWH65CXpChIoKuW1wKoFB) |
| 7 | [Ekanto Golaap](https://open.spotify.com/track/7LvHieZe4yPYpDRF0OPCmk) |
| 8 | [Sarà perché ti amo](https://open.spotify.com/track/6lK2xptPzLPmvpE29U4mDH) |
| 9 | [Sunflower (Spider-Man: Into the Spider-Verse)](https://open.spotify.com/track/3KkXRkHbMCARz0aVfEt68P) |
| 10 | [Heat Waves](https://open.spotify.com/track/3USxtqRwSYz57Ewm6wWRMp) |
| 11 | [Chaite Paro 2](https://open.spotify.com/track/2VpwAV3gsadE2zV2JpkoWI) |
| 12 | [Moho](https://open.spotify.com/track/0OtKBLidTecETe735woxQ9) |
| 13 | [Purnota](https://open.spotify.com/track/4bxMJf8FEJNn1I4I2oT1ax) |
| 14 | [Bhalobasha Tarpor](https://open.spotify.com/track/6pVfsy6JkncJnOh7G4jf0F) |
| 15 | [Kodom](https://open.spotify.com/track/2Dsmn1xssJpbEM4LeRJbhI) |
| 16 | [Nitol Paye](https://open.spotify.com/track/44NjxYASrwY5FNO89NmUAh) |
| 17 | [Prostab](https://open.spotify.com/track/6PoGgomtdwU1jSLQybrUmJ) |
| 18 | [Ami Akash Pathabo](https://open.spotify.com/track/62NkP9pkOw6y2B25pokMMQ) |
| 19 | [Bella Ciao (Money Heist)](https://open.spotify.com/track/3ISMDCuo2KDOC64nXz0Vah) |
| 20 | [Stereo Hearts (feat. Adam Levine)](https://open.spotify.com/track/4Ljs6Dvpz7Arf9Ac8RN7tn) |
| 21 | [Shinzo wo Sasageyo!](https://open.spotify.com/track/5uraJqtCBvLpwt3VeomZdq) |
| 22 | [Kaikai Kitan](https://open.spotify.com/track/6y4GYuZszeXNOXuBFsJlos) |
| 23 | [Gurenge](https://open.spotify.com/track/0qMip0B2D4ePEjBJvAtYre) |
| 24 | [Unravel](https://open.spotify.com/track/1rN9QoVxw5U7TJkyaUR8C1) |
| 25 | [Fukashigi no Karte](https://open.spotify.com/track/2Zj2AqmjkgpBix8cZAu6iY) |

## Backend

From `backend/`:

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

To add your own song (the audio file itself is never stored, only its fingerprints):

```bash
python -m app.catalog "path/to/song.wav" --name "Song title" --spotify-url "https://open.spotify.com/track/..."
```

Adding songs makes edit and cover matching a little slower.

If you want to start with an empty database instead of downloading one, run `python -m app.database`.

## Frontend

From `frontend/`, in a second terminal:

```bash
npm ci
npm run dev
```

Then open http://localhost:3000. The frontend talks to the backend through the Next.js
`/backend/*` proxy. `BACKEND_URL` defaults to `http://127.0.0.1:8000`.

For a demo, use `npm run build` and then `npm start`. It is noticeably faster than dev mode.

## Checks

Backend, from `backend/`:

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

## Storage

`data/schema.sql` defines the `songs` and `acoustic_fingerprints` tables. Fingerprint hashes are
16-digit hex strings in the code and are stored as signed 64-bit integers in SQLite. Songs and
microphone recordings are only processed in memory and are never saved.
