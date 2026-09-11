from __future__ import annotations

import numpy as np
import pytest

from app.services.explanation import (
    SPECTROGRAM_MAX_DB,
    SPECTROGRAM_MIN_DB,
    build_matched_fingerprint_display,
    build_offset_vote_display,
    build_peak_display,
    build_spectrogram_display,
    build_waveform_envelope,
)
from app.services.signal import Fingerprint, FingerprintTrace, Peak, SignalConfig


def test_waveform_envelope_is_bounded_ordered_and_normalized() -> None:
    samples = np.asarray([-2.0, -0.5, 0.25, 0.75, 2.0], dtype=np.float32)

    display = build_waveform_envelope(samples, sample_rate=10, max_columns=3)

    assert len(display) == 3
    assert [point.time_seconds for point in display] == sorted(
        point.time_seconds for point in display
    )
    assert all(-1.0 <= point.minimum <= point.maximum <= 1.0 for point in display)
    assert display[0].minimum == -1.0
    assert display[-1].maximum == 1.0


def test_spectrogram_display_is_bounded_and_contains_integer_db_values() -> None:
    values = np.asarray(
        [
            [-100.2, -40.4, 3.2, np.nan],
            [-79.6, -20.1, -0.4, -np.inf],
            [-70.2, -10.8, -1.2, 2.0],
        ],
        dtype=np.float64,
    )
    config = SignalConfig(sample_rate=8_000, n_fft=8)

    display = build_spectrogram_display(
        values,
        duration_seconds=1.5,
        config=config,
        max_frequency_bins=2,
        max_time_bins=3,
    )

    assert len(display.values_db) == 2
    assert all(len(row) == 3 for row in display.values_db)
    assert all(
        SPECTROGRAM_MIN_DB <= value <= SPECTROGRAM_MAX_DB
        and isinstance(value, int)
        for row in display.values_db
        for value in row
    )
    assert display.minimum_db == SPECTROGRAM_MIN_DB
    assert display.maximum_db == SPECTROGRAM_MAX_DB
    assert display.maximum_frequency_hz == 4_000.0
    assert display.duration_seconds == 1.5


def test_peak_display_selects_strongest_peaks_and_marks_matches() -> None:
    config = SignalConfig(sample_rate=8_000, n_fft=8, hop_length=100)
    peaks = (
        Peak(frequency_bin=2, time_frame=3, amplitude_db=-10.0),
        Peak(frequency_bin=1, time_frame=1, amplitude_db=-1.0),
        Peak(frequency_bin=3, time_frame=2, amplitude_db=-2.0),
    )
    traces = (
        FingerprintTrace(
            fingerprint=Fingerprint("match", anchor_frame=1, version=config.fingerprint_version),
            anchor_frequency_bin=1,
            target_frequency_bin=3,
            target_frame=2,
        ),
    )

    display = build_peak_display(peaks, config, matched_traces=traces, max_peaks=2)

    assert len(display) == 2
    assert [(point.time_seconds, point.frequency_hz) for point in display] == [
        (0.0125, 1_000.0),
        (0.025, 3_000.0),
    ]
    assert [point.matched for point in display] == [True, True]


def test_matched_fingerprint_display_deduplicates_and_samples_evenly() -> None:
    config = SignalConfig(sample_rate=8_000, n_fft=8, hop_length=100)
    traces = tuple(
        FingerprintTrace(
            fingerprint=Fingerprint(f"hash-{index}", index, config.fingerprint_version),
            anchor_frequency_bin=1,
            target_frequency_bin=2,
            target_frame=index + 1,
        )
        for index in range(5)
    )
    catalog = tuple(
        Fingerprint(
            trace.fingerprint.hash_value,
            trace.fingerprint.anchor_frame + 100,
            config.fingerprint_version,
        )
        for trace in traces
    )

    display = build_matched_fingerprint_display(
        traces,
        catalog + (catalog[0],),
        winning_offset_frame=100,
        config=config,
        max_matches=3,
    )

    assert len(display) == 3
    assert [point.query_anchor_seconds for point in display] == [0.0, 0.025, 0.05]
    assert all(
        point.source_target_seconds - point.source_anchor_seconds == pytest.approx(0.0125)
        for point in display
    )


def test_offset_vote_display_preserves_winner_and_orders_by_offset() -> None:
    config = SignalConfig(sample_rate=8_000, hop_length=100)
    votes = tuple((offset, offset + 1) for offset in range(5))

    display = build_offset_vote_display(
        votes,
        winning_offset_frame=0,
        config=config,
        max_bars=3,
    )

    assert len(display) == 3
    assert [bar.offset_seconds for bar in display] == pytest.approx([0.0, 0.0375, 0.05])
    assert display[0].winning is True
    assert sum(bar.winning for bar in display) == 1
