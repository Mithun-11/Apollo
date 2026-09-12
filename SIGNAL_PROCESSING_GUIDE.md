# Apollo Signal Processing and Recognition

This guide explains the algorithm currently used by Apollo and how it connects to the running
backend and frontend.

## Recognition flow

```text
microphone WAV
→ decode, mono, 22,050 Hz, peak normalization
→ STFT magnitude spectrogram in decibels
→ strong local spectral peaks
→ anchor-target fingerprint hashes
→ matching hashes from the startup catalog cache
→ per-song time-offset votes
→ threshold gates
→ match and timestamp, or no match
```

Catalog songs use the same preprocessing and fingerprint functions. This symmetry is essential: a
query can match only when both sides produce compatible hashes.

## Central configuration

`SignalConfig` in `backend/app/services/signal.py` owns every value that affects preprocessing,
fingerprinting, or match acceptance.

| Field | Value | Meaning |
|---|---:|---|
| `sample_rate` | 22,050 Hz | Common processing rate |
| `n_fft` | 2,048 samples | Samples in each STFT window |
| `hop_length` | 512 samples | Step between adjacent windows |
| `peak_neighborhood_frequency_bins` | 15 | Local-maximum width in frequency |
| `peak_neighborhood_time_frames` | 9 | Local-maximum width in time |
| `peak_amplitude_threshold_db` | -35 dB | Weak-cell rejection threshold |
| `fan_out` | 10 | Maximum targets paired with one anchor |
| `min_time_delta_frames` | 1 | Nearest target distance |
| `max_time_delta_frames` | 200 | Farthest target distance |
| `match_threshold` | 10 | Minimum aligned votes |
| `min_match_ratio` | 0.01 | Minimum votes/query fingerprints |
| `min_winner_ratio` | 1.5 | Required separation from another song |
| `fingerprint_version` | `"1"` | Stored compatibility marker |

Changing a value used in the fingerprint payload or peak generation requires a new fingerprint
version and regenerated catalog rows. Match-acceptance thresholds do not change stored hashes.

## Audio preprocessing

`load_audio` uses librosa to decode WAV, MP3, FLAC, or OGG, mix channels to mono, and resample to
22,050 Hz. It rejects empty, non-finite, and silent input, then divides samples by the maximum
absolute amplitude so the waveform peak is 1.0.

Librosa uses Numba-compiled helpers. Apollo points Numba's compiled-code cache at a writable system
temporary directory unless `NUMBA_CACHE_DIR` is already configured. This cache contains generated
machine code, not audio or song fingerprints.

## STFT and spectrogram

A complete-song FFT shows which frequencies exist but loses when they occur. Apollo uses the
Short-Time Fourier Transform: it applies a Hann window to overlapping 2,048-sample frames, advances
512 samples, and computes an FFT for each frame.

For sample rate `F_s`, transform size `N`, and bin `k`:

```text
frequency(k) = k × F_s / N
```

At the current settings, bins are about 10.77 Hz apart and frames are about 23.22 ms apart. Real
audio needs only the `N/2 + 1` non-negative-frequency bins.

`extract_peaks` converts magnitudes to decibels relative to the strongest value. The strongest cell
is 0 dB; weaker cells are negative. `scipy.ndimage.maximum_filter` then keeps cells that are both a
local maximum and at least -35 dB.

The remaining `Peak(frequency_bin, time_frame, amplitude_db)` values form the constellation map.
They are sparse landmarks, so matching them is cheaper and less sensitive than comparing complete
waveforms or spectrograms.

## Fingerprints

`create_fingerprints_with_traces` sorts peaks by time and frequency. Each anchor peak pairs with up
to ten later targets whose time difference is between 1 and 200 frames.

The deterministic hash payload is:

```text
fingerprint_version | anchor_frequency_bin | target_frequency_bin | delta_frames
```

BLAKE2b produces an eight-byte digest represented as 16 hexadecimal characters. Python's built-in
`hash()` is unsuitable because it is randomized between processes.

The stored record also includes the anchor frame. Absolute time is deliberately excluded from the
hash, allowing the same local pattern to match when a query starts at a different position.

## Supabase catalog and startup cache

`songs` stores ID, name, and Spotify URL. `acoustic_fingerprints` stores song ID, fingerprint
version, hash, and anchor frame. Source audio is not stored.

FastAPI lifespan startup reads songs and current-version fingerprints in deterministic paginated
batches. `CatalogCache` holds:

```text
song ID → metadata
song ID → fingerprints
```

Rich prints fingerprint-loading progress and final totals in the backend terminal. A load failure
stops startup. Recognition reads only the in-memory snapshot, so catalog changes become visible
after a backend restart.

## Hash matching and timestamp voting

For each equal query/catalog hash, Apollo computes:

```text
offset frame = catalog anchor frame - query anchor frame
```

If a query begins at source frame `T`, a query feature at frame `q` should occur at catalog frame
`T + q`; their difference is therefore `T`. Correct hashes repeatedly vote for the same song and
offset.

The selected pair has the most votes, with deterministic tie-breaking. Apollo rejects it unless:

- aligned votes are at least `match_threshold`;
- aligned votes divided by query fingerprints meet `min_match_ratio`; and
- the winner is sufficiently stronger than the best competing song.

The accepted offset becomes seconds through:

```text
timestamp seconds = offset frame × hop length / sample rate
```

No votes, weak support, or ambiguous competing support produces a normal no-match result.

## Explanation data

`POST /recognize/explain` analyzes the query once and returns the compact recognition result plus
bounded display data:

- waveform minimum/maximum envelope points;
- downsampled spectrogram values;
- strongest spectral peaks and whether they supported the winner;
- matched anchor-target timing/frequency evidence;
- the winning song's offset-vote histogram;
- the estimated source interval and pipeline counts.

The response does not expose raw fingerprint hashes or persist explanation data. The frontend uses
these values to explain the decision without changing the recognition algorithm.

## Implementation map

| File | Responsibility |
|---|---|
| `backend/app/services/signal.py` | Preprocessing, STFT peaks, fingerprints, voting |
| `backend/app/services/explanation.py` | Bounded visualization/evidence data |
| `backend/app/catalog.py` | Supabase ingestion, cache loading, recognition assembly |
| `backend/app/main.py` | FastAPI lifespan, validation, temporary uploads, HTTP errors |
| `backend/app/supabase_client.py` | Backend-only Supabase client |
| `frontend/lib/api.ts` | Browser/backend request and response types |
| `frontend/app/page.tsx` | Microphone recording and explanation interface |

## Current limitations

- Recognition targets excerpts from the same recording, not humming, covers, or melody-only input.
- Accuracy under noise, phone speakers, short clips, and a broader catalog is not yet quantified.
- Threshold values are initial calibration settings and need recorded evaluation.
- The cache is per process and refreshes only on backend restart.
- There is no browser catalog-management screen, authentication, or deployment configuration.

## References

- Avery Li-Chun Wang, [*An Industrial-Strength Audio Search Algorithm*](https://doi.org/10.5281/zenodo.1416340), ISMIR 2003.
- [NumPy Fourier transform documentation](https://numpy.org/doc/stable/reference/routines.fft.html)
- [librosa STFT documentation](https://librosa.org/doc/latest/generated/librosa.stft.html)
- [SciPy maximum-filter documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.ndimage.maximum_filter.html)
- [Python BLAKE2 documentation](https://docs.python.org/3/library/hashlib.html#blake2)
