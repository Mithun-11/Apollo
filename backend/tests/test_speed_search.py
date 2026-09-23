from contextlib import closing
from pathlib import Path

import librosa
import numpy as np
import pytest
import soundfile as sf

from app import catalog
from app.database import connect_database, initialize_database
from app.services.explanation import MatchedFingerprintDisplay, WinningFingerprintEvidence
from app.services.signal import DEFAULT_CONFIG, Fingerprint, FingerprintTrace, Peak
from app.services.speed_search import (
    PlaybackChange,
    SpeedSearchConfig,
    candidate_changes,
    map_evidence_to_recording,
    rescale_peaks,
    search_playback_speeds,
    speed_search_factors,
)

SAMPLE_RATE = DEFAULT_CONFIG.sample_rate


def _synthetic_song(seconds: float, seed: int, pitch_factor: float = 1.0) -> np.ndarray:
    """A deterministic 'song': a new random chord with harmonics every quarter second.

    ``pitch_factor`` renders the same song with every frequency scaled and timing unchanged.
    """
    rng = np.random.default_rng(seed)
    note_samples = SAMPLE_RATE // 4
    time = np.arange(note_samples) / SAMPLE_RATE
    notes = []
    for _ in range(int(seconds * 4)):
        chord = np.zeros(note_samples)
        for frequency in rng.uniform(200.0, 1_600.0, size=3) * pitch_factor:
            for harmonic in (1, 2, 3):
                chord += np.sin(2 * np.pi * frequency * harmonic * time) / harmonic
        notes.append(chord * np.hanning(note_samples))
    return np.concatenate(notes).astype(np.float32)


def _played_at(samples: np.ndarray, speed_factor: float) -> np.ndarray:
    """Play audio faster (> 1) or slower (< 1): tempo and pitch change together."""
    return librosa.resample(
        samples, orig_sr=round(SAMPLE_RATE * speed_factor), target_sr=SAMPLE_RATE
    ).astype(np.float32)


def test_speed_search_factors_cover_the_range_evenly() -> None:
    settings = SpeedSearchConfig(min_factor=0.8, max_factor=1.25, factor_step=0.02)

    factors = speed_search_factors(settings)

    assert 1.0 not in factors
    assert list(factors) == sorted(factors)
    assert factors[0] < 0.82 and factors[-1] > 1.22
    assert all(0.8 <= factor <= 1.25 for factor in factors)
    assert factors[1] / factors[0] == pytest.approx(1.02)


def test_candidate_changes_cover_speed_and_pitch_only_edits() -> None:
    speed_edits, pitch_edits = candidate_changes()

    assert all(change.speed_factor == change.pitch_factor for change in speed_edits)
    assert all(change.speed_factor == 1.0 for change in pitch_edits)
    assert [change.pitch_factor for change in speed_edits] == list(speed_search_factors())


def test_rescale_peaks_inverts_speed_and_pitch_changes() -> None:
    peaks = (Peak(frequency_bin=120, time_frame=40, amplitude_db=-3.0),)

    assert rescale_peaks(peaks, PlaybackChange(1.25, 1.25)) == (
        Peak(frequency_bin=96, time_frame=50, amplitude_db=-3.0),
    )
    assert rescale_peaks(peaks, PlaybackChange(1.0, 1.25)) == (
        Peak(frequency_bin=96, time_frame=40, amplitude_db=-3.0),
    )
    with pytest.raises(ValueError):
        rescale_peaks(peaks, PlaybackChange(0.0, 1.0))


def test_search_is_skipped_for_short_queries() -> None:
    peaks = (Peak(frequency_bin=120, time_frame=40, amplitude_db=-3.0),)

    def lookup(_fingerprints: object) -> dict[str, list[Fingerprint]]:
        raise AssertionError("short queries must not be searched")

    assert search_playback_speeds(peaks, 2.0, lookup) is None


def test_recognize_file_identifies_speed_and_pitch_edits(tmp_path: Path) -> None:
    song = _synthetic_song(40.0, seed=11)
    song_path = tmp_path / "song.wav"
    sf.write(song_path, song, SAMPLE_RATE)
    start_seconds = 12.0
    segment = song[int(start_seconds * SAMPLE_RATE) : int((start_seconds + 12.0) * SAMPLE_RATE)]
    clips = {
        "original": segment,
        "nightcore": _played_at(segment, 1.2),
        "deep_voice": _synthetic_song(40.0, seed=11, pitch_factor=2 ** (-2 / 12))[
            int(start_seconds * SAMPLE_RATE) : int((start_seconds + 12.0) * SAMPLE_RATE)
        ],
    }
    for name, samples in clips.items():
        sf.write(tmp_path / f"{name}.wav", samples, SAMPLE_RATE)
    database_path = initialize_database(tmp_path / "apollo.db")

    with closing(connect_database(database_path)) as connection:
        catalog.ingest_song(
            song_path, "Synthetic Song", "https://open.spotify.com/track/synthetic", connection
        )
        results = {
            name: catalog.recognize_file(tmp_path / f"{name}.wav", connection) for name in clips
        }

    assert all(result["matched"] is True for result in results.values())
    assert all(result["song"]["name"] == "Synthetic Song" for result in results.values())
    assert all(
        result["timestampSeconds"] == pytest.approx(start_seconds, abs=0.1)
        for result in results.values()
    )
    assert results["original"]["speedFactor"] == 1.0
    assert results["original"]["pitchFactor"] == 1.0
    assert results["nightcore"]["speedFactor"] == pytest.approx(1.2, rel=0.02)
    assert results["nightcore"]["pitchFactor"] == pytest.approx(1.2, rel=0.02)
    assert results["deep_voice"]["speedFactor"] == 1.0
    assert results["deep_voice"]["pitchFactor"] == pytest.approx(2 ** (-2 / 12), rel=0.02)


def test_map_evidence_to_recording_restores_recorded_coordinates() -> None:
    change = PlaybackChange(speed_factor=1.25, pitch_factor=1.25)
    recording_peaks = (
        Peak(frequency_bin=120, time_frame=40, amplitude_db=-1.0),
        Peak(frequency_bin=140, time_frame=48, amplitude_db=-2.0),
    )
    anchor, target = rescale_peaks(recording_peaks, change)
    trace = FingerprintTrace(
        fingerprint=Fingerprint("0000000000000001", anchor.time_frame, "3"),
        anchor_frequency_bin=anchor.frequency_bin,
        target_frequency_bin=target.frequency_bin,
        target_frame=target.time_frame,
    )
    match = MatchedFingerprintDisplay(
        query_anchor_seconds=2.5,
        query_target_seconds=3.0,
        source_anchor_seconds=62.5,
        source_target_seconds=63.0,
        anchor_frequency_hz=1_000.0,
        target_frequency_hz=1_200.0,
    )

    mapped = map_evidence_to_recording(
        WinningFingerprintEvidence(traces=(trace,), matched_fingerprints=(match,)),
        recording_peaks,
        change,
    )

    (mapped_trace,) = mapped.traces
    assert (mapped_trace.fingerprint.anchor_frame, mapped_trace.anchor_frequency_bin) == (40, 120)
    assert (mapped_trace.target_frame, mapped_trace.target_frequency_bin) == (48, 140)
    (mapped_match,) = mapped.matched_fingerprints
    assert mapped_match.query_anchor_seconds == pytest.approx(2.0)
    assert mapped_match.anchor_frequency_hz == pytest.approx(1_250.0)
    assert mapped_match.source_anchor_seconds == 62.5
