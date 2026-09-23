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
    analyze_fingerprint_match,
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
        "945c5ba681702411",
        "88684a83c9d516d8",
        "71c89fdb952a8d3e",
        "70ee8d622409d817",
        "5acf571ebd795750",
        "7e30a836f3d56c21",
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
        Peak(peak.frequency_bin, peak.time_frame + 240, peak.amplitude_db) for peak in query_peaks
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


def test_match_fingerprints_ignores_negative_offsets() -> None:
    config = SignalConfig(match_threshold=5, min_winner_ratio=1.0)
    query = tuple(
        Fingerprint(f"query-{index}", anchor_frame=100 + index, version=config.fingerprint_version)
        for index in range(10)
    )
    catalog = tuple(
        Fingerprint(
            fingerprint.hash_value,
            anchor_frame=fingerprint.anchor_frame - 50,
            version=config.fingerprint_version,
        )
        for fingerprint in query
    )

    assert match_fingerprints(query, {"before-song-start": catalog}, config) is None


def test_match_fingerprints_is_not_diluted_by_unmatched_query_hashes() -> None:
    config = SignalConfig(match_threshold=10, min_winner_ratio=2.0)
    query = tuple(
        Fingerprint(f"query-{index}", anchor_frame=index, version=config.fingerprint_version)
        for index in range(5_000)
    )
    catalog = tuple(
        Fingerprint(
            fingerprint.hash_value,
            anchor_frame=fingerprint.anchor_frame + 50,
            version=config.fingerprint_version,
        )
        for fingerprint in query[:12]
    )

    result = match_fingerprints(query, {"noisy-recording": catalog}, config)

    assert result is not None
    assert result.song_id == "noisy-recording"
    assert result.match_count == 12


def test_match_fingerprints_combines_adjacent_offset_frames() -> None:
    config = SignalConfig(match_threshold=3, min_winner_ratio=1.0, offset_tolerance_frames=1)
    query = tuple(
        Fingerprint(f"query-{index}", anchor_frame=index * 10, version=config.fingerprint_version)
        for index in range(3)
    )
    catalog = tuple(
        Fingerprint(
            fingerprint.hash_value,
            anchor_frame=fingerprint.anchor_frame + shift,
            version=config.fingerprint_version,
        )
        for fingerprint, shift in zip(query, (99, 99, 101), strict=True)
    )

    result = match_fingerprints(query, {"source-song": catalog}, config)

    assert result is not None
    assert result.offset_frame == 100
    assert result.match_count == 3
    assert result.offset_votes == ((99, 2), (101, 1))


def test_match_diagnostics_expose_the_same_clustered_winner_as_recognition() -> None:
    config = SignalConfig(match_threshold=3, min_winner_ratio=2.0, offset_tolerance_frames=1)
    query = tuple(
        Fingerprint(f"query-{index}", anchor_frame=index * 10, version=config.fingerprint_version)
        for index in range(3)
    )
    catalog = {
        "source-song": tuple(
            Fingerprint(
                fingerprint.hash_value, fingerprint.anchor_frame + shift, config.fingerprint_version
            )
            for fingerprint, shift in zip(query, (99, 99, 101), strict=True)
        ),
        "other-song": (
            Fingerprint(
                query[0].hash_value, query[0].anchor_frame + 200, config.fingerprint_version
            ),
        ),
    }

    diagnostics = analyze_fingerprint_match(query, catalog, config)

    assert diagnostics.result == match_fingerprints(query, catalog, config)
    assert diagnostics.reason == "accepted"
    assert diagnostics.leading is not None
    assert (
        diagnostics.leading.song_id,
        diagnostics.leading.offset_frame,
        diagnostics.leading.votes,
    ) == ("source-song", 100, 3)
    assert diagnostics.raw_offset_votes == ((99, 2), (101, 1))
    assert (100, 3) in diagnostics.clustered_offset_votes
    assert diagnostics.runner_up_votes == 1


def test_match_diagnostics_explain_threshold_and_competitor_rejections() -> None:
    config = SignalConfig(match_threshold=3, min_winner_ratio=2.0)
    query = tuple(
        Fingerprint(f"hash-{index}", index, config.fingerprint_version) for index in range(3)
    )
    weak_catalog = {"weak": (Fingerprint(query[0].hash_value, 100, config.fingerprint_version),)}
    tied_catalog = {
        "a": tuple(
            Fingerprint(item.hash_value, item.anchor_frame + 100, config.fingerprint_version)
            for item in query
        ),
        "b": tuple(
            Fingerprint(item.hash_value, item.anchor_frame + 200, config.fingerprint_version)
            for item in query
        ),
    }

    assert analyze_fingerprint_match(query, weak_catalog, config).reason == "below_threshold"
    ambiguous = analyze_fingerprint_match(query, tied_catalog, config)
    assert ambiguous.reason == "ambiguous"
    assert ambiguous.result is None
    assert ambiguous.leading is not None
    assert ambiguous.leading.votes == ambiguous.runner_up_votes == 3


def test_match_diagnostics_distinguish_hash_hits_with_impossible_offsets() -> None:
    config = SignalConfig()
    query = (Fingerprint("same-hash", anchor_frame=20, version=config.fingerprint_version),)
    catalog = {
        "song": (Fingerprint("same-hash", anchor_frame=10, version=config.fingerprint_version),)
    }

    assert analyze_fingerprint_match(query, catalog, config).reason == "no_valid_offsets"
    assert analyze_fingerprint_match(query, {}, config).reason == "no_catalog_hits"


def test_match_fingerprints_rejects_votes_below_absolute_threshold() -> None:
    config = SignalConfig(
        match_threshold=6,
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


def test_extract_peaks_ignores_frequencies_outside_the_band() -> None:
    config = SignalConfig(
        sample_rate=8_000,
        n_fft=512,
        hop_length=128,
        min_frequency_hz=300.0,
        max_frequency_hz=2_000.0,
    )
    time = np.arange(config.sample_rate * 2, dtype=np.float32) / config.sample_rate
    samples = (
        np.sin(2 * np.pi * 100 * time)
        + np.sin(2 * np.pi * 1_000 * time)
        + np.sin(2 * np.pi * 3_000 * time)
    ).astype(np.float32)

    peaks = extract_peaks(samples, config).peaks
    frequencies_hz = [peak.frequency_bin * config.sample_rate / config.n_fft for peak in peaks]

    assert peaks
    assert all(300.0 <= frequency <= 2_000.0 for frequency in frequencies_hz)


def test_extract_peaks_keeps_a_bounded_budget_per_second() -> None:
    config = SignalConfig(
        sample_rate=8_000,
        n_fft=512,
        hop_length=128,
        peak_neighborhood_frequency_bins=3,
        peak_neighborhood_time_frames=3,
        peaks_per_second=5,
    )
    samples = np.random.default_rng(7).standard_normal(config.sample_rate * 3).astype(np.float32)
    frames_per_second = round(config.sample_rate / config.hop_length)

    peaks = extract_peaks(samples, config).peaks
    per_second = np.bincount([peak.time_frame // frames_per_second for peak in peaks])

    assert peaks
    assert per_second.max() <= config.peaks_per_second
    assert [(peak.time_frame, peak.frequency_bin) for peak in peaks] == sorted(
        (peak.time_frame, peak.frequency_bin) for peak in peaks
    )


def test_fingerprints_only_pair_peaks_within_the_frequency_zone() -> None:
    config = SignalConfig(
        fan_out=5, min_time_delta_frames=1, max_time_delta_frames=8, max_frequency_delta_bins=20
    )
    peaks = (
        Peak(frequency_bin=10, time_frame=0, amplitude_db=-1.0),
        Peak(frequency_bin=25, time_frame=2, amplitude_db=-2.0),
        Peak(frequency_bin=200, time_frame=3, amplitude_db=-3.0),
    )

    _, traces = create_fingerprints_with_traces(peaks, config)

    assert [(trace.anchor_frequency_bin, trace.target_frequency_bin) for trace in traces] == [
        (10, 25)
    ]
