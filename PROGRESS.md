# Recognition progress log

Read this before changing recognition, matching, or the microphone flow. It records what the
current algorithm does, why, how it was measured, what was tried and rejected, and what is still
open. Update it when you change any of these.

Last updated: 2026-09-23. Current release is v3, merged into `main` by PR #20.

## Current state at a glance

| Area | State |
|---|---|
| Fingerprints | `fingerprint_version = "3"` in `backend/app/services/signal.py` (`SignalConfig`) |
| Database | `data/apollo-v3.db`, the default path; not in Git; 6 songs |
| Songs | Cold(feat. Future), Lukiye, Hall of Fame, Sparkle, Bus Sohokari, Ekanto Golaap |
| Frontend | Warm microphone, streaming checks, early stop (`frontend/app/page.tsx`) |
| API | Unchanged: `POST /songs`, `POST /recognize`, `POST /recognize/explain` |
| CI | Windows and macOS verify jobs plus the dependency audit, all passing on `main` |

## The algorithm (v3)

```text
audio → mono 22,050 Hz → STFT (n_fft 2048, hop 512) → dB spectrogram
      → local maxima (15 bins × 9 frames) → keep 100 Hz – 5 kHz, ≥ −60 dB
      → strongest 60 peaks per second → pair each anchor with up to 10 targets
        (1–64 frames later, ≤ 150 bins apart) → BLAKE2b hash of "3|f_anchor|f_target|Δt"
      → SQLite lookup → vote per (song, offset), counting ±1 frame together, offset ≥ 0
      → accept if ≥ 20 votes and ≥ 2× the best other song
```

### What changed from v1 and why

| Setting | v1 | v3 | Reason |
|---|---|---|---|
| Frequency range | all | 100 Hz – 5 kHz | Phone speakers and laptop mics reproduce little outside this range, so fingerprints from there rarely survive and only add chance matches. |
| Peak selection | ≥ −35 dB of the song's loudest moment | strongest 60 per second, floor −60 dB | The global cutoff removed most peaks from soft passages (Lukiye, Sparkle's quiet parts). Noise also flooded v1 queries with extra peaks. |
| Pairing zone | up to 200 frames (4.6 s), any frequency | up to 64 frames (1.5 s), ≤ 150 bins | Close pairs survive room echo and noise better. |
| Offset voting | exact frame only | ±1 frame counted together | A mic recording never starts on the catalog's 512-sample frame grid, so votes split between neighbouring frames. Even identical clean audio matched only about 38% of hashes at the exact frame. |
| Negative offsets | counted | ignored | A clip cannot start before the song. This removed the only false match seen in testing. |
| Acceptance | ≥ 10 votes and ≥ 1% of query fingerprints and ≥ 1.5× the runner-up | ≥ 20 votes and ≥ 2× the best other song | The 1% rule rejected correct answers: noise adds query fingerprints while true hits fall. In the mic + noise 0 dB test the correct song was always on top (median 68 votes vs ≤ 12 for wrong songs), yet 21 of 24 clips were rejected by that rule alone. |

The "best other song" rule compares against another song only, never another part of the same
song. Comparing against the same song rejected clips whose chorus repeats.

### Why a fixed minimum (20) is safe, and when it stops being safe

The 60-per-second budget keeps query size roughly constant, so chance votes stay predictable:
wrong songs got at most 11–15 votes on 10-second clips, while correct matches got 20 or more. The
floor must be re-measured when:

- **the catalog grows,** because more songs mean more chance votes;
- **clips get longer,** because at 15 s a threshold of 15 already produced up to 5 false
  matches in 50.

## Frontend behaviour (`frontend/app/page.tsx`)

- **Raw microphone:** `echoCancellation`, `noiseSuppression` and `autoGainControl` are off. They
  are tuned for speech and distort music.
- **Warm microphone** (`MicrophoneKeeper`): when mic permission is already granted, the mic and
  the AudioWorklet recorder are opened on page load and the AudioContext is suspended. Listen only
  calls `resume()`, which is instant. The mic is released while the tab is hidden. The trade-off is
  that the browser's mic indicator is on while the tab is visible, like a video call.
- **Streaming early stop:** from 2 s, then about every 1 s, the frontend sends the **whole
  recording so far** (not just the last second) to `/recognize`. It stops when two consecutive
  checks return the same song with timestamps within 0.25 s. The hard limit is 15 s. Then one
  `/recognize/explain` call on the final clip feeds the explanation UI.
- **Why the whole clip:** votes accumulate, pairs span up to 1.5 s, and every check shares the
  same start, so a real match repeats the same timestamp while a chance match does not. Server
  time per check is 0.04 s for 2 s of audio and about 0.2 s for 15 s.

## Catalog workflow

The song list lives in `D:\Signal Project\Song list.xlsx`, outside the repo. Its columns are Song
name, Spotify Url and Status. An empty Status means the song is not in the database yet. Audio
files are in `D:\Signal Project\Songs\` and are downloaded with yt-dlp, so their filenames differ
from the song names.

```powershell
# from backend/
python -m app.catalog "..\..\Songs\<file>.wav" --name "<Song name>" --spotify-url "<Spotify Url>"
```

After adding a song, set its Status to `done`. `openpyxl` is installed in the global Python for
editing the sheet. Any change to fingerprint hashes needs a new `fingerprint_version` and every
song re-added to a fresh database.

## How v3 was evaluated

The evaluation was an offline simulation. The harness scripts were temporary and have been
deleted; rebuild from this description if needed.

- **Catalog:** the local songs, fingerprinted in memory with the candidate settings.
- **Queries:** 10 clips per song, at random start positions that are not aligned to the frame
  grid. Clips are either taken from anywhere in the song or from voice/tune parts, meaning the
  quietest 25% of 10 s windows by 300–3400 Hz energy are excluded.
- **Demo conditions** (applied to each clip):
  - Phone speaker: 350 Hz high-pass plus soft clipping.
  - Classroom reverb: RT60 ≈ 0.6 s.
  - Laptop mic: 120 Hz – 7 kHz, plus fan hum.
  - Audience chatter: speech-shaped, syllable-modulated noise.
  - A nearby talker: synthetic voiced speech with pitch harmonics and formants.
- **False-match test:** each query is run again with its own song removed from the catalog. Any
  answer is a false match.
- **Metrics:** correct / no match / wrong, the correct song's votes, the best wrong song's
  votes, and the hash hit rate at the true offset.

### Key results (5 songs × 10 clips of 10 s = 50 per condition)

| Condition | v1 | v3 |
|---|---|---|
| Clean | 50/50 | 50/50 |
| Phone → classroom → laptop mic | 34/50 | 50/50 |
| + chatter 10 dB / 5 dB | 9/50, 0/50 | 50/50, 50/50 |
| + chatter as loud as the music (0 dB) | 0/50 | 46–47/50 (misses: quiet Lukiye/Sparkle spots) |
| + a talker at 10 / 5 / 0 / −5 dB | ≤ 2/50 | 50/50 at every level |
| False matches with the song removed | 0 | 0 in 500+ queries |

End to end through the real API on a copy of the database, with a talker at 0 dB: 15/15 correct
songs and timestamps. The streaming stop fired at a median of 4 s (max 6 s).

## Tried and rejected

- **v2 (the deleted branch `feature/fingerprint-algorithm-improvements`):** chose each anchor's
  targets by loudest peak in a 4.6 s window. Loudness ranking is exactly what mic EQ, reverb and
  noise change, so it did worse than v1 under noise (pink 0 dB: 12/24 vs 23/24). Its ±1 offset
  clustering idea was kept.
- **30 peaks per second:** best under diffuse chatter, but a nearby voice took the budget (talker
  at −5 dB: 12/30). 60 fixes the talker case; the cost is chatter at −5 dB (5/30 vs 16/30).
- **Spectral whitening before peak picking:** halved the clean hit rate.
- **Threshold 15:** did not fix the remaining misses and produced false matches.
- **5-second fixed clips:** fragile under heavy noise (chatter at 0 dB: 30/50). Streaming with a
  15 s limit replaced fixed clips.

## Open items and ideas

1. **Real recordings:** test with phone → laptop recordings with people talking. All numbers
   above are simulated.
2. **Upper frequency limit:** 5 kHz was never tuned. Try 4 / 6 / 8 kHz with the harness.
3. **Per-band peak budget:** split the 60 peaks per second across frequency bands so a voice
   cannot take all of them. It might recover the chatter −5 dB case without losing the talker
   case.
4. **Re-check the 20-vote floor** whenever songs are added, using the false-match test.
5. **Soft-song weak spots:** the remaining misses were quiet Lukiye/Sparkle passages under extreme
   chatter.
6. **`filelock`** is installed through `pip_audit`'s file cache but is not pinned in
   `requirements.txt`. This predates v3 and is harmless.

## Environment notes (Windows development machine)

- **pytest:** run with `--basetemp=.pytest-tmp` from `backend/`, because the default AppData temp
  folder is access-denied on this machine.
- **Starlette `TestClient`:** uses `httpx2`, which replaced `httpx`/`httpcore` in
  `requirements.txt`.
- **Old v1 database:** `data/apollo.db` is still on disk. v3 never reads it.
