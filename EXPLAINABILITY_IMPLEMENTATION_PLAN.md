# Explainability status

The explainability baseline is implemented by `POST /recognize/explain` without changing the
compact `POST /recognize` contract.

The response contains bounded waveform, spectrogram, peak, matched-fingerprint alignment,
time-offset vote, source-interval, and pipeline-count data. It never returns raw audio or
fingerprint hashes. SQLite replaces only catalog persistence and lookup; explanation and matching
continue to consume ordinary fingerprint records.

Remaining work is evidence collection, not another implementation layer:

1. Generate the shared SQLite catalog.
2. Measure fingerprint generation, indexed lookup, scoring, and total request time.
3. Evaluate clean, short, gain-adjusted, noisy, unrelated, and ambiguous clips.
4. Add candidate comparison or per-stage UI timings only if the measurements show they improve the
   final demonstration.
