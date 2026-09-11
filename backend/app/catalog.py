from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlparse
from uuid import uuid4

from supabase import Client

from .services.signal import (
    DEFAULT_CONFIG,
    Fingerprint,
    SignalConfig,
    create_fingerprints,
    extract_peaks,
    load_audio,
    match_fingerprints,
)

FINGERPRINT_BATCH_SIZE = 500
SUPPORTED_AUDIO_EXTENSIONS = {".flac", ".mp3", ".ogg", ".wav"}
PROJECT_ROOT = Path(__file__).resolve().parents[2]
SONGS_DIR = PROJECT_ROOT.parent / "Songs"


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
    if path.suffix.lower() not in SUPPORTED_AUDIO_EXTENSIONS:
        raise ValueError("audio must be WAV, MP3, FLAC, or OGG")
    audio = load_audio(path, config)
    return create_fingerprints(extract_peaks(audio.samples, config).peaks, config)


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
    path: Path, client: Client, config: SignalConfig = DEFAULT_CONFIG
) -> dict[str, object]:
    query = fingerprint_file(path, config)
    if not query:
        return _no_match()
    hashes = sorted({fingerprint.hash_value for fingerprint in query})
    catalog: dict[str, list[Fingerprint]] = {}
    for start in range(0, len(hashes), FINGERPRINT_BATCH_SIZE):
        response = (
            client.table("acoustic_fingerprints")
            .select("song_id,fingerprint_version,hash_value,anchor_frame")
            .eq("fingerprint_version", config.fingerprint_version)
            .in_("hash_value", hashes[start : start + FINGERPRINT_BATCH_SIZE])
            .execute()
        )
        for row in _rows(response.data):
            song_id = str(row["song_id"])
            catalog.setdefault(song_id, []).append(
                Fingerprint(
                    str(row["hash_value"]),
                    int(row["anchor_frame"]),
                    str(row["fingerprint_version"]),
                )
            )
    result = match_fingerprints(query, catalog, config)
    if result is None:
        return _no_match()
    song_rows = _rows(
        client.table("songs")
        .select("id,name,spotify_url")
        .eq("id", result.song_id)
        .limit(1)
        .execute()
        .data
    )
    if not song_rows:
        raise RuntimeError("Matched song metadata is missing")
    song = song_rows[0]
    return {
        "matched": True,
        "song": {
            "id": str(song["id"]),
            "name": str(song["name"]),
            "spotifyUrl": str(song["spotify_url"]),
        },
        "timestampSeconds": result.timestamp_seconds,
        "confidence": min(1.0, result.match_count / len(query)),
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
