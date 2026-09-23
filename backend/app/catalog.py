from __future__ import annotations

import argparse
import sqlite3
from collections.abc import Sequence
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from .database import (
    connect_database,
    db_int_to_fingerprint_hex,
    fingerprint_hex_to_db_int,
)
from .services.explanation import (
    build_offset_vote_display,
    build_peak_display,
    build_spectrogram_display,
    build_waveform_envelope,
    build_winning_fingerprint_evidence,
)
from .services.signal import (
    DEFAULT_CONFIG,
    Fingerprint,
    FingerprintTrace,
    Float64Array,
    FloatArray,
    MatchResult,
    Peak,
    SignalConfig,
    analyze_fingerprint_match,
    create_fingerprints,
    create_fingerprints_with_traces,
    extract_peaks,
    load_audio,
    match_fingerprints,
)
from .services.speed_search import (
    UNCHANGED,
    PlaybackChange,
    map_evidence_to_recording,
    search_playback_speeds,
)

FINGERPRINT_BATCH_SIZE = 500
SUPPORTED_AUDIO_EXTENSIONS = {".flac", ".mp3", ".ogg", ".wav"}
PROJECT_ROOT = Path(__file__).resolve().parents[2]
SONGS_DIR = PROJECT_ROOT.parent / "Songs"


@dataclass(frozen=True, slots=True)
class QueryAnalysis:
    samples: FloatArray
    sample_rate: int
    spectrogram_db: Float64Array
    peaks: tuple[Peak, ...]
    fingerprints: tuple[Fingerprint, ...]
    traces: tuple[FingerprintTrace, ...]


def resolve_catalog_audio(path: Path) -> Path:
    if path.is_absolute():
        return path

    relative_song = path
    if path.parts and path.parts[0].lower() == "songs":
        relative_song = Path(*path.parts[1:])
    candidates = (Path.cwd() / path, PROJECT_ROOT / path, SONGS_DIR / relative_song)
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    locations = ", ".join(str(candidate) for candidate in candidates)
    raise FileNotFoundError(f"Audio file not found; checked: {locations}")


def validate_spotify_url(value: str) -> str:
    url = value.strip()
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in {"open.spotify.com", "www.spotify.com"}:
        raise ValueError("spotify_url must be an https://open.spotify.com URL")
    return url


def fingerprint_file(path: Path, config: SignalConfig = DEFAULT_CONFIG) -> tuple[Fingerprint, ...]:
    _validate_audio_path(path)
    audio = load_audio(path, config)
    return create_fingerprints(extract_peaks(audio.samples, config).peaks, config)


def analyze_query_file(path: Path, config: SignalConfig = DEFAULT_CONFIG) -> QueryAnalysis:
    """Decode and analyze a query exactly once for recognition explanations."""
    _validate_audio_path(path)
    audio = load_audio(path, config)
    extraction = extract_peaks(audio.samples, config)
    fingerprints, traces = create_fingerprints_with_traces(extraction.peaks, config)
    return QueryAnalysis(
        samples=audio.samples,
        sample_rate=audio.sample_rate,
        spectrogram_db=extraction.spectrogram_db,
        peaks=extraction.peaks,
        fingerprints=fingerprints,
        traces=traces,
    )


def fetch_matching_catalog(
    query: Sequence[Fingerprint],
    connection: sqlite3.Connection,
    config: SignalConfig = DEFAULT_CONFIG,
) -> dict[str, list[Fingerprint]]:
    """Fetch only catalog fingerprints whose hashes occur in the query."""
    if not query:
        return {}

    hashes = sorted({fingerprint_hex_to_db_int(fingerprint.hash_value) for fingerprint in query})
    catalog: dict[str, list[Fingerprint]] = {}
    for start in range(0, len(hashes), FINGERPRINT_BATCH_SIZE):
        batch = hashes[start : start + FINGERPRINT_BATCH_SIZE]
        placeholders = ",".join("?" for _ in batch)
        rows = connection.execute(
            f"""
            SELECT song_id, fingerprint_version, hash_value, anchor_frame
            FROM acoustic_fingerprints
            WHERE fingerprint_version = ? AND hash_value IN ({placeholders})
            """,
            (config.fingerprint_version, *batch),
        )
        for row in rows:
            song_id = str(row["song_id"])
            catalog.setdefault(song_id, []).append(
                Fingerprint(
                    db_int_to_fingerprint_hex(row["hash_value"]),
                    int(row["anchor_frame"]),
                    str(row["fingerprint_version"]),
                )
            )
    return catalog


def build_fingerprint_rows(
    song_id: int, fingerprints: Sequence[Fingerprint]
) -> list[tuple[int, str, int, int]]:
    return [
        (
            song_id,
            fingerprint.version,
            fingerprint_hex_to_db_int(fingerprint.hash_value),
            fingerprint.anchor_frame,
        )
        for fingerprint in fingerprints
    ]


def ingest_song(
    path: Path,
    name: str,
    spotify_url: str,
    connection: sqlite3.Connection,
    config: SignalConfig = DEFAULT_CONFIG,
) -> dict[str, object]:
    song_name = name.strip()
    if not song_name:
        raise ValueError("name is required")
    link = validate_spotify_url(spotify_url)
    fingerprints = fingerprint_file(path, config)
    if not fingerprints:
        raise ValueError("no fingerprints were generated from the audio")

    with connection:
        cursor = connection.execute(
            "INSERT INTO songs (name, spotify_url) VALUES (?, ?)",
            (song_name, link),
        )
        song_id = cursor.lastrowid
        if song_id is None:
            raise RuntimeError("SQLite did not return the inserted song ID")
        rows = build_fingerprint_rows(song_id, fingerprints)
        connection.executemany(
            """
            INSERT INTO acoustic_fingerprints
                (song_id, fingerprint_version, hash_value, anchor_frame)
            VALUES (?, ?, ?, ?)
            """,
            rows,
        )
    return {
        "id": str(song_id),
        "name": song_name,
        "spotifyUrl": link,
        "fingerprintCount": len(fingerprints),
    }


def recognize_file(
    path: Path, connection: sqlite3.Connection, config: SignalConfig = DEFAULT_CONFIG
) -> dict[str, object]:
    query = fingerprint_file(path, config)
    if not query:
        return _no_match()
    catalog = fetch_matching_catalog(query, connection, config)
    result = match_fingerprints(query, catalog, config)
    if result is not None:
        return _recognition_response(result, len(query), _fetch_song(result.song_id, connection))

    # The query is decoded again only on this fallback path, keeping the common path unchanged.
    audio = load_audio(path, config)
    speed_match = search_playback_speeds(
        extract_peaks(audio.samples, config).peaks,
        len(audio.samples) / audio.sample_rate,
        lambda fingerprints: fetch_matching_catalog(fingerprints, connection, config),
        config,
    )
    if speed_match is None:
        return _no_match()
    return _recognition_response(
        speed_match.result,
        len(speed_match.fingerprints),
        _fetch_song(speed_match.result.song_id, connection),
        speed_match.change,
    )


def recognize_file_with_explanation(
    path: Path, connection: sqlite3.Connection, config: SignalConfig = DEFAULT_CONFIG
) -> dict[str, object]:
    """Recognize a query and return bounded signal and matching evidence."""
    analysis = analyze_query_file(path, config)
    query_duration_seconds = len(analysis.samples) / analysis.sample_rate
    query_fingerprints = analysis.fingerprints
    query_traces = analysis.traces
    change = UNCHANGED
    catalog = fetch_matching_catalog(query_fingerprints, connection, config)
    diagnostics = analyze_fingerprint_match(query_fingerprints, catalog, config)
    result = diagnostics.result
    if result is None:
        speed_match = search_playback_speeds(
            analysis.peaks,
            query_duration_seconds,
            lambda fingerprints: fetch_matching_catalog(fingerprints, connection, config),
            config,
        )
        if speed_match is not None:
            result = speed_match.result
            change = speed_match.change
            query_fingerprints = speed_match.fingerprints
            query_traces = speed_match.traces
            catalog = {song: list(prints) for song, prints in speed_match.catalog.items()}
            diagnostics = analyze_fingerprint_match(query_fingerprints, catalog, config)

    catalog_hashes = {
        fingerprint.hash_value
        for fingerprints in catalog.values()
        for fingerprint in fingerprints
    }
    matching_hashes = len(
        {fingerprint.hash_value for fingerprint in query_fingerprints} & catalog_hashes
    )

    if result is None:
        recognition = _no_match()
        matched_fingerprints: list[dict[str, float]] = []
        offset_votes: list[dict[str, object]] = []
        source_interval: dict[str, float] | None = None
        winning_traces: tuple[FingerprintTrace, ...] = ()
    else:
        song = _fetch_song(result.song_id, connection)
        recognition = _recognition_response(result, len(query_fingerprints), song, change)
        # Speed-search evidence is on the song's timeline; the display uses the recording's.
        winning_evidence = map_evidence_to_recording(
            build_winning_fingerprint_evidence(
                query_traces,
                catalog.get(result.song_id, []),
                result.offset_frame,
                config,
            ),
            analysis.peaks,
            change,
        )
        winning_traces = winning_evidence.traces
        matched_fingerprints = [
            {
                "queryAnchorSeconds": match.query_anchor_seconds,
                "queryTargetSeconds": match.query_target_seconds,
                "sourceAnchorSeconds": match.source_anchor_seconds,
                "sourceTargetSeconds": match.source_target_seconds,
                "anchorFrequencyHz": match.anchor_frequency_hz,
                "targetFrequencyHz": match.target_frequency_hz,
            }
            for match in winning_evidence.matched_fingerprints
        ]
        offset_votes = [
            {
                "offsetSeconds": vote.offset_seconds,
                "count": vote.count,
                "winning": vote.winning,
            }
            for vote in build_offset_vote_display(
                result.offset_votes,
                result.offset_frame,
                config,
            )
        ]
        source_interval = {
            "startSeconds": result.timestamp_seconds,
            "endSeconds": result.timestamp_seconds + query_duration_seconds * change.speed_factor,
        }

    waveform = build_waveform_envelope(analysis.samples, analysis.sample_rate)
    spectrogram = build_spectrogram_display(
        analysis.spectrogram_db,
        query_duration_seconds,
        config,
    )
    peaks = build_peak_display(
        analysis.peaks,
        config,
        matched_traces=winning_traces,
    )
    frame_seconds = config.hop_length / config.sample_rate
    frequency_hz_per_bin = config.sample_rate / config.n_fft
    pair_step = max(1, len(analysis.traces) // 12)
    pair_examples = [
        {
            "anchorSeconds": trace.fingerprint.anchor_frame * frame_seconds,
            "targetSeconds": trace.target_frame * frame_seconds,
            "anchorFrequencyHz": trace.anchor_frequency_bin * frequency_hz_per_bin,
            "targetFrequencyHz": trace.target_frequency_bin * frequency_hz_per_bin,
            "deltaFrames": trace.target_frame - trace.fingerprint.anchor_frame,
        }
        for trace in analysis.traces[::pair_step][:12]
    ]
    leading = diagnostics.leading
    candidate_votes = [
        {
            "songName": _fetch_song(candidate.song_id, connection)["name"],
            "votes": candidate.votes,
            "offsetSeconds": candidate.offset_frame * frame_seconds,
        }
        for candidate in diagnostics.candidates[:3]
    ]
    clustered_offset_votes = (
        build_offset_vote_display(
            diagnostics.clustered_offset_votes,
            leading.offset_frame,
            config,
        )
        if leading is not None
        else []
    )
    return {
        "recognition": recognition,
        "explanation": {
            "queryDurationSeconds": query_duration_seconds,
            "sampleRate": analysis.sample_rate,
            "waveformEnvelope": [
                {
                    "timeSeconds": point.time_seconds,
                    "minimum": point.minimum,
                    "maximum": point.maximum,
                }
                for point in waveform
            ],
            "spectrogram": {
                "valuesDb": spectrogram.values_db,
                "minimumDb": spectrogram.minimum_db,
                "maximumDb": spectrogram.maximum_db,
                "maximumFrequencyHz": spectrogram.maximum_frequency_hz,
                "durationSeconds": spectrogram.duration_seconds,
            },
            "peaks": [
                {
                    "timeSeconds": peak.time_seconds,
                    "frequencyHz": peak.frequency_hz,
                    "amplitudeDb": peak.amplitude_db,
                    "matched": peak.matched,
                }
                for peak in peaks
            ],
            "matchedFingerprints": matched_fingerprints,
            "offsetVotes": offset_votes,
            "sourceInterval": source_interval,
            "counts": {
                "peaks": len(analysis.peaks),
                "fingerprints": len(analysis.fingerprints),
                "lookupFingerprints": len(query_fingerprints),
                "matchingHashes": matching_hashes,
                "winningVotes": result.match_count if result is not None else 0,
            },
            "matchThreshold": config.match_threshold,
            "signalConfig": {
                "fftSize": config.n_fft,
                "hopLength": config.hop_length,
                "minimumFrequencyHz": config.min_frequency_hz,
                "maximumFrequencyHz": config.max_frequency_hz,
                "peakFloorDb": config.peak_amplitude_threshold_db,
                "peaksPerSecond": config.peaks_per_second,
                "fanOut": config.fan_out,
                "fingerprintVersion": config.fingerprint_version,
            },
            "pairExamples": pair_examples,
            "decision": {
                "reason": diagnostics.reason,
                "leadingVotes": leading.votes if leading is not None else 0,
                "leadingOffsetSeconds": (
                    leading.offset_frame * frame_seconds if leading is not None else None
                ),
                "runnerUpVotes": diagnostics.runner_up_votes,
                "minimumVotes": config.match_threshold,
                "minimumWinnerRatio": config.min_winner_ratio,
                "offsetToleranceFrames": config.offset_tolerance_frames,
                "clusteredOffsetVotes": [
                    {
                        "offsetSeconds": vote.offset_seconds,
                        "count": vote.count,
                        "winning": vote.winning,
                    }
                    for vote in clustered_offset_votes
                ],
            },
            "candidateVotes": candidate_votes,
            "processingTimesMs": None,
        },
    }


def _validate_audio_path(path: Path) -> None:
    if path.suffix.lower() not in SUPPORTED_AUDIO_EXTENSIONS:
        raise ValueError("audio must be WAV, MP3, FLAC, or OGG")


def _fetch_song(song_id: str, connection: sqlite3.Connection) -> dict[str, str]:
    song = connection.execute(
        "SELECT id, name, spotify_url FROM songs WHERE id = ?",
        (int(song_id),),
    ).fetchone()
    if song is None:
        raise RuntimeError("Matched song metadata is missing")
    return {
        "id": str(song["id"]),
        "name": str(song["name"]),
        "spotifyUrl": str(song["spotify_url"]),
    }


def _recognition_response(
    result: MatchResult,
    query_fingerprint_count: int,
    song: dict[str, str],
    change: PlaybackChange = UNCHANGED,
) -> dict[str, object]:
    return {
        "matched": True,
        "song": song,
        "timestampSeconds": result.timestamp_seconds,
        "confidence": min(1.0, result.match_count / query_fingerprint_count),
        "matchCount": result.match_count,
        "speedFactor": change.speed_factor,
        "pitchFactor": change.pitch_factor,
    }


def _no_match() -> dict[str, object]:
    return {
        "matched": False,
        "song": None,
        "timestampSeconds": None,
        "confidence": 0.0,
        "matchCount": 0,
        "speedFactor": None,
        "pitchFactor": None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fingerprint a local song into SQLite")
    parser.add_argument("audio", type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--spotify-url", required=True)
    args = parser.parse_args()
    with closing(connect_database()) as connection:
        result = ingest_song(
            resolve_catalog_audio(args.audio),
            args.name,
            args.spotify_url,
            connection,
        )
    print(f"Stored {result['name']} with {result['fingerprintCount']} fingerprints")


if __name__ == "__main__":
    main()
