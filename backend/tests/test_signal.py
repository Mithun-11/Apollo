from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.services.signal import (
    DEFAULT_CONFIG,
    Peak,
    SignalConfig,
    create_fingerprints,
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
