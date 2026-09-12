from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.services.signal import (
    DEFAULT_CONFIG,
    Fingerprint,
    FingerprintTrace,
    Peak,
    SignalConfig,
    create_fingerprints,
    create_fingerprints_with_traces,
    extract_peaks,
    load_audio,
    match_fingerprints,
)


def test_load_audio_converts_to_normalized_mono_at_target_rate(tmp_path: Path) -> None:
    source_rate = 44_100
    time = np.arange(source_rate, dtype=np.float32) / source_rate
    stereo = np.column_stack(
        (
            0.25 * np.sin(2 * np.pi * 440 * time),
            0.50 * np.sin(2 * np.pi * 660 * time),
        )
    )
    path = tmp_path / "stereo.wav"
    sf.write(path, stereo, source_rate, subtype="PCM_16")

    audio = load_audio(path)

    assert audio.sample_rate == DEFAULT_CONFIG.sample_rate
    assert audio.samples.ndim == 1
    assert len(audio.samples) == pytest.approx(DEFAULT_CONFIG.sample_rate, abs=2)
    assert np.max(np.abs(audio.samples)) == pytest.approx(1.0)


def test_extract_peaks_returns_spectrogram_and_local_maxima() -> None:
    config = SignalConfig(sample_rate=8_000, n_fft=512, hop_length=128)
    time = np.arange(config.sample_rate * 2, dtype=np.float32) / config.sample_rate
    samples = (
        np.sin(2 * np.pi * 440 * time)
        + 0.7 * np.sin(2 * np.pi * 1_200 * time) * np.sin(2 * np.pi * 2 * time)
    ).astype(np.float32)

    result = extract_peaks(samples, config)

    assert result.spectrogram_db.shape[0] == config.n_fft // 2 + 1
    assert result.peaks
    assert all(0 <= peak.frequency_bin < result.spectrogram_db.shape[0] for peak in result.peaks)
    assert all(0 <= peak.time_frame < result.spectrogram_db.shape[1] for peak in result.peaks)


def test_create_fingerprints_is_deterministic() -> None:
    config = SignalConfig(fan_out=3, min_time_delta_frames=1, max_time_delta_frames=8)
    peaks = (
        Peak(frequency_bin=10, time_frame=0, amplitude_db=-1.0),
        Peak(frequency_bin=25, time_frame=2, amplitude_db=-2.0),
        Peak(frequency_bin=40, time_frame=5, amplitude_db=-3.0),
        Peak(frequency_bin=15, time_frame=8, amplitude_db=-4.0),
    )

    first = create_fingerprints(peaks, config)
    second = create_fingerprints(peaks, config)

    assert first == second
    assert first
    assert all(len(fingerprint.hash_value) == 16 for fingerprint in first)
    assert all(fingerprint.version == config.fingerprint_version for fingerprint in first)
    assert tuple(fingerprint.hash_value for fingerprint in first) == (
        "3279a0446350426c",
        "68873a849acee4da",
        "089f025cd3e72db0",
        "0ebfc1589132716c",
        "00f68b9a6ab64c22",
        "a65ca34f49edd8e5",
    )


def test_fingerprint_traces_match_fingerprints_in_deterministic_order() -> None:
    config = SignalConfig(fan_out=2, min_time_delta_frames=1, max_time_delta_frames=8)
    peaks = (
        Peak(frequency_bin=10, time_frame=0, amplitude_db=-1.0),
        Peak(frequency_bin=25, time_frame=2, amplitude_db=-2.0),
        Peak(frequency_bin=40, time_frame=5, amplitude_db=-3.0),
        Peak(frequency_bin=15, time_frame=8, amplitude_db=-4.0),
    )

    fingerprints, traces = create_fingerprints_with_traces(peaks, config)

    assert create_fingerprints(peaks, config) == fingerprints
    assert tuple(trace.fingerprint for trace in traces) == fingerprints
    assert all(isinstance(trace, FingerprintTrace) for trace in traces)
    assert tuple(
        (trace.anchor_frequency_bin, trace.target_frequency_bin, trace.target_frame)
        for trace in traces
    ) == (
        (10, 25, 2),
        (10, 40, 5),
        (25, 40, 5),
        (25, 15, 8),
        (40, 15, 8),
    )


def test_match_fingerprints_returns_song_and_source_timestamp() -> None:
    config = SignalConfig(
        sample_rate=8_000,
        hop_length=100,
        fan_out=3,
        min_time_delta_frames=1,
        max_time_delta_frames=8,
        match_threshold=3,
    )
    query_peaks = (
        Peak(frequency_bin=10, time_frame=0, amplitude_db=-1.0),
        Peak(frequency_bin=25, time_frame=2, amplitude_db=-2.0),
        Peak(frequency_bin=40, time_frame=5, amplitude_db=-3.0),
        Peak(frequency_bin=15, time_frame=8, amplitude_db=-4.0),
    )
    catalog_peaks = tuple(
        Peak(peak.frequency_bin, peak.time_frame + 240, peak.amplitude_db)
        for peak in query_peaks
    )
    distractor_peaks = tuple(
        Peak(peak.frequency_bin + 100, peak.time_frame + 50, peak.amplitude_db)
        for peak in query_peaks
    )

    result = match_fingerprints(
        create_fingerprints(query_peaks, config),
        {
            "source-song": create_fingerprints(catalog_peaks, config),
            "other-song": create_fingerprints(distractor_peaks, config),
        },
        config,
    )

    assert result is not None
    assert result.song_id == "source-song"
    assert result.offset_frame == 240
    assert result.timestamp_seconds == pytest.approx(3.0)
    assert result.match_count >= config.match_threshold


def test_match_fingerprints_rejects_weak_query_support() -> None:
    config = SignalConfig(
        match_threshold=5,
        min_match_ratio=0.2,
        min_winner_ratio=1.0,
    )
    query = tuple(
        Fingerprint(f"query-{index}", anchor_frame=index, version=config.fingerprint_version)
        for index in range(100)
    )
    catalog = tuple(
        Fingerprint(
            fingerprint.hash_value,
            anchor_frame=fingerprint.anchor_frame + 50,
            version=config.fingerprint_version,
        )
        for fingerprint in query[:10]
    )

    assert match_fingerprints(query, {"accidental-song": catalog}, config) is None


def test_match_fingerprints_rejects_votes_below_absolute_threshold() -> None:
    config = SignalConfig(
        match_threshold=6,
        min_match_ratio=0.0,
        min_winner_ratio=1.0,
    )
    query = tuple(
        Fingerprint(f"query-{index}", anchor_frame=index, version=config.fingerprint_version)
        for index in range(5)
    )
    catalog = tuple(
        Fingerprint(
            fingerprint.hash_value,
            anchor_frame=fingerprint.anchor_frame + 50,
            version=config.fingerprint_version,
        )
        for fingerprint in query
    )

    assert match_fingerprints(query, {"weak-song": catalog}, config) is None


def test_match_fingerprints_rejects_ambiguous_competing_song() -> None:
    config = SignalConfig(
        match_threshold=5,
        min_match_ratio=0.0,
        min_winner_ratio=1.5,
    )
    query = tuple(
        Fingerprint(f"query-{index}", anchor_frame=index, version=config.fingerprint_version)
        for index in range(10)
    )
    narrow_winner = tuple(
        Fingerprint(
            fingerprint.hash_value,
            anchor_frame=fingerprint.anchor_frame + 100,
            version=config.fingerprint_version,
        )
        for fingerprint in query
    )
    close_runner_up = tuple(
        Fingerprint(
            fingerprint.hash_value,
            anchor_frame=fingerprint.anchor_frame + 200,
            version=config.fingerprint_version,
        )
        for fingerprint in query[:8]
    )

    assert (
        match_fingerprints(
            query,
            {"narrow-winner": narrow_winner, "close-runner-up": close_runner_up},
            config,
        )
        is None
    )


def test_match_fingerprints_accepts_clear_winner() -> None:
    config = SignalConfig(
        match_threshold=5,
        min_match_ratio=0.5,
        min_winner_ratio=1.5,
    )
    query = tuple(
        Fingerprint(f"query-{index}", anchor_frame=index, version=config.fingerprint_version)
        for index in range(10)
    )
    clear_winner = tuple(
        Fingerprint(
            fingerprint.hash_value,
            anchor_frame=fingerprint.anchor_frame + 100,
            version=config.fingerprint_version,
        )
        for fingerprint in query
    )
    runner_up = tuple(
        Fingerprint(
            fingerprint.hash_value,
            anchor_frame=fingerprint.anchor_frame + 200,
            version=config.fingerprint_version,
        )
        for fingerprint in query[:5]
    )

    result = match_fingerprints(
        query,
        {"clear-winner": clear_winner, "runner-up": runner_up},
        config,
    )

    assert result is not None
    assert result.song_id == "clear-winner"
    assert result.match_count == 10
