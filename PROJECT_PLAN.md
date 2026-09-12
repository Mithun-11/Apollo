# Apollo project plan

## Goal

Recognize songs from short audio clips, estimate the source timestamp, and visibly explain the
signal-processing pipeline.

## Current architecture

```text
microphone UI → Next.js proxy → FastAPI → signal services
                                     ├→ SQLite indexed fingerprint lookup
                                     └→ explanation service
```

The local SQLite database is the canonical catalog. Existing remote fingerprint records are not
migrated; each developer generates or receives the same separately distributed database snapshot.

## Completed baseline

- Deterministic versioned constellation fingerprints.
- Absolute, normalized-support, and runner-up match gates.
- SQLite schema with integer song IDs, cascade deletion, duplicate protection, and an index on
  `(fingerprint_version, hash_value)`.
- Lossless mapping between 16-digit hexadecimal hashes and signed 64-bit SQLite integers.
- Transactional bulk catalog insertion and batched indexed recognition lookup.
- FastAPI song ingestion, recognition, and explainability routes.
- Next.js microphone recording and explanation dashboard.
- Exact Python and npm environments with backend and frontend quality checks.

## Next work

1. Generate the new SQLite catalog from the legal local song set.
2. Distribute one identical `data/apollo.db` snapshot to both developers outside Git.
3. Measure fingerprint generation, database lookup, scoring, and total recognition time on that
   catalog before considering further optimization.
4. Run clean, short, gain-adjusted, and noisy clip evaluation and record accuracy/timestamp error.
5. Verify setup and the generated snapshot on Windows and macOS.
6. Prepare the final signal-processing demonstration and presentation.

Hum search, authentication, deployment, containers, background workers, ORMs, and additional
databases remain out of scope until a demonstrated requirement justifies them.
