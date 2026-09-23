# Signal-processing guide

Apollo uses one deterministic pipeline for both catalog songs and microphone queries:

```text
decode → mono/resample → normalize → STFT → dB spectrogram → local peaks
       → anchor/target pairs → BLAKE2b fingerprints → offset voting
```

`backend/app/services/signal.py` owns the implementation and `SignalConfig` owns every calibrated
parameter. Catalog and query fingerprints must use the same explicit `fingerprint_version`.

Each fingerprint combines the anchor frequency bin, target frequency bin, and frame delta. BLAKE2b
produces a deterministic 64-bit value represented as 16 lowercase hexadecimal characters. Signal
code keeps that representation; the SQLite adapter maps it losslessly to a signed 64-bit integer.

Recognition queries SQLite only for hashes present in the microphone clip. The existing matcher
then votes on `(song_id, catalog_anchor_frame - query_anchor_frame)` and accepts a winner only when
it clears the absolute vote, normalized support, and runner-up separation gates. The source
timestamp is the winning frame offset multiplied by `hop_length / sample_rate`.

Do not tune the algorithm from intuition. Generate the catalog, measure clean/short/noisy clips,
record timestamp error and timing, then change one centralized parameter at a time. Any change that
alters hashes requires a new fingerprint version and full catalog regeneration.
