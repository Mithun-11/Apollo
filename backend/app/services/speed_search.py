"""Speed search: recognize sped-up, slowed, or pitch-shifted edits of a catalog recording.

Fingerprint hashes store exact frequency bins, so an edit that changes pitch by more than about 1%
shares no hashes with the catalog. Two kinds of edit are searched:

- speed edits (nightcore, slowed): playing a song ``s`` times faster moves each peak from frame t
  to t / s and from frequency bin f to f * s;
- pitch-only edits (deep voice, pitched up): the pitch moves by a factor ``p`` while timing stays.

For each candidate change the recording's peaks are mapped back onto the song's grid and the
normal matcher runs on them. This module is an optional fallback layered on the unchanged signal
core: it only runs after a query fails to match as recorded.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace

from .explanation import WinningFingerprintEvidence
from .signal import (
    DEFAULT_CONFIG,
    Fingerprint,
    FingerprintTrace,
    MatchResult,
    Peak,
    SignalConfig,
    create_fingerprints_with_traces,
    match_fingerprints,
)

CatalogLookup = Callable[[Sequence[Fingerprint]], Mapping[str, Sequence[Fingerprint]]]


@dataclass(frozen=True, slots=True)
class SpeedSearchConfig:
    # Matching tolerates about ±1% pitch, so candidate factors are spaced 1.5% apart.
    min_query_seconds: float = 4.0
    min_factor: float = 0.75
    max_factor: float = 1.35
    factor_step: float = 0.015
    # Two-stage search: a cheap coarse pass (few targets per anchor) scores every candidate, then
    # the full matcher runs only around the best ones. Database lookups dominate the cost.
    coarse_fan_out: int = 2
    refined_candidates: int = 2


DEFAULT_SPEED_SEARCH = SpeedSearchConfig()


@dataclass(frozen=True, slots=True)
class PlaybackChange:
    """How a recording differs from the catalog song.

    ``speed_factor`` > 1 means the recording's timing runs faster; ``pitch_factor`` > 1 means its
    pitch is higher. A speed edit changes both equally; a pitch-only edit keeps speed at 1.
    """

    speed_factor: float
    pitch_factor: float


UNCHANGED = PlaybackChange(speed_factor=1.0, pitch_factor=1.0)


@dataclass(frozen=True, slots=True)
class SpeedSearchMatch:
    result: MatchResult
    change: PlaybackChange
    fingerprints: tuple[Fingerprint, ...]
    traces: tuple[FingerprintTrace, ...]
    catalog: Mapping[str, Sequence[Fingerprint]]


def speed_search_factors(settings: SpeedSearchConfig = DEFAULT_SPEED_SEARCH) -> tuple[float, ...]:
    """Candidate factors in ascending order; 1.0 itself (no change) is excluded."""
    ratio = 1.0 + settings.factor_step
    lowest = math.ceil(math.log(settings.min_factor) / math.log(ratio))
    highest = math.floor(math.log(settings.max_factor) / math.log(ratio))
    return tuple(ratio**step for step in range(lowest, highest + 1) if step != 0)


def candidate_changes(
    settings: SpeedSearchConfig = DEFAULT_SPEED_SEARCH,
) -> tuple[tuple[PlaybackChange, ...], ...]:
    """Candidate edits grouped by kind (speed edits, pitch-only edits), each in ascending order."""
    factors = speed_search_factors(settings)
    return (
        tuple(PlaybackChange(speed_factor=factor, pitch_factor=factor) for factor in factors),
        tuple(PlaybackChange(speed_factor=1.0, pitch_factor=factor) for factor in factors),
    )


def rescale_peaks(peaks: Sequence[Peak], change: PlaybackChange) -> tuple[Peak, ...]:
    """Map a recording's peaks onto the catalog song's time and frequency grid.

    Rescaling detected peaks avoids recomputing the spectrogram for every candidate.
    """
    if change.speed_factor <= 0 or change.pitch_factor <= 0:
        raise ValueError("Speed and pitch factors must be positive")
    return tuple(
        Peak(
            frequency_bin=round(peak.frequency_bin / change.pitch_factor),
            time_frame=round(peak.time_frame * change.speed_factor),
            amplitude_db=peak.amplitude_db,
        )
        for peak in peaks
    )


def search_playback_speeds(
    peaks: Sequence[Peak],
    duration_seconds: float,
    lookup: CatalogLookup,
    config: SignalConfig = DEFAULT_CONFIG,
    settings: SpeedSearchConfig = DEFAULT_SPEED_SEARCH,
) -> SpeedSearchMatch | None:
    """Search candidate edits and return the strongest accepted match, if any.

    ``lookup`` returns the catalog fingerprints sharing a hash with a query, which keeps this
    module free of database code.
    """
    if duration_seconds < settings.min_query_seconds or not peaks:
        return None
    grids = candidate_changes(settings)

    # Coarse pass: score every candidate by its best aligned vote count using few hashes.
    coarse_config = replace(
        config, fan_out=settings.coarse_fan_out, match_threshold=1, min_winner_ratio=0.0
    )
    scores: list[tuple[int, int, int]] = []
    for grid_index, grid in enumerate(grids):
        for position, change in enumerate(grid):
            fingerprints = create_fingerprints_with_traces(
                rescale_peaks(peaks, change), coarse_config
            )[0]
            result = match_fingerprints(fingerprints, lookup(fingerprints), coarse_config)
            scores.append((result.match_count if result is not None else 0, grid_index, position))

    # Refined pass: the full matcher at the best candidates and their grid neighbours.
    refined: dict[PlaybackChange, None] = {}
    for score, grid_index, position in sorted(scores, reverse=True)[: settings.refined_candidates]:
        if score == 0:
            continue
        grid = grids[grid_index]
        for neighbour in (position, position - 1, position + 1):
            if 0 <= neighbour < len(grid):
                refined.setdefault(grid[neighbour], None)

    best: SpeedSearchMatch | None = None
    for change in refined:
        fingerprints, traces = create_fingerprints_with_traces(rescale_peaks(peaks, change), config)
        catalog = lookup(fingerprints)
        result = match_fingerprints(fingerprints, catalog, config)
        if result is not None and (best is None or result.match_count > best.result.match_count):
            best = SpeedSearchMatch(result, change, fingerprints, traces, catalog)
    return best


def map_evidence_to_recording(
    evidence: WinningFingerprintEvidence,
    recording_peaks: Sequence[Peak],
    change: PlaybackChange,
) -> WinningFingerprintEvidence:
    """Express winning evidence found on the song's grid in the recording's own coordinates.

    Speed-search traces use rescaled peaks; the explanation plots the recording, so matched peaks
    and alignment lines are mapped back with the same rounding that produced them.
    """
    if change == UNCHANGED:
        return evidence
    recorded: dict[tuple[int, int], Peak] = {}
    for original, rescaled in zip(
        recording_peaks, rescale_peaks(recording_peaks, change), strict=True
    ):
        recorded.setdefault((rescaled.time_frame, rescaled.frequency_bin), original)

    traces: list[FingerprintTrace] = []
    for trace in evidence.traces:
        anchor = recorded.get((trace.fingerprint.anchor_frame, trace.anchor_frequency_bin))
        target = recorded.get((trace.target_frame, trace.target_frequency_bin))
        if anchor is None or target is None:
            continue
        traces.append(
            FingerprintTrace(
                fingerprint=replace(trace.fingerprint, anchor_frame=anchor.time_frame),
                anchor_frequency_bin=anchor.frequency_bin,
                target_frequency_bin=target.frequency_bin,
                target_frame=target.time_frame,
            )
        )
    matches = tuple(
        replace(
            match,
            query_anchor_seconds=match.query_anchor_seconds / change.speed_factor,
            query_target_seconds=match.query_target_seconds / change.speed_factor,
            anchor_frequency_hz=match.anchor_frequency_hz * change.pitch_factor,
            target_frequency_hz=match.target_frequency_hz * change.pitch_factor,
        )
        for match in evidence.matched_fingerprints
    )
    return WinningFingerprintEvidence(traces=tuple(traces), matched_fingerprints=matches)
