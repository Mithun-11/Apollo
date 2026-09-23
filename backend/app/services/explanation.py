from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from .signal import (
    DEFAULT_CONFIG,
    Fingerprint,
    FingerprintTrace,
    Float64Array,
    FloatArray,
    Peak,
    SignalConfig,
)

MAX_WAVEFORM_COLUMNS = 600
MAX_SPECTROGRAM_FREQUENCY_BINS = 128
MAX_SPECTROGRAM_TIME_BINS = 256
MAX_DISPLAY_PEAKS = 1_000
MAX_DISPLAY_MATCHES = 300
MAX_OFFSET_BARS = 200
SPECTROGRAM_MIN_DB = -80
SPECTROGRAM_MAX_DB = 0


@dataclass(frozen=True, slots=True)
class WaveformEnvelopePoint:
    time_seconds: float
    minimum: float
    maximum: float


@dataclass(frozen=True, slots=True)
class SpectrogramDisplay:
    values_db: list[list[int]]
    minimum_db: int
    maximum_db: int
    maximum_frequency_hz: float
    duration_seconds: float


@dataclass(frozen=True, slots=True)
class PeakDisplay:
    time_seconds: float
    frequency_hz: float
    amplitude_db: float
    matched: bool


@dataclass(frozen=True, slots=True)
class MatchedFingerprintDisplay:
    query_anchor_seconds: float
    query_target_seconds: float
    source_anchor_seconds: float
    source_target_seconds: float
    anchor_frequency_hz: float
    target_frequency_hz: float


@dataclass(frozen=True, slots=True)
class OffsetVoteDisplay:
    offset_seconds: float
    count: int
    winning: bool


@dataclass(frozen=True, slots=True)
class WinningFingerprintEvidence:
    traces: tuple[FingerprintTrace, ...]
    matched_fingerprints: tuple[MatchedFingerprintDisplay, ...]


def build_waveform_envelope(
    samples: FloatArray,
    sample_rate: int,
    *,
    max_columns: int = MAX_WAVEFORM_COLUMNS,
) -> list[WaveformEnvelopePoint]:
    """Reduce normalized audio samples to bounded min/max time regions."""
    if samples.ndim != 1:
        raise ValueError("Waveform samples must be a one-dimensional array")
    if sample_rate <= 0:
        raise ValueError("Sample rate must be positive")
    if max_columns <= 0:
        raise ValueError("Maximum waveform columns must be positive")
    if samples.size == 0:
        return []

    clipped = np.clip(np.asarray(samples, dtype=np.float64), -1.0, 1.0)
    column_count = min(max_columns, clipped.size)
    points: list[WaveformEnvelopePoint] = []
    for column_index in range(column_count):
        start = column_index * clipped.size // column_count
        end = (column_index + 1) * clipped.size // column_count
        region = clipped[start:end]
        midpoint_sample = (start + end - 1) / 2
        points.append(
            WaveformEnvelopePoint(
                time_seconds=float(midpoint_sample / sample_rate),
                minimum=float(np.min(region)),
                maximum=float(np.max(region)),
            )
        )
    return points


def build_spectrogram_display(
    spectrogram_db: Float64Array,
    duration_seconds: float,
    config: SignalConfig = DEFAULT_CONFIG,
    *,
    max_frequency_bins: int = MAX_SPECTROGRAM_FREQUENCY_BINS,
    max_time_bins: int = MAX_SPECTROGRAM_TIME_BINS,
) -> SpectrogramDisplay:
    """Downsample a dB spectrogram to a bounded integer matrix for display."""
    if spectrogram_db.ndim != 2:
        raise ValueError("Spectrogram must be a two-dimensional array")
    if duration_seconds < 0:
        raise ValueError("Spectrogram duration cannot be negative")
    if max_frequency_bins <= 0 or max_time_bins <= 0:
        raise ValueError("Spectrogram display limits must be positive")

    if spectrogram_db.size == 0:
        values_db: list[list[int]] = []
    else:
        frequency_count = min(max_frequency_bins, spectrogram_db.shape[0])
        time_count = min(max_time_bins, spectrogram_db.shape[1])
        frequency_indices = np.rint(
            np.linspace(0, spectrogram_db.shape[0] - 1, frequency_count)
        ).astype(np.intp)
        time_indices = np.rint(
            np.linspace(0, spectrogram_db.shape[1] - 1, time_count)
        ).astype(np.intp)
        selected = spectrogram_db[np.ix_(frequency_indices, time_indices)]
        safe_values = np.nan_to_num(
            selected,
            nan=float(SPECTROGRAM_MIN_DB),
            posinf=float(SPECTROGRAM_MAX_DB),
            neginf=float(SPECTROGRAM_MIN_DB),
        )
        rounded = np.rint(np.clip(safe_values, SPECTROGRAM_MIN_DB, SPECTROGRAM_MAX_DB))
        values_db = [[int(value) for value in row] for row in rounded]

    return SpectrogramDisplay(
        values_db=values_db,
        minimum_db=SPECTROGRAM_MIN_DB,
        maximum_db=SPECTROGRAM_MAX_DB,
        maximum_frequency_hz=float(config.sample_rate / 2),
        duration_seconds=float(duration_seconds),
    )


def build_peak_display(
    peaks: Sequence[Peak],
    config: SignalConfig = DEFAULT_CONFIG,
    *,
    matched_traces: Sequence[FingerprintTrace] = (),
    max_peaks: int = MAX_DISPLAY_PEAKS,
) -> list[PeakDisplay]:
    """Select the strongest peaks and return them in constellation order."""
    if max_peaks <= 0:
        raise ValueError("Maximum displayed peaks must be positive")

    matched_coordinates = {
        (trace.fingerprint.anchor_frame, trace.anchor_frequency_bin)
        for trace in matched_traces
    }
    matched_coordinates.update(
        (trace.target_frame, trace.target_frequency_bin) for trace in matched_traces
    )
    selected = sorted(
        peaks,
        key=lambda peak: (-peak.amplitude_db, peak.time_frame, peak.frequency_bin),
    )[:max_peaks]
    selected.sort(key=lambda peak: (peak.time_frame, peak.frequency_bin, peak.amplitude_db))
    return [
        PeakDisplay(
            time_seconds=float(peak.time_frame * config.hop_length / config.sample_rate),
            frequency_hz=float(peak.frequency_bin * config.sample_rate / config.n_fft),
            amplitude_db=float(peak.amplitude_db),
            matched=(peak.time_frame, peak.frequency_bin) in matched_coordinates,
        )
        for peak in selected
    ]


def build_matched_fingerprint_display(
    traces: Sequence[FingerprintTrace],
    catalog_fingerprints: Sequence[Fingerprint],
    winning_offset_frame: int,
    config: SignalConfig = DEFAULT_CONFIG,
    *,
    max_matches: int = MAX_DISPLAY_MATCHES,
) -> list[MatchedFingerprintDisplay]:
    """Build bounded query/source lines for fingerprints at the winning offset."""
    if max_matches <= 0:
        raise ValueError("Maximum displayed fingerprint matches must be positive")

    return list(
        build_winning_fingerprint_evidence(
            traces,
            catalog_fingerprints,
            winning_offset_frame,
            config,
            max_matches=max_matches,
        ).matched_fingerprints
    )


def build_winning_fingerprint_evidence(
    traces: Sequence[FingerprintTrace],
    catalog_fingerprints: Sequence[Fingerprint],
    winning_offset_frame: int,
    config: SignalConfig = DEFAULT_CONFIG,
    *,
    max_matches: int = MAX_DISPLAY_MATCHES,
) -> WinningFingerprintEvidence:
    """Build winning traces and bounded alignment lines in one indexed pass."""
    if max_matches <= 0:
        raise ValueError("Maximum displayed fingerprint matches must be positive")

    frame_seconds = config.hop_length / config.sample_rate
    frequency_hz_per_bin = config.sample_rate / config.n_fft
    unique_matches: dict[tuple[int, int, int, int, int], MatchedFingerprintDisplay] = {}
    selected_traces: dict[FingerprintTrace, None] = {}
    for trace, catalog_fingerprint in _winning_pairs(
        traces, catalog_fingerprints, winning_offset_frame, config
    ):
        selected_traces.setdefault(trace, None)
        query_fingerprint = trace.fingerprint
        delta_frames = trace.target_frame - query_fingerprint.anchor_frame
        source_target_frame = catalog_fingerprint.anchor_frame + delta_frames
        key = (
            query_fingerprint.anchor_frame,
            trace.anchor_frequency_bin,
            trace.target_frame,
            trace.target_frequency_bin,
            catalog_fingerprint.anchor_frame,
        )
        if key not in unique_matches:
            unique_matches[key] = MatchedFingerprintDisplay(
                query_anchor_seconds=float(query_fingerprint.anchor_frame * frame_seconds),
                query_target_seconds=float(trace.target_frame * frame_seconds),
                source_anchor_seconds=float(catalog_fingerprint.anchor_frame * frame_seconds),
                source_target_seconds=float(source_target_frame * frame_seconds),
                anchor_frequency_hz=float(trace.anchor_frequency_bin * frequency_hz_per_bin),
                target_frequency_hz=float(trace.target_frequency_bin * frequency_hz_per_bin),
            )

    ordered = [
        match for _, match in sorted(unique_matches.items(), key=lambda item: item[0])
    ]
    return WinningFingerprintEvidence(
        traces=tuple(selected_traces),
        matched_fingerprints=tuple(_sample_evenly(ordered, max_matches)),
    )


def select_winning_traces(
    traces: Sequence[FingerprintTrace],
    catalog_fingerprints: Sequence[Fingerprint],
    winning_offset_frame: int,
    config: SignalConfig = DEFAULT_CONFIG,
) -> list[FingerprintTrace]:
    """Return query traces that contribute to the winning catalog alignment."""
    return list(
        build_winning_fingerprint_evidence(
            traces,
            catalog_fingerprints,
            winning_offset_frame,
            config,
        ).traces
    )


def _winning_pairs(
    traces: Sequence[FingerprintTrace],
    catalog_fingerprints: Sequence[Fingerprint],
    winning_offset_frame: int,
    config: SignalConfig,
) -> list[tuple[FingerprintTrace, Fingerprint]]:
    catalog_by_hash: defaultdict[str, list[Fingerprint]] = defaultdict(list)
    for catalog_fingerprint in catalog_fingerprints:
        if catalog_fingerprint.version == config.fingerprint_version:
            catalog_by_hash[catalog_fingerprint.hash_value].append(catalog_fingerprint)

    pairs: list[tuple[FingerprintTrace, Fingerprint]] = []
    for trace in traces:
        query_fingerprint = trace.fingerprint
        if query_fingerprint.version != config.fingerprint_version:
            continue
        for catalog_fingerprint in catalog_by_hash.get(query_fingerprint.hash_value, ()):
            source_offset = catalog_fingerprint.anchor_frame - query_fingerprint.anchor_frame
            if abs(source_offset - winning_offset_frame) > config.offset_tolerance_frames:
                continue
            pairs.append((trace, catalog_fingerprint))

    return pairs


def build_offset_vote_display(
    offset_votes: Sequence[tuple[int, int]],
    winning_offset_frame: int,
    config: SignalConfig = DEFAULT_CONFIG,
    *,
    max_bars: int = MAX_OFFSET_BARS,
) -> list[OffsetVoteDisplay]:
    """Convert deterministic frame votes into bounded, ordered histogram bars."""
    if max_bars <= 0:
        raise ValueError("Maximum offset bars must be positive")
    if not offset_votes:
        return []

    winning_vote = next(
        (vote for vote in offset_votes if vote[0] == winning_offset_frame), None
    )
    strongest = sorted(
        (vote for vote in offset_votes if vote[0] != winning_offset_frame),
        key=lambda vote: (-vote[1], vote[0]),
    )
    if winning_vote is not None:
        retained = [winning_vote, *strongest[: max(0, max_bars - 1)]]
    else:
        retained = strongest[:max_bars]
    retained.sort(key=lambda vote: vote[0])
    frame_seconds = config.hop_length / config.sample_rate
    return [
        OffsetVoteDisplay(
            offset_seconds=float(offset_frame * frame_seconds),
            count=int(count),
            winning=offset_frame == winning_offset_frame,
        )
        for offset_frame, count in retained
    ]


def _sample_evenly[T](items: Sequence[T], limit: int) -> list[T]:
    if len(items) <= limit:
        return list(items)
    if limit == 1:
        return [items[len(items) // 2]]
    indices = [index * (len(items) - 1) // (limit - 1) for index in range(limit)]
    return [items[index] for index in indices]
