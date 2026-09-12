from __future__ import annotations

import argparse
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlparse
from uuid import uuid4

from postgrest.types import CountMethod
from rich.progress import Progress
from supabase import Client

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
    create_fingerprints,
    create_fingerprints_with_traces,
    extract_peaks,
    load_audio,
    match_fingerprints,
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


@dataclass(frozen=True, slots=True)
class CatalogCache:
    songs: dict[str, dict[str, str]]
    fingerprints: dict[str, list[Fingerprint]]

    @property
    def fingerprint_count(self) -> int:
        return sum(len(fingerprints) for fingerprints in self.fingerprints.values())


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


def load_catalog_cache(
    client: Client,
    config: SignalConfig = DEFAULT_CONFIG,
    *,
    page_size: int = FINGERPRINT_BATCH_SIZE,
) -> CatalogCache:
    """Load song metadata and current-version fingerprints into process memory."""
    if page_size < 1:
        raise ValueError("page_size must be positive")

    song_rows: list[dict[str, Any]] = []
    start = 0
    while True:
        rows = _rows(
            client.table("songs")
            .select("id,name,spotify_url")
            .order("id")
            .range(start, start + page_size - 1)
            .execute()
            .data
        )
        if not rows:
            break
        song_rows.extend(rows)
        if len(rows) < page_size:
            break
        start += page_size

    songs = {
        str(row["id"]): {
            "id": str(row["id"]),
            "name": str(row["name"]),
            "spotifyUrl": str(row["spotify_url"]),
        }
        for row in song_rows
    }
    fingerprints_by_song: dict[str, list[Fingerprint]] = {}

    with Progress() as progress:
        task = progress.add_task("Caching fingerprints", total=None)
        first_page = True
        start = 0
        while True:
            response = (
                client.table("acoustic_fingerprints")
                .select(
                    "song_id,fingerprint_version,hash_value,anchor_frame",
                    count=CountMethod.exact if first_page else None,
                )
                .eq("fingerprint_version", config.fingerprint_version)
                .order("song_id")
                .order("hash_value")
                .order("anchor_frame")
                .range(start, start + page_size - 1)
                .execute()
            )
            if first_page:
                progress.update(task, total=response.count)
                first_page = False
            rows = _rows(response.data)
            for row in rows:
                fingerprints_by_song.setdefault(str(row["song_id"]), []).append(
                    Fingerprint(
                        str(row["hash_value"]),
                        int(row["anchor_frame"]),
                        str(row["fingerprint_version"]),
                    )
                )
            progress.update(task, advance=len(rows))
            if len(rows) < page_size:
                break
            start += page_size

    cache = CatalogCache(songs=songs, fingerprints=fingerprints_by_song)
    print(f"Cached {len(cache.songs)} songs / {cache.fingerprint_count} fingerprints")
    return cache


def _matching_cached_catalog(
    query: Sequence[Fingerprint], cache: CatalogCache
) -> dict[str, list[Fingerprint]]:
    """Keep only cached rows whose hashes occur in the query."""
    if not query:
        return {}

    query_hashes = {fingerprint.hash_value for fingerprint in query}
    return {
        song_id: [
            fingerprint for fingerprint in fingerprints if fingerprint.hash_value in query_hashes
        ]
        for song_id, fingerprints in cache.fingerprints.items()
    }


def build_fingerprint_rows(
    song_id: str, fingerprints: Sequence[Fingerprint]
) -> list[dict[str, Any]]:
    return [
        {
            "song_id": song_id,
            "fingerprint_version": fingerprint.version,
            "hash_value": fingerprint.hash_value,
            "anchor_frame": fingerprint.anchor_frame,
        }
        for fingerprint in fingerprints
    ]


def _rows(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [cast(dict[str, Any], row) for row in value if isinstance(row, dict)]


def ingest_song(
    path: Path,
    name: str,
    spotify_url: str,
    client: Client,
    config: SignalConfig = DEFAULT_CONFIG,
) -> dict[str, object]:
    song_name = name.strip()
    if not song_name:
        raise ValueError("name is required")
    link = validate_spotify_url(spotify_url)
    fingerprints = fingerprint_file(path, config)
    if not fingerprints:
        raise ValueError("no fingerprints were generated from the audio")

    song_id = str(uuid4())
    client.table("songs").insert({"id": song_id, "name": song_name, "spotify_url": link}).execute()
    try:
        rows = build_fingerprint_rows(song_id, fingerprints)
        for start in range(0, len(rows), FINGERPRINT_BATCH_SIZE):
            client.table("acoustic_fingerprints").insert(
                rows[start : start + FINGERPRINT_BATCH_SIZE]
            ).execute()
    except Exception:
        client.table("songs").delete().eq("id", song_id).execute()
        raise
    return {
        "id": song_id,
        "name": song_name,
        "spotifyUrl": link,
        "fingerprintCount": len(fingerprints),
    }


def recognize_file(
    path: Path, cache: CatalogCache, config: SignalConfig = DEFAULT_CONFIG
) -> dict[str, object]:
    query = fingerprint_file(path, config)
    if not query:
        return _no_match()
    catalog = _matching_cached_catalog(query, cache)
    result = match_fingerprints(query, catalog, config)
    if result is None:
        return _no_match()
    return _recognition_response(result, len(query), _fetch_song(result.song_id, cache))


def recognize_file_with_explanation(
    path: Path, cache: CatalogCache, config: SignalConfig = DEFAULT_CONFIG
) -> dict[str, object]:
    """Recognize a query and return bounded signal and matching evidence."""
    analysis = analyze_query_file(path, config)
    catalog = _matching_cached_catalog(analysis.fingerprints, cache)
    result = match_fingerprints(analysis.fingerprints, catalog, config)

    catalog_hashes = {
        fingerprint.hash_value
        for fingerprints in catalog.values()
        for fingerprint in fingerprints
    }
    matching_hashes = len(
        {fingerprint.hash_value for fingerprint in analysis.fingerprints} & catalog_hashes
    )

    if result is None:
        recognition = _no_match()
        matched_fingerprints: list[dict[str, float]] = []
        offset_votes: list[dict[str, object]] = []
        source_interval: dict[str, float] | None = None
        winning_traces: tuple[FingerprintTrace, ...] = ()
    else:
        song = _fetch_song(result.song_id, cache)
        recognition = _recognition_response(result, len(analysis.fingerprints), song)
        winning_evidence = build_winning_fingerprint_evidence(
            analysis.traces,
            catalog.get(result.song_id, []),
            result.offset_frame,
            config,
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
        query_duration_seconds = len(analysis.samples) / analysis.sample_rate
        source_interval = {
            "startSeconds": result.timestamp_seconds,
            "endSeconds": result.timestamp_seconds + query_duration_seconds,
        }

    query_duration_seconds = len(analysis.samples) / analysis.sample_rate
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
                "matchingHashes": matching_hashes,
                "winningVotes": result.match_count if result is not None else 0,
            },
            "matchThreshold": config.match_threshold,
            "candidateVotes": [],
            "processingTimesMs": None,
        },
    }


def _validate_audio_path(path: Path) -> None:
    if path.suffix.lower() not in SUPPORTED_AUDIO_EXTENSIONS:
        raise ValueError("audio must be WAV, MP3, FLAC, or OGG")


def _fetch_song(song_id: str, cache: CatalogCache) -> dict[str, str]:
    song = cache.songs.get(song_id)
    if song is None:
        raise RuntimeError("Matched song metadata is missing")
    return song


def _recognition_response(
    result: MatchResult,
    query_fingerprint_count: int,
    song: dict[str, str],
) -> dict[str, object]:
    return {
        "matched": True,
        "song": song,
        "timestampSeconds": result.timestamp_seconds,
        "confidence": min(1.0, result.match_count / query_fingerprint_count),
        "matchCount": result.match_count,
    }


def _no_match() -> dict[str, object]:
    return {
        "matched": False,
        "song": None,
        "timestampSeconds": None,
        "confidence": 0.0,
        "matchCount": 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fingerprint a local song into Supabase")
    parser.add_argument("audio", type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--spotify-url", required=True)
    args = parser.parse_args()
    from .supabase_client import get_supabase_client
    result = ingest_song(
        resolve_catalog_audio(args.audio),
        args.name,
        args.spotify_url,
        get_supabase_client(),
    )
    print(f"Stored {result['name']} with {result['fingerprintCount']} fingerprints")


if __name__ == "__main__":
    main()
