from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from hashlib import blake2b
from pathlib import Path

import librosa
import numpy as np
from numpy.typing import NDArray
from scipy.ndimage import maximum_filter

FloatArray = NDArray[np.float32]
Float64Array = NDArray[np.float64]


@dataclass(frozen=True, slots=True)
class SignalConfig:
    sample_rate: int = 22_050
    n_fft: int = 2_048
    hop_length: int = 512
    peak_neighborhood_frequency_bins: int = 15
    peak_neighborhood_time_frames: int = 9
    peak_amplitude_threshold_db: float = -35.0
    fan_out: int = 10
    min_time_delta_frames: int = 1
    max_time_delta_frames: int = 200
    match_threshold: int = 5
    fingerprint_version: str = "1"


DEFAULT_CONFIG = SignalConfig()


@dataclass(frozen=True, slots=True)
class AudioData:
    samples: FloatArray
    sample_rate: int


@dataclass(frozen=True, slots=True)
class Peak:
    frequency_bin: int
    time_frame: int
    amplitude_db: float


@dataclass(frozen=True, slots=True)
class PeakExtraction:
    spectrogram_db: Float64Array
    peaks: tuple[Peak, ...]


@dataclass(frozen=True, slots=True)
class Fingerprint:
    hash_value: str
    anchor_frame: int
    version: str


@dataclass(frozen=True, slots=True)
class MatchResult:
    song_id: str
    timestamp_seconds: float
    match_count: int
    offset_frame: int
    offset_votes: tuple[tuple[int, int], ...]


def load_audio(path: str | Path, config: SignalConfig = DEFAULT_CONFIG) -> AudioData:
    """Decode an audio file, convert it to mono, resample, and peak-normalize it."""
    samples, _ = librosa.load(path, sr=config.sample_rate, mono=True, dtype=np.float32)
    samples = np.asarray(samples, dtype=np.float32)
    if samples.size == 0:
        raise ValueError(f"Audio file is empty: {path}")
    if not np.isfinite(samples).all():
        raise ValueError(f"Audio file contains non-finite samples: {path}")

    amplitude = float(np.max(np.abs(samples)))
    if amplitude == 0:
        raise ValueError(f"Audio file is silent: {path}")
    normalized = np.asarray(samples / amplitude, dtype=np.float32)
    return AudioData(samples=normalized, sample_rate=config.sample_rate)


def extract_peaks(
    samples: FloatArray, config: SignalConfig = DEFAULT_CONFIG
) -> PeakExtraction:
    """Compute a dB spectrogram and its local spectral maxima."""
    if samples.ndim != 1 or samples.size == 0:
        raise ValueError("Audio samples must be a non-empty mono array")

    magnitude = np.abs(
        librosa.stft(
            samples,
            n_fft=config.n_fft,
            hop_length=config.hop_length,
            window="hann",
        )
    )
    if not np.any(magnitude):
        raise ValueError("Cannot extract peaks from silent audio")

    spectrogram_db = np.asarray(
        librosa.amplitude_to_db(magnitude, ref=np.max), dtype=np.float64
    )
    local_maxima = maximum_filter(
        spectrogram_db,
        size=(
            config.peak_neighborhood_frequency_bins,
            config.peak_neighborhood_time_frames,
        ),
        mode="constant",
        cval=-np.inf,
    )
    peak_bins = np.argwhere(
        (spectrogram_db == local_maxima)
        & (spectrogram_db >= config.peak_amplitude_threshold_db)
    )
    peaks = tuple(
        Peak(int(frequency_bin), int(time_frame), float(spectrogram_db[frequency_bin, time_frame]))
        for frequency_bin, time_frame in peak_bins[np.argsort(peak_bins[:, 1], stable=True)]
    )
    return PeakExtraction(spectrogram_db=spectrogram_db, peaks=peaks)


def create_fingerprints(
    peaks: Sequence[Peak], config: SignalConfig = DEFAULT_CONFIG
) -> tuple[Fingerprint, ...]:
    """Create deterministic anchor-target hashes from a constellation of peaks."""
    ordered = sorted(peaks, key=lambda peak: (peak.time_frame, peak.frequency_bin))
    fingerprints: list[Fingerprint] = []

    for anchor_index, anchor in enumerate(ordered):
        targets = 0
        for target in ordered[anchor_index + 1 :]:
            delta = target.time_frame - anchor.time_frame
            if delta < config.min_time_delta_frames:
                continue
            if delta > config.max_time_delta_frames:
                break

            payload = (
                f"{config.fingerprint_version}|{anchor.frequency_bin}|"
                f"{target.frequency_bin}|{delta}"
            )
            fingerprints.append(
                Fingerprint(
                    hash_value=blake2b(payload.encode(), digest_size=8).hexdigest(),
                    anchor_frame=anchor.time_frame,
                    version=config.fingerprint_version,
                )
            )
            targets += 1
            if targets == config.fan_out:
                break

    return tuple(fingerprints)


def match_fingerprints(
    query: Sequence[Fingerprint],
    catalog: Mapping[str, Sequence[Fingerprint]],
    config: SignalConfig = DEFAULT_CONFIG,
) -> MatchResult | None:
    """Match query hashes by voting for a catalog song and aligned frame offset."""
    if not query:
        return None
    if any(fingerprint.version != config.fingerprint_version for fingerprint in query):
        raise ValueError("Query fingerprint version does not match the signal configuration")

    index: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for song_id, fingerprints in catalog.items():
        for fingerprint in fingerprints:
            if fingerprint.version == config.fingerprint_version:
                index[fingerprint.hash_value].append((song_id, fingerprint.anchor_frame))

    votes: Counter[tuple[str, int]] = Counter()
    for fingerprint in query:
        for song_id, catalog_frame in index.get(fingerprint.hash_value, ()):
            votes[(song_id, catalog_frame - fingerprint.anchor_frame)] += 1

    if not votes:
        return None
    (song_id, offset_frame), match_count = min(
        votes.items(),
        key=lambda item: (-item[1], item[0][0], abs(item[0][1]), item[0][1]),
    )
    if match_count < config.match_threshold:
        return None

    offset_votes = tuple(
        sorted(
            (offset, count)
            for (candidate, offset), count in votes.items()
            if candidate == song_id
        )
    )
    return MatchResult(
        song_id=song_id,
        timestamp_seconds=offset_frame * config.hop_length / config.sample_rate,
        match_count=match_count,
        offset_frame=offset_frame,
        offset_votes=offset_votes,
    )
