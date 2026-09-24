"""Evidence for the class-mode replay, computed after the answer so recognition never waits.

The frontend asks for this once a song has been recognized. Everything here is measured or
computed from the same recording: stage timings of the fingerprint pipeline, the votes every
catalog song received, the song's own peak constellation over the matched window, the
speed/pitch search curve for edits, and the separated melody lines for covers.
"""

from __future__ import annotations

import re
import sqlite3
import time
import unicodedata
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from typing import TypeVar

import librosa
import numpy as np

from .catalog import SONGS_DIR, SUPPORTED_AUDIO_EXTENSIONS, fetch_matching_catalog
from .melody_catalog import identify_catalog_song, load_melody_catalog
from .services import vocal_separation
from .services.melody_match import (
    DEFAULT_MELODY_CONFIG,
    extract_features,
    match_melody,
    melody_cost,
)
from .services.signal import (
    DEFAULT_CONFIG,
    SignalConfig,
    analyze_fingerprint_match,
    create_fingerprints_with_traces,
    extract_peaks,
    load_audio,
)
from .services.speed_search import score_candidate_changes

T = TypeVar("T")
MAX_SONG_PEAKS = 1_500
MAX_PATH_POINTS = 240
SEPARATION_BINS = 72
SEPARATION_FRAMES = 150


class StageTimer:
    """Runs pipeline stages and records how long each took."""

    def __init__(self) -> None:
        self.stages: list[dict[str, object]] = []

    def run(self, stage: str, detail: str, work: Callable[[], T]) -> T:
        started = time.perf_counter()
        value = work()
        self.stages.append(
            {
                "stage": stage,
                "detail": detail,
                "milliseconds": (time.perf_counter() - started) * 1000,
            }
        )
        return value


def build_evidence(
    path: Path,
    connection: sqlite3.Connection,
    song_id: str,
    timestamp_seconds: float,
    speed_factor: float = 1.0,
    pitch_factor: float = 1.0,
    match_method: str = "fingerprint",
    config: SignalConfig = DEFAULT_CONFIG,
) -> dict[str, object]:
    timer = StageTimer()
    timed = timer.run
    audio = timed("Read audio", "decode, mix to mono, resample", lambda: load_audio(path, config))
    duration = len(audio.samples) / audio.sample_rate
    extraction = timed(
        "Spectrogram and peaks",
        "short-time Fourier transform, local maxima",
        lambda: extract_peaks(audio.samples, config),
    )
    fingerprints, _ = timed(
        "Fingerprints",
        "pair each peak with nearby peaks, hash (f1, f2, Δt)",
        lambda: create_fingerprints_with_traces(extraction.peaks, config),
    )
    catalog = timed(
        "Database lookup",
        "indexed SQLite search for every hash",
        lambda: fetch_matching_catalog(fingerprints, connection, config),
    )
    diagnostics = timed(
        "Offset voting",
        "count agreeing time offsets per song",
        lambda: analyze_fingerprint_match(fingerprints, catalog, config),
    )

    names = _song_names(connection)
    frame_seconds = config.hop_length / config.sample_rate
    songs = [
        {
            "songId": candidate_id,
            "name": name,
            "fingerprints": count,
            "hashHits": len(catalog.get(candidate_id, ())),
        }
        for candidate_id, (name, count) in _catalog_stats(connection, names).items()
    ]
    votes = [
        {
            "songId": candidate.song_id,
            "votes": candidate.votes,
            "offsetSeconds": candidate.offset_frame * frame_seconds,
        }
        for candidate in diagnostics.candidates
    ]

    edited = abs(speed_factor - 1) >= 0.01 or abs(pitch_factor - 1) >= 0.01
    speed_curve = None
    if edited:
        scores = timed(
            "Speed and pitch search",
            "re-hash the peaks for 78 speed and pitch guesses",
            lambda: score_candidate_changes(
                extraction.peaks,
                lambda query: fetch_matching_catalog(query, connection, config),
                config,
            ),
        )
        speed_curve = [
            {
                "speedFactor": change.speed_factor,
                "pitchFactor": change.pitch_factor,
                "votes": score,
            }
            for change, score in scores
        ]

    song_file = find_song_file(song_id, names.get(song_id, ""), connection)
    song_sky = _song_sky(song_file, timestamp_seconds, duration * speed_factor, config)
    melody = (
        _melody_evidence(path, connection, song_id, duration, timer)
        if match_method == "melody"
        else None
    )
    return {
        "durationSeconds": duration,
        "timings": timer.stages,
        "songs": songs,
        "votes": votes,
        "catalogFingerprints": sum(int(str(song["fingerprints"])) for song in songs),
        "speedCurve": speed_curve,
        "songSky": song_sky,
        "melody": melody,
    }


def _song_names(connection: sqlite3.Connection) -> dict[str, str]:
    return {
        str(row["id"]): str(row["name"]) for row in connection.execute("SELECT id, name FROM songs")
    }


def _catalog_stats(
    connection: sqlite3.Connection, names: dict[str, str]
) -> dict[str, tuple[str, int]]:
    counts = _fingerprint_counts(
        str(Path(connection.execute("PRAGMA database_list").fetchone()[2])), len(names)
    )
    return {song_id: (name, counts.get(song_id, 0)) for song_id, name in names.items()}


@lru_cache(maxsize=4)
def _fingerprint_counts(database: str, song_count: int) -> dict[str, int]:
    """Fingerprints per song; cached per database and catalog size (a full count takes ~0.5 s)."""
    with sqlite3.connect(database) as connection:
        rows = connection.execute(
            "SELECT song_id, COUNT(*) FROM acoustic_fingerprints GROUP BY song_id"
        ).fetchall()
    return {str(song_id): int(count) for song_id, count in rows}


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", text)).lower()
    return " ".join(re.findall(r"\w+", text))


@lru_cache(maxsize=1)
def _song_files() -> tuple[Path, ...]:
    if not SONGS_DIR.is_dir():
        return ()
    return tuple(
        path
        for path in sorted(SONGS_DIR.iterdir())
        if path.suffix.lower() in SUPPORTED_AUDIO_EXTENSIONS
    )


def _title_candidates(name: str) -> list[Path]:
    """Files whose title matches the catalog name: exact titles first, then containing ones."""
    wanted = _normalize(name)
    if not wanted:
        return []
    titles = {path: _normalize(path.stem) for path in _song_files()}
    exact = [path for path, title in titles.items() if title == wanted]
    if exact:
        return exact
    return [
        path for path, title in titles.items() if title and (wanted in title or title in wanted)
    ]


_identity: dict[Path, str | None] = {}


def _identify(path: Path, connection: sqlite3.Connection) -> str | None:
    if path not in _identity:
        _identity[path] = identify_catalog_song(path, connection)
    return _identity[path]


def find_song_file(
    song_id: str, name: str, connection: sqlite3.Connection | None = None
) -> Path | None:
    """The song's audio file in the Songs folder.

    A single title match is trusted. Several versions sharing a title (an original and an
    English version) and files titled in another script are told apart by their fingerprints,
    once per file.
    """
    if not song_id:
        return None
    candidates = _title_candidates(name)
    if len(candidates) == 1 or (candidates and connection is None):
        return candidates[0]
    if connection is None:
        return None
    for path in candidates:
        if _identify(path, connection) == song_id:
            return path
    claimed = {
        found[0]
        for other in _song_names(connection).values()
        if len(found := _title_candidates(other)) == 1
    }
    for path in _song_files():
        unclaimed = path not in claimed and path not in candidates
        if unclaimed and _identify(path, connection) == song_id:
            return path
    return None


def _song_sky(
    song_file: Path | None, start_seconds: float, span_seconds: float, config: SignalConfig
) -> dict[str, object] | None:
    """Peaks of the catalog song over the part the recording matched, in song seconds."""
    if song_file is None or span_seconds <= 0:
        return None
    samples, _ = librosa.load(
        song_file,
        sr=config.sample_rate,
        mono=True,
        offset=max(0.0, start_seconds),
        duration=span_seconds,
    )
    if samples.size == 0:
        return None
    peak = float(np.max(np.abs(samples))) or 1.0
    extraction = extract_peaks((samples / peak).astype(np.float32), config)
    frame_seconds = config.hop_length / config.sample_rate
    hz_per_bin = config.sample_rate / config.n_fft
    peaks = sorted(extraction.peaks, key=lambda item: item.time_frame)
    if len(peaks) > MAX_SONG_PEAKS:
        peaks = peaks[:: len(peaks) // MAX_SONG_PEAKS + 1]
    return {
        "startSeconds": start_seconds,
        "durationSeconds": len(samples) / config.sample_rate,
        "peaks": [
            {
                "timeSeconds": item.time_frame * frame_seconds,
                "frequencyHz": item.frequency_bin * hz_per_bin,
                "amplitudeDb": item.amplitude_db,
            }
            for item in peaks
        ],
    }


def _melody_evidence(
    path: Path,
    connection: sqlite3.Connection,
    song_id: str,
    duration: float,
    timer: StageTimer,
) -> dict[str, object] | None:
    if not vocal_separation.is_available():
        return None
    config = DEFAULT_MELODY_CONFIG
    catalog = load_melody_catalog(connection, config)
    song = catalog.get(song_id)
    if song is None:
        return None
    separated = timer.run(
        "Vocal separation",
        "Demucs neural network splits the voice from the band",
        lambda: vocal_separation.separate_file(path, config.sample_rate),
    )
    features = timer.run(
        "Pitch and chroma",
        "pYIN pitch tracking and chroma of voice and mix",
        lambda: extract_features(separated.vocals, separated.mix, config),
    )
    timer.run(
        "Melody comparison",
        f"12-key dynamic time warping against {len(catalog)} songs",
        lambda: match_melody(features, duration, catalog, config),
    )
    query = np.asarray(features.melody)
    if len(query) < 4:
        return None
    _, start, shift = melody_cost(query, song.melody, config)
    segment = np.asarray(song.melody[start : start + 2 * len(query)])
    # Fold the key shift to the octave that sits closest to the song's notes.
    lifted = min(
        (query + shift + octave for octave in (-24, -12, 0, 12)),
        key=lambda candidate: float(np.median(np.abs(candidate - np.median(segment)))),
    )
    difference = np.abs(lifted[:, None] - segment[None, :])
    cost = np.minimum(difference, config.melody_cost_cap_semitones)
    _, warping = librosa.sequence.dtw(C=cost, subseq=True)
    path_points = warping[::-1]
    step = max(1, len(path_points) // MAX_PATH_POINTS)
    return {
        "framesPerSecond": config.sample_rate
        / (config.pitch_hop_length * config.pitch_block_frames),
        "query": [round(float(value), 2) for value in query],
        "queryShifted": [round(float(value), 2) for value in lifted],
        "song": [round(float(value), 2) for value in segment],
        "path": [[int(q), int(s)] for q, s in path_points[::step]],
        "keyShiftSemitones": int(((-shift + 6) % 12) - 6),
        "mixSpectrogram": _small_spectrogram(separated.mix, config.sample_rate),
        "vocalSpectrogram": _small_spectrogram(separated.vocals, config.sample_rate),
    }


def _small_spectrogram(samples: np.ndarray, sample_rate: int) -> list[list[int]]:
    """A coarse log-frequency dB image (bins x frames, 0-100) for the separation picture."""
    magnitude = np.abs(librosa.stft(samples.astype(np.float32), n_fft=1024, hop_length=256))
    frequencies = librosa.fft_frequencies(sr=sample_rate, n_fft=1024)
    edges = np.geomspace(80, sample_rate / 2, SEPARATION_BINS + 1)
    rows = [
        magnitude[(frequencies >= low) & (frequencies < high)].mean(axis=0)
        if np.any((frequencies >= low) & (frequencies < high))
        else np.zeros(magnitude.shape[1])
        for low, high in zip(edges[:-1], edges[1:], strict=True)
    ]
    image = np.asarray(rows)
    frames = np.linspace(0, image.shape[1] - 1, SEPARATION_FRAMES).astype(int)
    decibels = librosa.amplitude_to_db(image[:, frames] + 1e-9, ref=np.max)
    scaled = np.clip((decibels + 70) / 70 * 100, 0, 100).round().astype(int)
    return [[int(value) for value in row] for row in scaled]
