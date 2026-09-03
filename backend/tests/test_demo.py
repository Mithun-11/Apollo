from pathlib import Path

import numpy as np
import soundfile as sf

from app.demo import format_timestamp, run_demo
from app.services.signal import SignalConfig


def test_format_timestamp_uses_minutes_and_seconds() -> None:
    assert format_timestamp(199.99) == "3 min 20 sec"


def test_demo_matches_an_external_clip_and_saves_explanatory_plots(tmp_path: Path) -> None:
    sample_rate = 8_000
    duration_seconds = 12
    time = np.arange(sample_rate * duration_seconds, dtype=np.float32) / sample_rate
    paths: list[Path] = []
    for index, frequency in enumerate((330, 730)):
        rng = np.random.default_rng(index)
        samples = (
            0.5 * np.sin(2 * np.pi * frequency * time)
            + 0.25 * np.sin(2 * np.pi * (frequency + 170 * time) * time)
            + 0.05 * rng.standard_normal(time.size)
        ).astype(np.float32)
        path = tmp_path / f"song-{index}.wav"
        sf.write(path, samples, sample_rate, subtype="PCM_16")
        paths.append(path)

    query_offset_seconds = 3.123
    query_duration_seconds = 5
    query_start = round(query_offset_seconds * sample_rate)
    query_path = tmp_path / "demo-clip" / "sample.wav"
    query_path.parent.mkdir()
    sf.write(
        query_path,
        samples[query_start : query_start + query_duration_seconds * sample_rate],
        sample_rate,
        subtype="PCM_16",
    )

    output_dir = tmp_path / "plots"
    config = SignalConfig(
        sample_rate=sample_rate,
        n_fft=512,
        hop_length=128,
        peak_neighborhood_frequency_bins=9,
        peak_neighborhood_time_frames=5,
        peak_amplitude_threshold_db=-30,
        fan_out=5,
        max_time_delta_frames=80,
        match_threshold=5,
    )

    result = run_demo(
        paths,
        query_path,
        output_dir,
        config=config,
    )

    assert result.song_id == paths[-1].stem
    assert abs(result.timestamp_seconds - query_offset_seconds) < 1
    assert (output_dir / "signal_pipeline.png").is_file()
    assert (output_dir / "offset_votes.png").is_file()
