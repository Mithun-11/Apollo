"""Melody-feature storage, the melody recognition fallback, and the command that builds features.

Build features for songs already in the database (needs requirements-melody.txt):

    python -m app.melody_catalog              # songs without features
    python -m app.melody_catalog --rebuild    # recompute every song

Each audio file in the Songs folder is identified by its fingerprints, so no file names or
manual mapping are needed. Existing tables are never modified; features live in their own table.
"""

from __future__ import annotations

import argparse
import io
import sqlite3
import sys
import time
from contextlib import closing
from pathlib import Path

import librosa

from .database import connect_database
from .services import vocal_separation
from .services.melody_match import (
    DEFAULT_MELODY_CONFIG,
    MelodyConfig,
    MelodyFeatures,
    MelodyMatch,
    extract_features,
    features_from_blobs,
    features_to_blobs,
    match_melody,
)
from .services.signal import (
    DEFAULT_CONFIG,
    SignalConfig,
    create_fingerprints,
    extract_peaks,
    load_audio,
    match_fingerprints,
)

MELODY_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS melody_features (
    song_id INTEGER PRIMARY KEY,
    feature_version TEXT NOT NULL,
    melody BLOB NOT NULL,
    vocal_chroma BLOB NOT NULL,
    mix_chroma BLOB NOT NULL,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
)
"""
IDENTIFY_EXCERPT_SECONDS = 30.0


def ensure_melody_table(connection: sqlite3.Connection) -> None:
    with connection:
        connection.execute(MELODY_TABLE_SQL)


def has_melody_table(connection: sqlite3.Connection) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'melody_features'"
    ).fetchone()
    return row is not None


def store_melody_features(
    song_id: int,
    features: MelodyFeatures,
    connection: sqlite3.Connection,
    config: MelodyConfig = DEFAULT_MELODY_CONFIG,
) -> None:
    ensure_melody_table(connection)
    melody, vocal_chroma, mix_chroma = features_to_blobs(features)
    with connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO melody_features
                (song_id, feature_version, melody, vocal_chroma, mix_chroma)
            VALUES (?, ?, ?, ?, ?)
            """,
            (song_id, config.feature_version, melody, vocal_chroma, mix_chroma),
        )


def load_melody_catalog(
    connection: sqlite3.Connection, config: MelodyConfig = DEFAULT_MELODY_CONFIG
) -> dict[str, MelodyFeatures]:
    if not has_melody_table(connection):
        return {}
    rows = connection.execute(
        """
        SELECT song_id, melody, vocal_chroma, mix_chroma
        FROM melody_features
        WHERE feature_version = ?
        """,
        (config.feature_version,),
    )
    return {
        str(row["song_id"]): features_from_blobs(
            row["melody"], row["vocal_chroma"], row["mix_chroma"]
        )
        for row in rows
    }


def recognize_melody(
    path: Path,
    connection: sqlite3.Connection,
    config: MelodyConfig = DEFAULT_MELODY_CONFIG,
) -> MelodyMatch | None:
    """Last-resort recognition of a different performance (cover, live, crowd) of a song.

    Returns None without doing any work when Demucs is not installed, the query is too short,
    or the catalog has no melody features.
    """
    if not vocal_separation.is_available():
        return None
    duration_seconds = float(librosa.get_duration(path=path))
    if duration_seconds < config.min_query_seconds:
        return None
    catalog = load_melody_catalog(connection, config)
    if len(catalog) < config.min_catalog_songs:
        return None
    separated = vocal_separation.separate_file(path, config.sample_rate)
    query = extract_features(separated.vocals, separated.mix, config)
    return match_melody(query, duration_seconds, catalog, config)


def melody_recognition_response(match: MelodyMatch, song: dict[str, str]) -> dict[str, object]:
    """Recognition payload for a melody match; the fingerprint-only fields stay neutral."""
    return {
        "matched": True,
        "song": song,
        "timestampSeconds": match.timestamp_seconds,
        "confidence": min(1.0, match.score_gap / 3.0),
        "matchCount": 0,
        "speedFactor": None,
        "pitchFactor": None,
        "matchMethod": "melody",
        "melodyScoreGap": match.score_gap,
        "keyShiftSemitones": match.key_shift_semitones,
    }


def identify_catalog_song(
    path: Path, connection: sqlite3.Connection, config: SignalConfig = DEFAULT_CONFIG
) -> str | None:
    """Find which catalog song an audio file is, from a fingerprinted excerpt of its middle."""
    from .catalog import fetch_matching_catalog

    audio = load_audio(path, config)
    middle = len(audio.samples) // 2
    half = int(IDENTIFY_EXCERPT_SECONDS * audio.sample_rate / 2)
    excerpt = audio.samples[max(0, middle - half) : middle + half]
    query = create_fingerprints(extract_peaks(excerpt, config).peaks, config)
    result = match_fingerprints(query, fetch_matching_catalog(query, connection, config), config)
    return None if result is None else result.song_id


def build_melody_features(
    songs_dir: Path,
    connection: sqlite3.Connection,
    rebuild: bool = False,
    config: MelodyConfig = DEFAULT_MELODY_CONFIG,
) -> list[tuple[str, str | None, str]]:
    """Compute and store melody features for catalog songs found in ``songs_dir``."""
    from .catalog import SUPPORTED_AUDIO_EXTENSIONS

    ensure_melody_table(connection)
    done = {
        str(row["song_id"])
        for row in connection.execute(
            "SELECT song_id FROM melody_features WHERE feature_version = ?",
            (config.feature_version,),
        )
    }
    report: list[tuple[str, str | None, str]] = []
    for path in sorted(songs_dir.iterdir()):
        if path.suffix.lower() not in SUPPORTED_AUDIO_EXTENSIONS:
            continue
        song_id = identify_catalog_song(path, connection)
        if song_id is None:
            report.append((path.name, None, "not in the database, skipped"))
            continue
        if song_id in done and not rebuild:
            report.append((path.name, song_id, "already has melody features"))
            continue
        started = time.perf_counter()
        separated = vocal_separation.separate_file(path, config.sample_rate)
        store_melody_features(
            int(song_id), extract_features(separated.vocals, separated.mix, config), connection
        )
        done.add(song_id)
        report.append((path.name, song_id, f"stored ({time.perf_counter() - started:.1f}s)"))
    return report


def main() -> None:
    from .catalog import SONGS_DIR

    parser = argparse.ArgumentParser(description="Build melody features for catalog songs")
    parser.add_argument("--songs-dir", type=Path, default=SONGS_DIR)
    parser.add_argument("--rebuild", action="store_true", help="recompute existing features")
    args = parser.parse_args()
    if isinstance(sys.stdout, io.TextIOWrapper):
        # Song file names can hold characters (e.g. Bengali) a Windows console cannot encode.
        sys.stdout.reconfigure(errors="replace")
    if not vocal_separation.is_available():
        raise SystemExit(
            "Install the optional packages first: pip install -r requirements-melody.txt"
        )
    with closing(connect_database()) as connection:
        for name, song_id, status in build_melody_features(
            args.songs_dir, connection, rebuild=args.rebuild
        ):
            print(f"{'song ' + song_id if song_id else '-':>8}  {name}: {status}", flush=True)


if __name__ == "__main__":
    main()
