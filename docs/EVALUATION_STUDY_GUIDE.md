# Apollo: final evaluation study guide

This guide describes the **current `design` branch**, checked on 25 September 2026. It is for both presenters to learn the project, not a slide deck. The proposed 3-minute explanation plus 3-minute demonstration assumes a **two-person team** and leaves the teacher's 2-minute Q&A separate.

## The explanation to remember

> Apollo recognizes a short recording of a song and estimates where that recording begins in the original. It converts sound into a time-frequency picture, keeps strong spectral peaks, pairs nearby peaks into repeatable fingerprints, and asks an indexed SQLite catalog where those fingerprints occur. Many matches agreeing on one song and one time offset produce an answer. If the recording is an edit, Apollo searches possible speed or pitch changes; if it is a different performance, it can compare melody and harmony. The result appears first, and an optional replay shows evidence from the recording.

The key distinction: **the ordinary recognition algorithm is deterministic signal processing, not a neural network**. Demucs, a pretrained neural network, is used only in the last-resort cover/live-performance path to separate vocals.

## 1. Motivation, problem, and scope

**Problem.** A person hears part of a song but does not know its title. Matching the raw waveform sample by sample is unreliable: a microphone changes amplitude, adds noise and room echo, and the recording can start anywhere in the song. Some recordings are sped up, pitched, or performed by another singer.

**Goal.** Given a short microphone or browser-tab recording, return the catalog song and the approximate source timestamp, then show *why* the answer was chosen. The visual explanation makes signal processing visible to someone who has not read the code.

**Scope.** Apollo searches a **local, finite catalog**. It is not an internet-wide music search, a hum recognizer, or an automatic downloader. If evidence is weak or the song is absent, it should show **no match** rather than invent a title. Audio is held temporarily for a request and deleted afterwards; the catalog stores fingerprints and melody features, not the original audio.

**Actual catalog on this laptop:** 21 songs, 2,952,642 version-3 acoustic fingerprints, and 21 rows of melody features in `data/apollo-v3.db` (checked 25 September 2026). The database is generated and distributed outside Git. The source-song audio folder is absent on this laptop; ordinary matching works from the database, but some optional replay comparisons with the original recording may be unavailable.

## 2. Overall approach and architecture

```text
Browser microphone or shared tab
    ↓ AudioWorklet captures samples; browser makes a WAV clip
Next.js UI → /backend/* proxy → FastAPI route
                                  ↓
                         decode, resample, STFT
                                  ↓
                         peaks → paired fingerprints
                                  ↓
                         indexed SQLite lookup
                                  ↓
                         offset voting → answer
                                  ↓ if needed
                         edit search → melody fallback

After the answer: explanation response → optional replay evidence → three.js visualization
```

The frontend is React/Next.js and never reads SQLite or hard-codes a FastAPI address. `frontend/lib/api.ts` calls the Next.js `/backend/*` proxy, configured in `frontend/next.config.ts`. FastAPI validates uploads and delegates work to Python services. `backend/app/services/signal.py` owns the signal algorithm, `backend/app/catalog.py` orchestrates recognition and catalog lookup, and `backend/app/database.py` owns SQLite connection and hash conversion. This separation lets signal functions work with plain Python/NumPy data and be tested without HTTP or a database.

**Three API calls have different jobs:**

| Endpoint | When called | Purpose |
|---|---|---|
| `POST /recognize` | Repeated live checks while listening | Small response: match, song, timestamp, counts and edit factors. Skips melody matching. |
| `POST /recognize/explain` | Once for the final clip; may start at 10 s if live checks have failed | Answer plus bounded waveform, spectrogram, peaks, vote and decision data. Can run the melody fallback. |
| `POST /recognize/evidence` | Only after the user opens a replay | Extra catalog votes, optional original-song peaks, edit curve or vocal alignment. It does not delay the answer. |

Other routes are `GET /health` and `POST /songs` for catalog ingestion. Uploads allow WAV, MP3, FLAC and OGG up to 50 MB. Recognition work runs in FastAPI's thread pool so an expensive request does not block another live check. See `backend/app/main.py`.

## 3. Signal-processing theory: sound to fingerprints

### 3.1 Samples, resampling, and normalization

A digital recording is a list of amplitudes over time. The browser captures audio using the selected device's sample rate and sends a WAV clip. The Python backend decodes it, converts it to **mono**, resamples to **22,050 samples/s**, and divides by its largest absolute amplitude. Catalog songs and queries must go through the **same** processing. Peak normalization reduces simple loudness differences; it does not remove noise or make different performances identical. See `load_audio()` in `backend/app/services/signal.py`.

### 3.2 STFT and spectrogram

The short-time Fourier transform (STFT) measures which frequencies are present in each short overlapping window. Apollo uses a **2,048-sample Hann window**, moving **512 samples** each step. At 22,050 Hz, a window spans about **92.9 ms**, and adjacent time frames are about **23.2 ms** apart. The magnitude is converted to decibels relative to the strongest magnitude. The resulting spectrogram has **time on one axis and frequency on the other**; bright cells mean strong energy at that time and frequency.

Why overlapping windows? A whole-song Fourier transform would tell us *which* frequencies occurred but not *when*. Short, overlapping transforms preserve both approximate time and frequency location. There is a trade-off: longer windows separate close frequencies better but blur timing; shorter windows improve timing but separate pitches less precisely.

### 3.3 Spectral peaks: the constellation

Apollo keeps local maxima in a **15-frequency-bin × 9-time-frame** neighborhood, between **100 Hz and 5 kHz**, above **−60 dB**, then retains at most **60 of the strongest peaks per second**. These peaks are the stars seen in the interface. Ignoring much of the spectrogram makes matching less sensitive to changes in loudness, equalization and background haze. The fixed per-second budget also keeps query size reasonably predictable. A peak stores a frequency bin, time frame and amplitude.

### 3.4 Pairs and deterministic hashes

One peak is too common to identify a song. For each **anchor** peak, Apollo connects up to **10 later target** peaks, **1–64 frames** later and no more than **150 frequency bins** away. A pair is described by:

```text
(anchor frequency bin, target frequency bin, time difference in frames)
```

The anchor's absolute time is stored separately. The tuple plus fingerprint version `3` is encoded with **BLAKE2b, 8-byte digest** as a 16-character hexadecimal hash. The same local pattern produces the same hash even if the microphone started recording at a different point in the song. BLAKE2b makes a compact, stable lookup key; it is **not encryption** and does not make a fingerprint unique by itself. The matching evidence comes from many hashes that agree on one time alignment.

### 3.5 Database lookup and time-offset voting

Apollo stores each catalog fingerprint's **song ID, version, hash and anchor frame**. The SQLite index on `(fingerprint_version, hash_value)` lets it fetch only hashes present in the query, in batches of at most 500 distinct hashes. It does **not** load or compare all 2.95 million catalog fingerprints on each request. Hexadecimal hashes are converted losslessly to signed 64-bit SQLite integers at the database boundary; different fingerprint versions are never mixed.

For every shared hash, calculate:

```text
offset_frames = catalog_anchor_frame − query_anchor_frame
```

If the recording begins 10 seconds into a song, many separate matching pairs should vote for approximately the same 10-second offset. Apollo adds votes within **±1 frame**, because a microphone clip rarely starts exactly on the song's STFT frame boundary. It ignores negative offsets. A normal fingerprint match needs **at least 20 votes** and **at least twice the votes of the best competing song**. The runner-up is another song, not another repeated chorus of the same song.

The winning source time is `offset_frames × 512 / 22,050` seconds. For example, if corresponding anchors are at catalog frame 480 and query frame 50, the offset is 430 frames, or about **9.98 seconds**. This is why Apollo can report *where* the clip occurs, not merely the title. One frame is about 23 ms, but this is a grid resolution, **not a promise of 23 ms real-world timestamp accuracy**.

**Explain it aloud:** “A coincidental hash can occur anywhere. A real match makes many independent hashes all point to the same song and starting time.”

## 4. Why there are two fallback algorithms

### 4.1 Speed and pitch edits

Plain fingerprints use exact frequency bins. Speeding a recording up changes its **time spacing and pitch**; a pitch-only edit changes **frequency but not timing**. Either can destroy exact hash equality.

If ordinary matching fails and the clip is at least **4 seconds** long, `backend/app/services/speed_search.py` tries candidate factors over roughly **0.75×–1.35×**, spaced about **1.5%** apart. There are two candidate families: speed plus pitch, and pitch only. Rather than redoing the STFT for each guess, it rescales the already detected peaks back toward the catalog's grid, makes new fingerprints and uses the same matcher. A cheap coarse pass tries **78 candidates** with fewer pairs; a detailed pass checks the strongest candidates and neighbors. The answer reports `speedFactor` and `pitchFactor`.

### 4.2 Covers, live performances, and singing crowds

A cover is a different audio recording, so the exact spectral pairs may not survive even after speed adjustment. The last fallback, used only by `/recognize/explain` for clips of at least **8 seconds**, looks for similar *musical structure*:

1. Pretrained **Demucs** separates vocals from the mix. This is the only neural-network stage in recognition.
2. **pYIN** estimates the sung pitch contour; **CENS chroma** summarizes the 12 pitch classes for both vocals and the full mix.
3. **Subsequence dynamic time warping (DTW)** compares the short query with each catalog song while allowing tempo differences and different start positions. It also tries all **12 key shifts**.
4. Costs are standardized across songs and combined with weights **melody:vocal chroma:mix chroma = 1:2:1**. Apollo accepts a song only if enough of the clip is sung (**at least 30% voiced**) and its score beats the runner-up by **at least 1.2**.

`melody_features` stores precomputed features for catalog songs, so the catalog need not be separated on each query. The source time for this method comes from the start of the best vocal-chroma alignment. A melody match reports `matchMethod: "melody"`, a score gap and a key shift. The first model load is prewarmed in the background on startup. This fallback can still miss an instrumental section or a noisy crowd.

**Q&A distinction:** fingerprint matching asks, “Is this the **same recording**?” Melody matching asks, “Could this be the **same song in another performance**?”

## 5. Design and implementation decisions

| Choice | Reason and effect |
|---|---|
| Versioned deterministic fingerprints | Catalog and query must produce identical hashes. A parameter change affecting hashes requires a new version and regenerated catalog. |
| Local indexed SQLite catalog | Runs without a remote service; indexed bounded lookups are fast. `songs` and `acoustic_fingerprints` are joined through integer song IDs. |
| Transactional ingestion | A song and its fingerprints are inserted together; partial songs are avoided. Foreign keys are enabled on each connection. |
| Conservative acceptance gates | A weak or ambiguous match becomes “no match,” protecting against confident wrong answers. |
| Fallbacks only after ordinary failure | Normal songs do not pay for edit search or neural vocal separation. |
| Live checks use the entire accumulated clip | More fingerprints collect over time, and a true source timestamp stays consistent across checks. |
| Two agreeing live checks | Same song plus timestamps within **0.25 s** confirms an early answer and rejects transient chance hits. |
| Answer before replay | The title card appears on the first confirmed live check; explanation fills in later. Replay evidence and three.js load only when requested. |
| Bounded explanation data | The API returns sampled visualization data instead of raw audio or millions of hashes. |
| Local capture, temporary server file | Browser recording stays in memory for replay; backend upload files are deleted after a request. Catalog song audio is not stored in SQLite. |

The exact schema is in `data/schema.sql`. Besides indexed acoustic fingerprints, it has a separate `melody_features` table. The database connection uses WAL mode plus SQLite cache and memory-map pragmas. Normal API startup requires an existing database; it does not silently create an empty catalog.

## 6. What happens when a user presses Listen

1. The user chooses **Microphone** or **Browser tab**. The tab option requires sharing a tab with audio. An `AudioWorklet` collects samples; the page encodes accumulated samples as WAV for checks. A previously permitted microphone may already be warmed up, reducing start delay.
2. The first `/recognize` check begins at about **2 s**, with later checks about **1 s** apart while no request is in flight. Each sends the **whole recording so far**. The UI draws a lightweight live sky and shows check status.
3. Two consecutive answers with the same song and source timestamp within **0.25 s** stop recording and show the title immediately. If live checks keep failing, an early `/recognize/explain` request starts at **10 s** for a possible cover; recording otherwise stops by **15 s**.
4. The final explanation supplies waveform, spectrogram, peaks, pair examples, counts, candidate votes, decision reason, and matched alignment. If failed live checks already tried edits, `liveChecksFailed=true` avoids repeating that expensive search.
5. The title card offers a Spotify link at the estimated source time, a short **Watch how it was found** highlight, and **Class mode**. Opening either replay fetches `/recognize/evidence`, decodes the local recording, and loads the three.js world. Class mode advances with arrow keys or Page Up/Down; Space replays a stop and Esc exits.

The live sky is a **visualization**, not the server's recognizer. Its browser-side FFT paints frequency over time, stars mark local maxima, and the lake responds to loudness. The answer comes from the Python pipeline. The painted background holds still while listening, and the live canvas draws at about **30 fps** to leave CPU/GPU capacity for recognition. The replay shows stages such as Sound, Spectrum, Stars, Fingerprints, Catalog, Alignment and Answer; edit and Voice stops appear when relevant. Its visuals are based on the response and optional evidence, not a new recognition algorithm.

## 7. Results: what can be stated honestly

**Verified in this checkout on this laptop:** the SQLite file passed integrity checking; it contains **21 songs**, **2,952,642 version-3 fingerprints**, and **21 melody-feature rows**. Backend Ruff and mypy pass, **64 backend tests pass**, frontend lint/typecheck/build pass, and the production page, API health endpoint and Next.js proxy returned HTTP 200. PyTorch sees the RTX 3050 and the Demucs model loads. This is a setup verification, **not an end-to-end accuracy trial with real audio on this laptop**.

**Recorded project experiments in `PROGRESS.md`:** the v3 fingerprint pipeline correctly identified **50/50 clean** and **50/50 simulated phone → classroom → laptop-mic** clips in one 5-song, 10-clips-per-song test; under equal-loudness chatter it got **46–47/50**. A separate edit test reported **18/18** for several slowdown, nightcore and pitch-shift conditions, with **15/18** for a deep-voice plus reverb condition. A cover/live session simulation on a **21-song** catalog identified **64%** of sessions, had **1 wrong answer in 328 sessions**, and **0 false matches in 48 out-of-catalog sessions**. These are results of the stated test sets, **not universal accuracy claims**.

`PROGRESS.md` also describes later UI timing measurements using a **27-song snapshot**. Do not present those as measurements of the **21-song database currently on this laptop**. Catalog size affects search time and the chance-match distribution. For the evaluation, time your chosen clip on this machine in a production build and report that observation separately.

**Known limits:** unseen songs return no match; an edit outside the search range may fail; covers with little singing may fail; heavy noise or soft passages may provide too few stable peaks; estimated timestamps have algorithmic and acoustic error. The source-song audio files are currently absent from `D:\Songs`, so the replay may lack the original-song peak overlay even though catalog matching is available. A recorded or streamed clip used in the lab should be tested in advance with the actual capture source and permissions.

## 8. A 3-minute teaching outline, before making slides

Use this to **rehearse**, not as text to paste onto slides. Both teammates should be able to explain every step.

| Time | What to say | What the teacher should understand |
|---|---|---|
| 0:00–0:25 | Problem, goal, finite local catalog, source timestamp. | What Apollo solves. |
| 0:25–1:15 | Samples → STFT spectrogram → local peaks → paired hashes. | Why a robust fingerprint is possible. |
| 1:15–1:50 | Indexed lookup → consistent time-offset votes → 20-vote and runner-up gates. | How the title and timestamp are decided. |
| 1:50–2:20 | Speed/pitch and melody fallbacks. | Why edits and covers need different methods. |
| 2:20–2:45 | Next.js → FastAPI → signal services → SQLite; answer before replay. | Architecture and speed design. |
| 2:45–3:00 | One measured result and one limitation, then start demo. | Evidence and honest scope. |

**A possible 3-minute demo:** open the production page and select a known catalog clip, preferably **Heat Waves** (present in this 21-song database). Use browser-tab audio if the lab browser supports sharing tab audio; enable its audio checkbox. Press Listen, wait for the title and timestamp, then open **Class mode** and step through Spectrum, Stars, Fingerprints, Catalog and Alignment. Point to **one real number** in the replay, such as the fingerprint count or winning votes. Leave time for one retry. Do not rely on the replay's automatic highlight for pacing; its chapter animations can exceed a short demo slot. Rehearse the exact clip and machine beforehand. The teacher's PC needs the slides before 2:30 PM; test projector/adapters and keep the two app servers running on your laptop before the lab begins.

## 9. Likely Q&A: short answers you can expand

1. **Why not compare waveforms directly?** A shifted start, noise, room acoustics and recording volume change the samples. Local spectral peak relationships survive many of those changes.
2. **What does an FFT contribute?** It converts a short time window into frequency strengths. Repeating it over overlapping windows gives the spectrogram, preserving approximate timing.
3. **Why pairs of peaks?** A single frequency at one moment is common. Two frequencies plus their relative time are more distinctive and remain stable under an unknown start time.
4. **Why store an anchor time if the hash excludes absolute time?** The hash finds similar local patterns; the two anchor times reveal the source offset.
5. **Why not accept the largest vote automatically?** Every catalog search has a largest score, even for an unrelated song. The 20-vote floor and 2× runner-up separation reduce false answers.
6. **What is “confidence”?** In a fingerprint response it is `min(1, winning_votes / query_fingerprint_count)`; for melody it is derived from the score gap. It is a display score, **not a calibrated probability**.
7. **Is this machine learning?** The main fingerprint and edit paths are deterministic DSP and database lookup. Only the cover fallback uses pretrained Demucs for vocal separation; pYIN, chroma and DTW then compare features.
8. **How is an edit recognized without 78 new STFTs?** Apollo computes peaks once, rescales their time/frequency coordinates for candidate changes, and performs a coarse then refined lookup.
9. **How does a cover match if its waveform differs?** The fallback compares pitch contours and 12-class harmony patterns with subsequence DTW across keys and tempos.
10. **What happens if the song is absent?** If no path clears the acceptance rules, the UI reports no catalog match. The replay can still explain what the microphone captured.
11. **Does the app upload or save song audio permanently?** The browser sends a short clip to the local FastAPI server; the server processes a temporary file and deletes it. SQLite stores derived fingerprints and melody features.
12. **Why SQLite rather than a cloud database?** It is sufficient for the local 21-song demo, supports an indexed hash lookup, avoids network latency and keeps the project self-contained.
13. **What happens when the catalog grows?** Lookup and fallback cost increase, and wrong-song votes become more likely. Match thresholds and melody score gaps must be re-evaluated with new data.
14. **What if the backend is down?** The frontend proxy request fails; the UI exposes an error state. The backend refuses normal startup when the configured database is missing.
15. **What is the largest current weakness?** Robustness on real classroom microphone recordings has less evaluation than simulated conditions. Covers with little singing and heavily masked quiet passages are difficult.

## 10. Where to look in the repository

| Question | Source |
|---|---|
| DSP parameters, STFT, peaks, hashes, vote matcher | `backend/app/services/signal.py` |
| SQLite path, versioned indexed lookup, ingestion, recognition flow | `backend/app/database.py`, `data/schema.sql`, `backend/app/catalog.py` |
| Speed and pitch search | `backend/app/services/speed_search.py` |
| Vocal separation, melody features, DTW | `backend/app/services/vocal_separation.py`, `backend/app/services/melody_match.py`, `backend/app/melody_catalog.py` |
| API validation and endpoints | `backend/app/main.py` |
| Explanation and optional replay evidence | `backend/app/services/explanation.py`, `backend/app/evidence.py` |
| Recording, live checks, result and replay controls | `frontend/app/page.tsx`, `frontend/lib/api.ts` |
| Live sky and 3D replay | `frontend/app/sky/`, `frontend/app/replay/` |
| Test history, measurements and limits | `PROGRESS.md` |

**Practice test:** without reading this file, draw the path from sound to answer, explain the offset equation with two frame numbers, explain why an edit and a cover need different fallback paths, and name one measured result plus its test conditions. If both teammates can do that, the implementation and Q&A will be much easier to handle.
