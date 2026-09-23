"""Melody matching: recognize live versions, covers, and crowds singing a catalog song.

Fingerprints only match the exact recording. A different performance keeps the song's melody and
harmony instead, so this fallback compares those:

- the sung melody (pYIN pitch contour of the separated vocals, in semitones);
- the notes of the vocals (chroma of the separated vocals);
- the notes of the whole mix (chroma of the full recording).

Each comparison tries all 12 keys and uses subsequence dynamic time warping, so a performance may
be in another key, at another tempo, and start anywhere in the song. The three costs are turned
into z-scores across the catalog, weighted, and the best song is accepted only when it clearly
beats the runner-up. Vocal separation happens outside this module (see ``vocal_separation``);
these functions take ordinary NumPy arrays and never touch the database.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import cast

import librosa
import numpy as np
from numba import njit, prange
from numpy.typing import NDArray
from scipy.signal import medfilt

FloatArray = NDArray[np.float64]
# Numba parallelises loops over prange; typed here because numba ships no annotations.
parallel_range = cast(Callable[[int], range], prange)


@dataclass(frozen=True, slots=True)
class MelodyConfig:
    sample_rate: int = 16_000
    pitch_frame_length: int = 1_024
    pitch_hop_length: int = 320  # 20 ms pitch frames
    pitch_block_frames: int = 5  # 5 pitch frames -> 10 contour frames per second
    min_pitch_hz: float = 80.0
    max_pitch_hz: float = 1_000.0
    melody_cost_cap_semitones: float = 3.0
    chroma_hop_length: int = 512
    chroma_decimation: int = 3  # about 10 chroma frames per second
    vocal_chroma_smoothing: int = 11
    mix_chroma_smoothing: int = 21
    melody_weight: float = 1.0
    vocal_chroma_weight: float = 2.0
    mix_chroma_weight: float = 1.0
    # Calibrated on 41 real covers/live versions and 6 songs outside a 21-song catalog.
    min_query_seconds: float = 8.0
    min_voiced_fraction: float = 0.3
    min_score_gap: float = 1.2
    min_catalog_songs: int = 3
    feature_version: str = "melody-1"


DEFAULT_MELODY_CONFIG = MelodyConfig()


@dataclass(frozen=True, slots=True)
class MelodyFeatures:
    """Melody contour (semitones, voiced frames only) and unit-norm 12 x T chroma matrices."""

    melody: FloatArray
    vocal_chroma: FloatArray
    mix_chroma: FloatArray


@dataclass(frozen=True, slots=True)
class MelodyMatch:
    song_id: str
    score: float
    score_gap: float
    timestamp_seconds: float
    key_shift_semitones: int
    ranking: tuple[tuple[str, float], ...]


def extract_melody(vocals: FloatArray, config: MelodyConfig = DEFAULT_MELODY_CONFIG) -> FloatArray:
    """Sung melody in fractional MIDI at 10 frames per second; unvoiced frames are dropped."""
    if vocals.size < config.pitch_frame_length:
        return np.zeros(0)
    f0, voiced, _ = librosa.pyin(
        vocals,
        fmin=config.min_pitch_hz,
        fmax=config.max_pitch_hz,
        sr=config.sample_rate,
        frame_length=config.pitch_frame_length,
        hop_length=config.pitch_hop_length,
    )
    midi = np.where(voiced, librosa.hz_to_midi(np.nan_to_num(f0, nan=1.0)), np.nan)
    block = config.pitch_block_frames
    count = len(midi) // block
    blocks = midi[: count * block].reshape(count, block)
    voiced_blocks = np.sum(~np.isnan(blocks), axis=1) > block // 2
    if not voiced_blocks.any():
        return np.zeros(0)
    melody = np.nanmedian(blocks[voiced_blocks], axis=1)
    if len(melody) >= 5:
        melody = medfilt(melody, 5)
    return np.asarray(melody, dtype=np.float64)


def extract_chroma(audio: FloatArray, smoothing: int, config: MelodyConfig) -> FloatArray:
    """CENS chroma (12 x frames) at about 10 frames per second, each frame unit length."""
    chroma = librosa.feature.chroma_cens(
        y=audio,
        sr=config.sample_rate,
        hop_length=config.chroma_hop_length,
        win_len_smooth=smoothing,
    )[:, :: config.chroma_decimation]
    norms = np.linalg.norm(chroma, axis=0, keepdims=True) + 1e-9
    return np.ascontiguousarray(chroma / norms, dtype=np.float64)


def extract_features(
    vocals: FloatArray, mix: FloatArray, config: MelodyConfig = DEFAULT_MELODY_CONFIG
) -> MelodyFeatures:
    """Features of separated vocals and the full mix, both mono at ``config.sample_rate``."""
    return MelodyFeatures(
        melody=extract_melody(vocals, config),
        vocal_chroma=extract_chroma(vocals, config.vocal_chroma_smoothing, config),
        mix_chroma=extract_chroma(mix, config.mix_chroma_smoothing, config),
    )


def chroma_frames_per_second(config: MelodyConfig = DEFAULT_MELODY_CONFIG) -> float:
    return config.sample_rate / (config.chroma_hop_length * config.chroma_decimation)


@njit(cache=True, parallel=True)
def _melody_dtw_all_keys(
    query: FloatArray, song: FloatArray, cap: float
) -> tuple[FloatArray, NDArray[np.int64]]:
    """Subsequence DTW of an octave-folded pitch distance for all 12 key shifts.

    Steps (1,1), (1,2), (2,1) allow tempo ratios between 0.5 and 2; every query frame is paid
    exactly once, so the result is the mean cost per query frame. Returns (cost, start) per key.
    """
    costs = np.empty(12)
    starts = np.empty(12, dtype=np.int64)
    n, m = query.shape[0], song.shape[0]
    for shift in parallel_range(12):
        big = 1e18
        prev2 = np.full(m, big)
        prev2_start = np.zeros(m, dtype=np.int64)
        prev = np.empty(m)
        prev_start = np.empty(m, dtype=np.int64)
        for j in range(m):
            d = (query[0] - song[j] + shift) % 12.0
            prev[j] = min(min(d, 12.0 - d), cap)
            prev_start[j] = j
        cur = np.empty(m)
        cur_start = np.empty(m, dtype=np.int64)
        for i in range(1, n):
            cur[0] = big
            cur_start[0] = 0
            for j in range(1, m):
                best = prev[j - 1]
                origin = prev_start[j - 1]
                if j >= 2 and prev[j - 2] < best:
                    best = prev[j - 2]
                    origin = prev_start[j - 2]
                if i >= 2 and prev2[j - 1] < big:
                    d = (query[i - 1] - song[j] + shift) % 12.0
                    candidate = prev2[j - 1] + min(min(d, 12.0 - d), cap)
                    if candidate < best:
                        best = candidate
                        origin = prev2_start[j - 1]
                d = (query[i] - song[j] + shift) % 12.0
                cur[j] = best + min(min(d, 12.0 - d), cap)
                cur_start[j] = origin
            prev2, prev2_start, prev, prev_start, cur, cur_start = (
                prev, prev_start, cur, cur_start, prev2, prev2_start
            )
        end = 0
        for j in range(m):
            if prev[j] < prev[end]:
                end = j
        costs[shift] = prev[end] / n
        starts[shift] = prev_start[end]
    return costs, starts


@njit(cache=True, parallel=True)
def _chroma_dtw_all_keys(
    query: FloatArray, song: FloatArray
) -> tuple[FloatArray, NDArray[np.int64]]:
    """Same recursion with cost 1 - cosine similarity between key-shifted chroma frames."""
    costs = np.empty(12)
    starts = np.empty(12, dtype=np.int64)
    n, m = query.shape[1], song.shape[1]
    for shift in parallel_range(12):
        rolled = np.empty((12, n))
        for c in range(12):
            rolled[c] = query[(c - shift) % 12]
        big = 1e18
        prev2 = np.full(m, big)
        prev2_start = np.zeros(m, dtype=np.int64)
        prev = np.empty(m)
        prev_start = np.empty(m, dtype=np.int64)
        for j in range(m):
            dot = 0.0
            for c in range(12):
                dot += rolled[c, 0] * song[c, j]
            prev[j] = 1.0 - dot
            prev_start[j] = j
        cur = np.empty(m)
        cur_start = np.empty(m, dtype=np.int64)
        # Two row buffers swapped each row; allocating inside the loop is unsafe under prange.
        previous_row_cost = np.empty(m)
        row_cost = np.empty(m)
        for j in range(m):
            previous_row_cost[j] = prev[j]
        for i in range(1, n):
            for j in range(m):
                dot = 0.0
                for c in range(12):
                    dot += rolled[c, i] * song[c, j]
                row_cost[j] = 1.0 - dot
            cur[0] = big
            cur_start[0] = 0
            for j in range(1, m):
                best = prev[j - 1]
                origin = prev_start[j - 1]
                if j >= 2 and prev[j - 2] < best:
                    best = prev[j - 2]
                    origin = prev_start[j - 2]
                if i >= 2 and prev2[j - 1] < big:
                    candidate = prev2[j - 1] + previous_row_cost[j]
                    if candidate < best:
                        best = candidate
                        origin = prev2_start[j - 1]
                cur[j] = best + row_cost[j]
                cur_start[j] = origin
            previous_row_cost, row_cost = row_cost, previous_row_cost
            prev2, prev2_start, prev, prev_start, cur, cur_start = (
                prev, prev_start, cur, cur_start, prev2, prev2_start
            )
        end = 0
        for j in range(m):
            if prev[j] < prev[end]:
                end = j
        costs[shift] = prev[end] / n
        starts[shift] = prev_start[end]
    return costs, starts


def melody_cost(
    query: FloatArray, song: FloatArray, config: MelodyConfig = DEFAULT_MELODY_CONFIG
) -> tuple[float, int, int]:
    """Best (mean cost, song start frame, key shift) of a melody against a longer melody."""
    if len(query) < 2 or len(song) <= len(query):
        return float("nan"), 0, 0
    costs, starts = _melody_dtw_all_keys(
        np.ascontiguousarray(query, dtype=np.float64),
        np.ascontiguousarray(song, dtype=np.float64),
        config.melody_cost_cap_semitones,
    )
    shift = int(np.argmin(costs))
    return float(costs[shift]), int(starts[shift]), shift


def chroma_cost(query: FloatArray, song: FloatArray) -> tuple[float, int, int]:
    """Best (mean cost, song start frame, key shift) of a chroma sequence inside a song."""
    if query.shape[1] < 2 or song.shape[1] < 2:
        return float("nan"), 0, 0
    costs, starts = _chroma_dtw_all_keys(
        np.ascontiguousarray(query, dtype=np.float64),
        np.ascontiguousarray(song, dtype=np.float64),
    )
    shift = int(np.argmin(costs))
    return float(costs[shift]), int(starts[shift]), shift


def _zscores(costs: FloatArray) -> FloatArray:
    """Higher is better; songs without a cost score 0 (the catalog mean)."""
    valid = ~np.isnan(costs)
    scores = np.zeros(len(costs))
    if valid.sum() >= 3:
        spread = float(costs[valid].std()) + 1e-9
        scores[valid] = (float(costs[valid].mean()) - costs[valid]) / spread
    return scores


def has_enough_singing(
    query: MelodyFeatures, duration_seconds: float, config: MelodyConfig = DEFAULT_MELODY_CONFIG
) -> bool:
    contour_fps = config.sample_rate / (config.pitch_hop_length * config.pitch_block_frames)
    return len(query.melody) >= config.min_voiced_fraction * duration_seconds * contour_fps


def match_melody(
    query: MelodyFeatures,
    duration_seconds: float,
    catalog: Mapping[str, MelodyFeatures],
    config: MelodyConfig = DEFAULT_MELODY_CONFIG,
) -> MelodyMatch | None:
    """Rank catalog songs by melody and harmony similarity; accept only a clear winner."""
    if duration_seconds < config.min_query_seconds or len(catalog) < config.min_catalog_songs:
        return None
    if not has_enough_singing(query, duration_seconds, config):
        return None

    song_ids = list(catalog)
    melody_costs = np.full(len(song_ids), np.nan)
    vocal_costs = np.full(len(song_ids), np.nan)
    mix_costs = np.full(len(song_ids), np.nan)
    vocal_results: list[tuple[float, int, int]] = []
    for index, song_id in enumerate(song_ids):
        song = catalog[song_id]
        melody_costs[index] = melody_cost(query.melody, song.melody, config)[0]
        vocal_result = chroma_cost(query.vocal_chroma, song.vocal_chroma)
        vocal_results.append(vocal_result)
        vocal_costs[index] = vocal_result[0]
        mix_costs[index] = chroma_cost(query.mix_chroma, song.mix_chroma)[0]

    weights = (config.melody_weight, config.vocal_chroma_weight, config.mix_chroma_weight)
    scores = (
        weights[0] * _zscores(melody_costs)
        + weights[1] * _zscores(vocal_costs)
        + weights[2] * _zscores(mix_costs)
    ) / sum(weights)
    order = np.argsort(-scores)
    best, runner_up = int(order[0]), int(order[1])
    gap = float(scores[best] - scores[runner_up])
    if gap < config.min_score_gap:
        return None
    _, start_frame, key_shift = vocal_results[best]
    return MelodyMatch(
        song_id=song_ids[best],
        score=float(scores[best]),
        score_gap=gap,
        timestamp_seconds=start_frame / chroma_frames_per_second(config),
        # The query was rolled up by ``key_shift`` to meet the song; report the singer's offset.
        key_shift_semitones=((-key_shift + 6) % 12) - 6,
        ranking=tuple((song_ids[int(i)], float(scores[int(i)])) for i in order[:3]),
    )


def features_to_blobs(features: MelodyFeatures) -> tuple[bytes, bytes, bytes]:
    return (
        np.asarray(features.melody, dtype=np.float32).tobytes(),
        np.asarray(features.vocal_chroma, dtype=np.float32).tobytes(),
        np.asarray(features.mix_chroma, dtype=np.float32).tobytes(),
    )


def features_from_blobs(melody: bytes, vocal_chroma: bytes, mix_chroma: bytes) -> MelodyFeatures:
    def chroma(blob: bytes) -> FloatArray:
        values = np.frombuffer(blob, dtype=np.float32).astype(np.float64)
        return np.ascontiguousarray(values.reshape(12, -1))

    return MelodyFeatures(
        melody=np.frombuffer(melody, dtype=np.float32).astype(np.float64),
        vocal_chroma=chroma(vocal_chroma),
        mix_chroma=chroma(mix_chroma),
    )
