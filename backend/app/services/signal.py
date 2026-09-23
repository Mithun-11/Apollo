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
    peak_amplitude_threshold_db: float = -60.0
    min_frequency_hz: float = 100.0
    max_frequency_hz: float = 5_000.0
    peaks_per_second: int = 60
    fan_out: int = 10
    min_time_delta_frames: int = 1
    max_time_delta_frames: int = 64
    max_frequency_delta_bins: int = 150
    match_threshold: int = 20
    min_winner_ratio: float = 2.0
    offset_tolerance_frames: int = 1
    fingerprint_version: str = "3"


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
class FingerprintTrace:
    fingerprint: Fingerprint
    anchor_frequency_bin: int
    target_frequency_bin: int
    target_frame: int


@dataclass(frozen=True, slots=True)
class MatchResult:
    song_id: str
    timestamp_seconds: float
    match_count: int
    offset_frame: int
    offset_votes: tuple[tuple[int, int], ...]


@dataclass(frozen=True, slots=True)
class CandidateScore:
    song_id: str
    offset_frame: int
    votes: int


@dataclass(frozen=True, slots=True)
class MatchDiagnostics:
    result: MatchResult | None
    reason: str
    leading: CandidateScore | None
    runner_up_votes: int
    candidates: tuple[CandidateScore, ...]
    raw_offset_votes: tuple[tuple[int, int], ...]
    clustered_offset_votes: tuple[tuple[int, int], ...]


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
    """Compute a dB spectrogram and its strongest in-band local spectral maxima."""
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
    bin_frequencies_hz = np.arange(spectrogram_db.shape[0]) * config.sample_rate / config.n_fft
    in_band = (bin_frequencies_hz >= config.min_frequency_hz) & (
        bin_frequencies_hz <= config.max_frequency_hz
    )
    peak_bins = np.argwhere(
        (spectrogram_db == local_maxima)
        & (spectrogram_db >= config.peak_amplitude_threshold_db)
        & in_band[:, np.newaxis]
    )
    peak_bins = _strongest_peaks_per_second(peak_bins, spectrogram_db, config)
    peaks = tuple(
        Peak(int(frequency_bin), int(time_frame), float(spectrogram_db[frequency_bin, time_frame]))
        for frequency_bin, time_frame in peak_bins
    )
    return PeakExtraction(spectrogram_db=spectrogram_db, peaks=peaks)


def _strongest_peaks_per_second(
    peak_bins: NDArray[np.intp], spectrogram_db: Float64Array, config: SignalConfig
) -> NDArray[np.intp]:
    """Keep a fixed peak budget per second so quiet passages and noisy queries stay comparable.

    Returns (frequency_bin, time_frame) rows ordered by time, then frequency.
    """
    frequency_bins = peak_bins[:, 0]
    time_frames = peak_bins[:, 1]
    if config.peaks_per_second > 0 and peak_bins.size:
        frames_per_second = max(1, round(config.sample_rate / config.hop_length))
        seconds = time_frames // frames_per_second
        amplitudes = spectrogram_db[frequency_bins, time_frames]
        order = np.lexsort((frequency_bins, time_frames, -amplitudes, seconds))
        sorted_seconds = seconds[order]
        rank = np.arange(order.size) - np.searchsorted(sorted_seconds, sorted_seconds, side="left")
        peak_bins = peak_bins[order[rank < config.peaks_per_second]]
    return peak_bins[np.lexsort((peak_bins[:, 0], peak_bins[:, 1]))]


def create_fingerprints(
    peaks: Sequence[Peak], config: SignalConfig = DEFAULT_CONFIG
) -> tuple[Fingerprint, ...]:
    """Create deterministic anchor-target hashes from a constellation of peaks."""
    fingerprints, _ = create_fingerprints_with_traces(peaks, config)
    return fingerprints


def create_fingerprints_with_traces(
    peaks: Sequence[Peak], config: SignalConfig = DEFAULT_CONFIG
) -> tuple[tuple[Fingerprint, ...], tuple[FingerprintTrace, ...]]:
    """Create deterministic fingerprints and the peak pairs that produced them."""
    ordered = sorted(peaks, key=lambda peak: (peak.time_frame, peak.frequency_bin))
    fingerprints: list[Fingerprint] = []
    traces: list[FingerprintTrace] = []

    for anchor_index, anchor in enumerate(ordered):
        targets = 0
        for target in ordered[anchor_index + 1 :]:
            delta = target.time_frame - anchor.time_frame
            if delta < config.min_time_delta_frames:
                continue
            if delta > config.max_time_delta_frames:
                break
            if abs(target.frequency_bin - anchor.frequency_bin) > config.max_frequency_delta_bins:
                continue

            payload = (
                f"{config.fingerprint_version}|{anchor.frequency_bin}|"
                f"{target.frequency_bin}|{delta}"
            )
            fingerprint = Fingerprint(
                hash_value=blake2b(payload.encode(), digest_size=8).hexdigest(),
                anchor_frame=anchor.time_frame,
                version=config.fingerprint_version,
            )
            fingerprints.append(fingerprint)
            traces.append(
                FingerprintTrace(
                    fingerprint=fingerprint,
                    anchor_frequency_bin=anchor.frequency_bin,
                    target_frequency_bin=target.frequency_bin,
                    target_frame=target.time_frame,
                )
            )
            targets += 1
            if targets == config.fan_out:
                break

    return tuple(fingerprints), tuple(traces)


def match_fingerprints(
    query: Sequence[Fingerprint],
    catalog: Mapping[str, Sequence[Fingerprint]],
    config: SignalConfig = DEFAULT_CONFIG,
) -> MatchResult | None:
    """Match query hashes by voting for a catalog song and aligned frame offset.

    Votes within ``offset_tolerance_frames`` of an offset count together because a recording
    rarely starts on the catalog's STFT frame grid. Negative offsets are impossible for a clip
    taken from inside a song and are ignored. A winner needs ``match_threshold`` votes and
    ``min_winner_ratio`` times the votes of the strongest competing song.
    """
    return analyze_fingerprint_match(query, catalog, config).result


def analyze_fingerprint_match(
    query: Sequence[Fingerprint],
    catalog: Mapping[str, Sequence[Fingerprint]],
    config: SignalConfig = DEFAULT_CONFIG,
) -> MatchDiagnostics:
    """Return the ordinary match and the votes needed to explain its decision."""
    if not query:
        return MatchDiagnostics(None, "no_fingerprints", None, 0, (), (), ())
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
            offset = catalog_frame - fingerprint.anchor_frame
            if offset >= 0:
                votes[(song_id, offset)] += 1

    if not votes:
        has_hash_hits = any(fingerprint.hash_value in index for fingerprint in query)
        reason = "no_valid_offsets" if has_hash_hits else "no_catalog_hits"
        return MatchDiagnostics(None, reason, None, 0, (), (), ())
    tolerance = config.offset_tolerance_frames
    clustered_votes: Counter[tuple[str, int]] = Counter()
    for (candidate, offset), count in votes.items():
        for nearby_offset in range(max(0, offset - tolerance), offset + tolerance + 1):
            clustered_votes[(candidate, nearby_offset)] += count

    (song_id, offset_frame), match_count = min(
        clustered_votes.items(),
        key=lambda item: (-item[1], -votes[item[0]], item[0][0], item[0][1]),
    )
    runner_up_match_count = max(
        (
            count
            for (candidate, _), count in clustered_votes.items()
            if candidate != song_id
        ),
        default=0,
    )
    best_by_song: dict[str, CandidateScore] = {}
    for (candidate, offset), count in clustered_votes.items():
        current = best_by_song.get(candidate)
        if current is None or (-count, -votes[(candidate, offset)], offset) < (
            -current.votes,
            -votes[(candidate, current.offset_frame)],
            current.offset_frame,
        ):
            best_by_song[candidate] = CandidateScore(candidate, offset, count)
    candidates = tuple(
        sorted(
            best_by_song.values(),
            key=lambda item: (-item.votes, item.song_id != song_id, item.song_id),
        )
    )
    raw_offset_votes = tuple(
        sorted(
            (offset, count)
            for (candidate, offset), count in votes.items()
            if candidate == song_id
        )
    )
    leading_clustered_votes = tuple(
        sorted(
            (offset, count)
            for (candidate, offset), count in clustered_votes.items()
            if candidate == song_id
        )
    )
    leading = CandidateScore(song_id, offset_frame, match_count)
    if match_count < config.match_threshold:
        reason = "below_threshold"
    elif match_count < runner_up_match_count * config.min_winner_ratio:
        reason = "ambiguous"
    else:
        reason = "accepted"
    result = (
        MatchResult(
            song_id=song_id,
            timestamp_seconds=offset_frame * config.hop_length / config.sample_rate,
            match_count=match_count,
            offset_frame=offset_frame,
            offset_votes=raw_offset_votes,
        )
        if reason == "accepted"
        else None
    )
    return MatchDiagnostics(
        result,
        reason,
        leading,
        runner_up_match_count,
        candidates,
        raw_offset_votes,
        leading_clustered_votes,
    )
