from __future__ import annotations

import argparse
import re
from pathlib import Path

import soundfile as sf


def create_clip(
    song_path: Path,
    output_dir: Path,
    *,
    start_seconds: float,
    duration_seconds: float,
) -> Path:
    """Extract a numbered WAV clip from a local song."""
    if start_seconds < 0:
        raise ValueError("Start time must be zero or greater")
    if duration_seconds <= 0:
        raise ValueError("Clip length must be greater than zero")
    if not song_path.is_file():
        raise ValueError(f"Song not found: {song_path}")

    with sf.SoundFile(song_path) as song:
        start_frame = round(start_seconds * song.samplerate)
        frame_count = round(duration_seconds * song.samplerate)
        if start_frame + frame_count > song.frames:
            song_duration = song.frames / song.samplerate
            raise ValueError(f"Clip exceeds the song length ({song_duration:.2f} seconds)")
        song.seek(start_frame)
        samples = song.read(frame_count, dtype="float32", always_2d=True)
        sample_rate = song.samplerate

    output_dir.mkdir(parents=True, exist_ok=True)
    name_pattern = re.compile(r"clip_(\d+)\.wav", re.IGNORECASE)
    existing_numbers = [
        int(match.group(1))
        for path in output_dir.iterdir()
        if path.is_file() and (match := name_pattern.fullmatch(path.name))
    ]
    output_path = output_dir / f"clip_{max(existing_numbers, default=0) + 1}.wav"
    sf.write(output_path, samples, sample_rate, subtype="PCM_16")
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a numbered demo clip from a local song")
    parser.add_argument("song_filename", help="Filename inside the demo-data directory")
    parser.add_argument("start_seconds", type=float, help="Clip start time in seconds")
    parser.add_argument("duration_seconds", type=float, help="Clip length in seconds")
    parser.add_argument("--songs", type=Path, default=Path("../demo-data"))
    parser.add_argument("--clips", type=Path, default=Path("../demo-clip"))
    args = parser.parse_args()

    if Path(args.song_filename).name != args.song_filename:
        parser.error("Provide a filename only, not a path")

    try:
        output_path = create_clip(
            args.songs / args.song_filename,
            args.clips,
            start_seconds=args.start_seconds,
            duration_seconds=args.duration_seconds,
        )
    except (ValueError, sf.SoundFileError) as error:
        parser.error(str(error))

    print(f"Created clip: {output_path.resolve()}")


if __name__ == "__main__":
    main()
