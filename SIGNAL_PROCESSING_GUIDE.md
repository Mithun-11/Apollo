# Apollo: Signal-Processing Theory and Implementation

This guide explains the theory behind Apollo's song-recognition pipeline and maps each idea to the
code that implements it. The same signal services power the local teaching demo, the Supabase
catalog, the FastAPI routes, and the browser microphone flow. It assumes familiarity with ordinary
digital audio concepts such as samples and amplitude, but no prior knowledge of Fourier transforms.

## 1. What Apollo does

Apollo receives a short audio clip and searches a small catalog of full songs. It returns:

- the most likely source song;
- the estimated position of the clip inside that song; and
- the number of fingerprints that agreed with that result.

The Stage 1 pipeline is:

```text
full songs                                  query clip
    │                                           │
    └──────────────┐             ┌──────────────┘
                   ▼             ▼
             decode → mono → resample → normalize
                              │
                              ▼
                    STFT magnitude spectrum
                              │
                              ▼
                     local spectral peaks
                              │
                              ▼
                      constellation map
                              │
                              ▼
              deterministic anchor-target hashes
                              │
                              ▼
                 matching hashes + offset votes
                              │
                              ▼
                    song name and timestamp
```

This is conceptually based on the constellation-map approach described by Avery Wang in
*An Industrial-Strength Audio Search Algorithm* (ISMIR 2003). Apollo is a small educational
implementation, not a claim to reproduce the complete commercial Shazam system.

## 2. Audio in the time domain

A digital audio file stores measurements of air-pressure variation. After decoding, Apollo sees
the audio as an array:

```text
sample number:  0      1      2      3      4      ...
amplitude:      0.02   0.11   0.18   0.09  -0.04   ...
```

This is the **time domain**: the horizontal direction is time and each value is the waveform's
amplitude at that instant.

The **sample rate** says how many measurements exist per second. Apollo uses 22,050 samples per
second. Therefore:

```text
time in seconds = sample index / 22,050
```

The waveform is useful, but it does not directly say which musical frequencies are present.
Song recognition needs both frequency and timing information.

## 3. Preprocessing: making every input comparable

The `load_audio` function in `backend/app/services/signal.py` performs the same preprocessing for
catalog songs and query clips.

### 3.1 Decode

`librosa.load` converts the WAV file into a NumPy floating-point array. The signal-processing
functions work with ordinary arrays rather than depending on a particular file format or web API.

### 3.2 Convert stereo to mono

A stereo file has left and right channels. Apollo asks librosa for mono audio so every input has
one amplitude value per sample. This reduces work and prevents channel layout from changing the
fingerprint representation.

Mono does not mean that frequency information disappears. It only combines the channels; the
musical frequencies remain in the resulting waveform.

### 3.3 Resample to 22,050 Hz

Files can arrive at 44,100 Hz, 48,000 Hz, or another sample rate. Comparing frequency-bin numbers
from different sample rates would be invalid. Apollo resamples every song and clip to the same
22,050 Hz rate.

The Nyquist rule says a sampled signal can represent frequencies up to half its sample rate.
Apollo can therefore represent frequencies up to:

```text
22,050 / 2 = 11,025 Hz
```

This is sufficient for the current demonstration and halves the processing required for 44,100 Hz
audio.

### 3.4 Peak-normalize amplitude

Apollo divides the complete waveform by its largest absolute sample value:

```text
normalized sample = original sample / maximum absolute amplitude
```

The strongest sample becomes `1.0` or `-1.0`. A quiet copy and a loud copy then have comparable
amplitude scales. This does not remove background noise or compression artifacts; those are part
of later robustness evaluation.

Empty, silent, or non-finite audio is rejected instead of producing meaningless fingerprints.

## 4. From a waveform to frequencies

### 4.1 A frequency is repeated motion

A pure sine wave can be written as:

```text
x(t) = A sin(2πft + φ)
```

where:

- `A` is amplitude;
- `f` is frequency in hertz;
- `t` is time; and
- `φ` is phase, which describes where the cycle begins.

Real music is not one sine wave. It is a mixture of fundamentals, harmonics, percussion, voices,
and noise. Fourier analysis represents that mixture as contributions from many frequencies.

### 4.2 The Discrete Fourier Transform

Computers process a finite block of `N` samples. The **Discrete Fourier Transform**, or DFT, asks:

> How much of each allowed frequency is present in this block?

Its standard definition is:

```text
X[k] = Σ x[n] · exp(-j 2πkn/N), for n = 0 ... N-1
```

You do not need to calculate this equation by hand. Its parts mean:

- `x[n]` is sample `n` from the waveform;
- `k` selects a frequency bin;
- `X[k]` is a complex number describing that bin;
- `|X[k]|` is the frequency's magnitude; and
- the angle of `X[k]` is its phase.

Apollo needs the magnitude because it indicates how strongly each frequency is present. The
current fingerprint does not use phase.

For sample rate `F_s` and transform size `N`, frequency bin `k` represents approximately:

```text
frequency(k) = k · F_s / N
```

With Apollo's `F_s = 22,050` and `N = 2,048`, adjacent bins are about:

```text
22,050 / 2,048 = 10.77 Hz apart
```

Because the input waveform is real-valued, the negative-frequency half mirrors the positive half.
Only `N/2 + 1 = 1,025` bins from 0 to 11,025 Hz are needed.

### 4.3 FFT is an algorithm for computing the DFT

The **Fast Fourier Transform**, or FFT, is not a different physical transform. It is an efficient
algorithm for calculating the DFT.

- A direct DFT needs roughly `N²` operations.
- A typical FFT needs roughly `N log₂N` operations.

The output represents the same frequency information, but the FFT makes repeated analysis of many
audio windows practical.

## 5. Why one FFT for the entire song is not enough

One transform of a complete song can show which frequencies occur somewhere in the song, but it
loses when they occur. Song recognition needs a time-frequency description.

Apollo solves this with the **Short-Time Fourier Transform**, or STFT:

1. take a short window of the waveform;
2. multiply it by a smooth window function;
3. calculate an FFT for that window;
4. move forward by a small hop; and
5. repeat until the audio ends.

Each FFT becomes one time column in a spectrogram.

### 5.1 Apollo's STFT values

| Parameter | Value | Meaning |
|---|---:|---|
| Sample rate | 22,050 Hz | Samples processed per second |
| FFT/window size | 2,048 samples | About 92.88 ms of audio per frame |
| Hop length | 512 samples | About 23.22 ms between frames |
| Frequency-bin spacing | 10.77 Hz | Approximate frequency resolution |

The windows overlap because the hop is one quarter of the window size. Overlap prevents Apollo
from inspecting only disconnected blocks and gives a smoother view of changes over time.

### 5.2 Why use a Hann window?

Cutting a waveform abruptly at a frame boundary creates an artificial discontinuity. In the
frequency domain, that discontinuity spreads energy across nearby bins; this is called spectral
leakage.

A Hann window smoothly reduces both ends of each frame before its FFT. The overlap ensures that
audio near the faded edge of one frame is represented more strongly in neighboring frames.

There is always a trade-off:

- a larger FFT window gives finer frequency resolution but poorer timing precision;
- a smaller window gives finer timing precision but coarser frequency resolution; and
- a smaller hop gives more time measurements but requires more computation.

Apollo's values are initial calibration settings suitable for the teacher demo, not universally
optimal constants.

## 6. The spectrogram and decibels

The STFT returns complex values arranged as:

```text
spectrogram[frequency bin, time frame]
```

Apollo takes the absolute value to obtain magnitude. The magnitude range is large, so it converts
it to decibels relative to the strongest magnitude:

```text
dB = 20 log10(magnitude / strongest magnitude)
```

The strongest point is `0 dB`; smaller values are negative. For example, `-20 dB` means the
amplitude is one tenth of the reference amplitude.

This dB spectrogram is the colored time-frequency image shown by the demo:

- horizontal axis: time;
- vertical axis: frequency; and
- color: magnitude in decibels.

## 7. Spectral peaks and the constellation map

Comparing complete spectrograms would be expensive and sensitive to many small differences.
Apollo keeps only distinctive local maxima, called **spectral peaks**.

For every spectrogram cell, `scipy.ndimage.maximum_filter` examines a neighborhood of:

- 15 frequency bins, approximately 161.5 Hz; and
- 9 time frames, approximately 209 ms.

A cell becomes a peak when:

1. it equals the maximum value in that local neighborhood; and
2. it is at least `-35 dB` relative to the strongest point.

The result is a sparse set of coordinates:

```text
Peak(frequency_bin, time_frame, amplitude_db)
```

Plotting only these coordinates creates the **constellation map**. It resembles stars on a chart:
each point records an important frequency at an important time.

This sparse representation is useful because strong local peaks are more distinctive than every
pixel in the spectrogram, and there are far fewer points to compare.

## 8. Turning peaks into deterministic fingerprints

A single peak is not distinctive enough. Many songs contain energy near the same frequency.
Apollo therefore pairs each peak, called an **anchor**, with nearby peaks, called **targets**.

For each pair it records:

```text
anchor frequency bin
target frequency bin
target time frame - anchor time frame
```

Apollo pairs each anchor with at most 10 targets between 1 and 200 frames later. At the default hop
length, this covers approximately 23 ms to 4.64 seconds after the anchor.

The fingerprint payload is:

```text
fingerprintVersion | anchorFrequencyBin | targetFrequencyBin | deltaFrames
```

The payload is passed to BLAKE2b with an eight-byte digest, producing a 16-character hexadecimal
hash. Python's built-in `hash()` is deliberately not used because its values are randomized
between processes. BLAKE2b gives the same result for the same payload on different runs and
machines.

The stored fingerprint contains:

```text
Fingerprint(hash_value, anchor_frame, version)
```

The absolute anchor frame is stored beside the hash but is not included in the hash. This is
essential: a clip beginning at zero seconds must generate the same hash as the corresponding
pattern occurring later in the full song.

The version field prevents fingerprints made with incompatible configurations from being compared.
There is a theoretical possibility of hash collision with every finite hash, but a 64-bit digest
is sufficient for this small catalog. Larger-scale collision analysis belongs to later evaluation.

## 9. Building the in-memory catalog

For the local teacher demo, each full song in `demo-data/` runs through:

```text
load_audio
→ extract_peaks
→ create_fingerprints
→ store under the filename stem
```

For example, `Cold.wav` is stored under the song ID `Cold`. This local demo catalog is rebuilt in
memory every time the command runs, which keeps the teacher demonstration simple. The integrated
runtime instead uses `backend/app/catalog.py` to persist fingerprints in Supabase; it still never
stores the source audio.

## 10. Matching a query clip

The file in `demo-clip/` goes through exactly the same loading, normalization, STFT, peak, and
fingerprint functions as the catalog songs.

Apollo builds a lookup from each catalog fingerprint hash to the song and anchor frames where that
hash occurs. For every query hash that also exists in the catalog, it computes:

```text
offset frame = catalog anchor frame - query anchor frame
```

Why does this estimate the timestamp? Suppose the query starts at frame `T` in the full song. A
feature at query frame `q` should appear at catalog frame `T + q`. Therefore:

```text
catalog frame - query frame
= (T + q) - q
= T
```

Many matching fingerprints should independently produce the same offset `T`. Apollo gives one vote
to each `(song, offset)` pair and selects the pair with the most votes.

This is why the vote histogram matters. One accidental matching hash creates a small scattered
vote. A real matching clip creates a tall, concentrated peak at one offset.

The winning frame offset is converted to seconds with:

```text
timestamp seconds = offset frame · hop length / sample rate
```

At the default settings, frame 2,584 represents:

```text
2,584 · 512 / 22,050 = 60.00036 seconds
```

The current minimum is five aligned votes. That threshold is enough for the initial demo, but a
larger evaluation catalog is still needed to calibrate reliable no-match behavior and confidence.

## 11. Exact implementation map

### `backend/app/services/signal.py`

This module contains reusable signal-processing logic and has no FastAPI, Supabase, CLI, plotting,
or hard-coded local paths.

| Code element | Responsibility |
|---|---|
| `SignalConfig` | Centralizes all sampling, STFT, peak, pairing, threshold, and version values |
| `AudioData` | Returns normalized samples with their explicit sample rate |
| `Peak` | Represents one time-frequency maximum |
| `PeakExtraction` | Returns both the dB spectrogram and its peaks |
| `Fingerprint` | Stores the deterministic hash, anchor frame, and version |
| `MatchResult` | Stores song ID, timestamp, winning votes, frame offset, and vote histogram data |
| `load_audio` | Decodes, mixes to mono, resamples, validates, and normalizes |
| `extract_peaks` | Computes the STFT/dB spectrogram and selects local maxima |
| `create_fingerprints` | Pairs peaks and generates deterministic BLAKE2b hashes |
| `match_fingerprints` | Looks up equal hashes and performs per-song time-offset voting |

### `backend/app/demo.py`

This is the orchestration and presentation layer. It:

1. reads the clip filename from the command line;
2. safely resolves it inside `demo-clip/`;
3. finds catalog audio in `demo-data/`;
4. calls the reusable signal functions;
5. prints the match result; and
6. saves the explanatory plots.

The CLI accepts a filename rather than an arbitrary path. This keeps the beginning-stage workflow
simple and prevents `../` path traversal from silently reading a file outside `demo-clip/`.

### `backend/app/catalog.py`

This adapter connects the signal services to Supabase. The `app.catalog` command fingerprints one
local song (including a relative path in the sibling `Songs/` folder) and inserts its name, Spotify URL, and fingerprint rows in batches. `recognize_file`
loads matching fingerprint rows, performs the same offset voting, and fetches the matched song
metadata.

### `backend/app/main.py` and `backend/app/supabase_client.py`

FastAPI accepts temporary audio uploads at `POST /songs` and `POST /recognize`. The Supabase client
is created only in the backend from `backend/.env`; the frontend never receives the service key.

### `frontend/app/page.tsx` and `frontend/lib/api.ts`

The browser records ten seconds from the microphone, encodes mono WAV, sends it through the
Next.js `/backend/*` rewrite, and displays the matched song, Spotify URL, and source timestamp.

### Tests

`backend/tests/test_signal.py` verifies:

- stereo-to-mono conversion, resampling, and normalization;
- STFT spectrogram and peak extraction;
- deterministic fingerprints; and
- correct song/timestamp recovery from aligned hashes.

`backend/tests/test_demo.py` creates synthetic songs and an independently saved clip whose starting
sample is intentionally not aligned to an STFT hop. It verifies the correct source, timestamp, and
plot files. The tests use generated signals so no copyrighted audio enters Git.

## 12. Central configuration values

All important values live in one `SignalConfig` object:

| Field | Current value | Purpose |
|---|---:|---|
| `sample_rate` | 22,050 | Common samples per second |
| `n_fft` | 2,048 | Samples analyzed in each STFT frame |
| `hop_length` | 512 | Samples advanced between frames |
| `peak_neighborhood_frequency_bins` | 15 | Local-maximum width in frequency |
| `peak_neighborhood_time_frames` | 9 | Local-maximum width in time |
| `peak_amplitude_threshold_db` | -35 | Ignores weak spectrogram cells |
| `fan_out` | 10 | Maximum targets paired with each anchor |
| `min_time_delta_frames` | 1 | Nearest allowed target |
| `max_time_delta_frames` | 200 | Farthest allowed target |
| `match_threshold` | 5 | Minimum winning aligned votes |
| `fingerprint_version` | `"1"` | Compatibility marker for fingerprints |

These are calibration knobs because real audio is imperfect. Evaluation should measure recognition
behavior before changing them. Once fingerprints are persisted, changing hash-related values also
requires a new fingerprint version and regenerated catalog rows.

## 13. Running the teacher demonstration

### Prepare the inputs

1. Keep at least two full songs in `demo-data/`.
2. Export a clean 5–10 second excerpt from one of those exact recordings.
3. Put that short file in `demo-clip/`, for example `cold-sample.wav`.
4. Keep both directories local. Their audio is ignored by Git.

Standard PCM WAV is the safest demonstration format. The clip may be mono or stereo and may use a
different sample rate because `load_audio` normalizes the representation.

At this stage, use an excerpt from the exact catalog recording. A cover, live version, humming,
speaker recording, or independently performed version is not expected to match.

### Run it

From the `backend/` directory with `.venv` activated:

```bash
python -m app.demo "cold-sample.wav"
```

The output has this form:

```text
Query clip: cold-sample.wav
Predicted song: Cold
Estimated timestamp: 1 min 0 sec
Aligned fingerprint votes: 10525
Plots saved to: .../Apollo/artifacts/stage1
```

The recorded Stage 1 acceptance run used an eight-second clip from `Cold.wav` near 60 seconds. It
returned `Cold`, estimated `60.00` seconds, and produced 10,525 aligned votes.

### Generated figures

`artifacts/stage1/signal_pipeline.png` contains:

1. **Normalized waveform** — amplitude changing over time.
2. **STFT spectrogram** — frequency magnitude changing over time.
3. **Spectral peak detection** — retained peaks over the spectrogram.
4. **Constellation map** — only the sparse time-frequency landmarks.

`artifacts/stage1/offset_votes.png` shows candidate timestamps. The tall peak marks the offset where
many query fingerprints align with the catalog song.

## 14. What to explain while showing the figures

### Waveform

> This is amplitude versus time. It contains all the audio information, but it is difficult to
> compare songs directly because a time shift moves every sample.

### Spectrogram

> I divide the waveform into overlapping 2,048-sample windows. An FFT converts each window from
> samples into frequency magnitudes. Placing those FFT results side by side gives frequency versus
> time, with color representing strength.

### Peaks and constellation map

> I keep only strong local maxima. These sparse landmarks are more distinctive and cheaper to
> compare than the entire spectrogram. Their scatter plot is called a constellation map.

### Fingerprints

> I pair each anchor peak with nearby target peaks. The two frequency bins and their time difference
> form a deterministic hash. Absolute time is stored separately, so the same pattern has the same
> hash even when a short clip starts from zero.

### Vote histogram

> Every equal query/catalog hash suggests a song and time offset. Correct hashes agree on the same
> offset, creating the tall histogram peak. That winning offset becomes the estimated timestamp.

## 15. A short presentation script

> Apollo recognizes a short clip by extracting stable time-frequency landmarks. First, I decode
> every input in exactly the same way: mono, 22,050 Hz, and peak-normalized. A raw waveform only
> shows amplitude over time, so I use a Short-Time Fourier Transform. The STFT runs an FFT over
> overlapping windows and produces a spectrogram showing which frequencies occur at each time.
>
> I then retain strong local spectral peaks. These points form a constellation map. A single point
> is not unique enough, so I pair anchor peaks with nearby target peaks and hash the two frequencies
> plus their time difference. The hash is deterministic, while the anchor's absolute time is stored
> separately.
>
> I fingerprint the full songs and the query clip using the same functions. Whenever hashes match,
> I subtract the query anchor time from the catalog anchor time. Correct matches repeatedly produce
> the same difference, so they create a strong peak in the time-offset histogram. The peak identifies
> both the song and the clip's position. In the verified demo, an eight-second clip matched `Cold`
> at 60.00 seconds with 10,525 aligned fingerprint votes.

## 16. Likely teacher questions

### Is FFT different from the Fourier transform?

The DFT is the mathematical transformation applied to a finite set of samples. FFT is a family of
efficient algorithms used to calculate that DFT.

### Why not compare waveforms directly?

Direct samples change position when the clip starts later, and they are sensitive to gain and other
small changes. Sparse time-frequency patterns can be matched using relative timing.

### Why use STFT instead of one FFT?

One FFT says which frequencies occur in the complete signal but loses when they occur. STFT repeats
the FFT over short overlapping windows, preserving time information.

### Why does Apollo use decibels?

Spectral magnitudes span a large range. A logarithmic dB scale makes strong and weaker components
easier to compare and gives a meaningful relative threshold.

### Why keep only peaks?

Peaks are sparse, distinctive landmarks. This reduces the amount of data and avoids comparing every
spectrogram cell.

### Why pair peaks?

One frequency at one time is common. A pair containing two frequencies and their time difference is
far more specific.

### Why not use Python's `hash()`?

Python intentionally randomizes its built-in hash between processes. BLAKE2b is deterministic, so
identical fingerprint inputs produce identical stored values across runs and machines.

### How is the timestamp calculated?

Each matching hash votes for `catalog anchor frame - query anchor frame`. The strongest common frame
offset is converted to seconds using `offset × hop_length / sample_rate`.

### Does it recognize humming or covers?

No. This fingerprint represents spectral landmarks from the same recording. Hum recognition needs
a separate pitch-sequence algorithm such as dynamic time warping and is deliberately deferred.

### Is it already robust to noise and phone recordings?

Not proven comprehensively yet. The constellation method is intended to retain useful peaks under
some distortion, but the current acceptance checks use synthetic signals and clean clips. A larger
evaluation should measure short clips, gain changes, noise, unrelated audio, repeatability, and
multiple formats before making a robustness claim.

### Why is the catalog rebuilt each run?

The local teacher demo rebuilds a small catalog each run to keep the signal algorithm visible. The
integrated path now persists fingerprints and performs indexed lookup through Supabase; the two
paths intentionally share the same signal functions.

## 17. Current limitations and next work

The current implementation is intentionally small:

- the local teaching demo keeps fingerprints in memory, while the integrated catalog uses Supabase;
- there is no browser catalog-management screen;
- the demo expects a clip from the exact recording;
- confidence and no-match behavior are not yet calibrated against a large evaluation catalog;
- cross-platform format coverage, noise, gain changes, and 3/5/10-second clips still need broader
  benchmarks; and
- parameters are initial values rather than measured optimums.

Next work is evaluation and operational hardening. FastAPI, Supabase, and the browser already use
the same reusable signal functions; advanced plots, authentication, deployment, and hum search are
still deferred.

## 18. Glossary

| Term | Plain-language meaning |
|---|---|
| Sample | One digital measurement of waveform amplitude |
| Sample rate | Number of samples per second |
| Time domain | Amplitude represented against time |
| Frequency | Number of repeating cycles per second, measured in hertz |
| DFT | Mathematical conversion from samples to discrete frequency components |
| FFT | Efficient algorithm for computing the DFT |
| STFT | FFT repeated over short overlapping windows |
| Hann window | Smooth weighting that reduces frame-edge spectral leakage |
| Frequency bin | One discrete frequency position in an FFT result |
| Magnitude | Strength of a frequency component |
| Decibel | Logarithmic relative level |
| Spectrogram | Frequency magnitude plotted over time |
| Spectral peak | Strong local maximum in a spectrogram |
| Constellation map | Sparse plot of spectral peaks in time and frequency |
| Anchor-target pair | Two nearby peaks used to create a fingerprint |
| Fingerprint | Compact deterministic description of a local audio pattern |
| Hash | Fixed-size identifier derived from fingerprint values |
| Offset vote | Evidence for a particular song and query start time |

## 19. References

- Avery Li-Chun Wang, [*An Industrial-Strength Audio Search Algorithm*](https://doi.org/10.5281/zenodo.1416340), ISMIR 2003.
- [NumPy discrete Fourier transform documentation](https://numpy.org/doc/stable/reference/routines.fft.html)
- [NumPy FFT frequency-bin documentation](https://numpy.org/doc/stable/reference/generated/numpy.fft.fftfreq.html)
- [librosa audio-loading documentation](https://librosa.org/doc/latest/generated/librosa.load.html)
- [librosa STFT documentation](https://librosa.org/doc/latest/generated/librosa.stft.html)
- [librosa amplitude-to-decibel documentation](https://librosa.org/doc/latest/generated/librosa.amplitude_to_db.html)
- [SciPy maximum-filter documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.ndimage.maximum_filter.html)
- [Python BLAKE2 documentation](https://docs.python.org/3/library/hashlib.html#blake2)
- [Matplotlib figure documentation](https://matplotlib.org/stable/api/figure_api.html)
