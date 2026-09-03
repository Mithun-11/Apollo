from pathlib import Path

import numpy as np
import soundfile as sf

from app.create_clip import create_clip


def test_create_clip_extracts_requested_audio_and_increments_name(tmp_path: Path) -> None:
    sample_rate = 8_000
    samples = np.linspace(-0.5, 0.5, sample_rate * 3, dtype=np.float32)
    song_path = tmp_path / "demo-data" / "My Song.wav"
    song_path.parent.mkdir()
    sf.write(song_path, samples, sample_rate, subtype="PCM_16")

    output_dir = tmp_path / "demo-clip"
    output_dir.mkdir()
    (output_dir / "clip_1.wav").touch()

    output_path = create_clip(song_path, output_dir, start_seconds=1.0, duration_seconds=0.5)
    clip, clip_sample_rate = sf.read(output_path, dtype="float32")

    assert output_path.name == "clip_2.wav"
    assert clip_sample_rate == sample_rate
    assert len(clip) == sample_rate // 2
    expected = samples[sample_rate : sample_rate + sample_rate // 2]
    np.testing.assert_allclose(clip, expected, atol=4e-5)
