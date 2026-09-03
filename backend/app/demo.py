from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

import numpy as np
from matplotlib.figure import Figure

from .services.signal import (
    DEFAULT_CONFIG,
    MatchResult,
    PeakExtraction,
    SignalConfig,
    create_fingerprints,
    extract_peaks,
    load_audio,
    match_fingerprints,
)

AUDIO_EXTENSIONS = {".flac", ".mp3", ".ogg", ".wav"}


def format_timestamp(timestamp_seconds: float) -> str:
    minutes, seconds = divmod(round(timestamp_seconds), 60)
    return f"{minutes} min {seconds} sec"


def run_demo(
    song_paths: Sequence[Path],
    query_path: Path,
    output_dir: Path,
    *,
    config: SignalConfig = DEFAULT_CONFIG,
) -> MatchResult:
    """Fingerprint local songs and match a user-supplied query clip."""
    songs = tuple(song_paths)
    if len(songs) < 2:
        raise ValueError("The Stage 1 demo needs at least two songs")

    catalog = {}
    for path in songs:
        audio = load_audio(path, config)
        fingerprints = create_fingerprints(extract_peaks(audio.samples, config).peaks, config)
        if path.stem in catalog:
            raise ValueError(f"Song names must be unique: {path.stem}")
        catalog[path.stem] = fingerprints

    query_audio = load_audio(query_path, config)
    query_peaks = extract_peaks(query_audio.samples, config)
    query_fingerprints = create_fingerprints(query_peaks.peaks, config)
    result = match_fingerprints(query_fingerprints, catalog, config)
    if result is None:
        raise RuntimeError("No song received enough aligned fingerprint votes")

    output_dir.mkdir(parents=True, exist_ok=True)
    _save_pipeline_plot(query_audio.samples, query_peaks, output_dir, config)
    _save_vote_plot(result, output_dir, config)
    return result


def _save_pipeline_plot(
    samples: np.ndarray,
    extraction: PeakExtraction,
    output_dir: Path,
    config: SignalConfig,
) -> None:
    duration = len(samples) / config.sample_rate
    extent = (0, duration, 0, config.sample_rate / 2)
    peak_times = [
        peak.time_frame * config.hop_length / config.sample_rate for peak in extraction.peaks
    ]
    peak_frequencies = [
        peak.frequency_bin * config.sample_rate / config.n_fft for peak in extraction.peaks
    ]

    figure = Figure(figsize=(12, 9), layout="constrained")
    axes = figure.subplots(2, 2)
    waveform = axes[0, 0]
    spectrogram = axes[0, 1]
    detected_peaks = axes[1, 0]
    constellation = axes[1, 1]

    waveform.plot(np.arange(len(samples)) / config.sample_rate, samples, linewidth=0.6)
    waveform.set(title="1. Normalized waveform", xlabel="Time (seconds)", ylabel="Amplitude")

    spectrogram.imshow(
        extraction.spectrogram_db,
        origin="lower",
        aspect="auto",
        extent=extent,
        cmap="magma",
    )
    spectrogram.set(title="2. STFT spectrogram", xlabel="Time (seconds)", ylabel="Frequency (Hz)")

    detected_peaks.imshow(
        extraction.spectrogram_db,
        origin="lower",
        aspect="auto",
        extent=extent,
        cmap="gray_r",
    )
    detected_peaks.scatter(peak_times, peak_frequencies, s=7, c="red")
    detected_peaks.set(
        title="3. Spectral peak detection",
        xlabel="Time (seconds)",
        ylabel="Frequency (Hz)",
    )

    constellation.scatter(peak_times, peak_frequencies, s=8)
    constellation.set(
        title="4. Constellation map",
        xlabel="Time (seconds)",
        ylabel="Frequency (Hz)",
        xlim=(0, duration),
        ylim=(0, config.sample_rate / 2),
    )
    figure.savefig(output_dir / "signal_pipeline.png", dpi=150)


def _save_vote_plot(result: MatchResult, output_dir: Path, config: SignalConfig) -> None:
    offsets = [frame * config.hop_length / config.sample_rate for frame, _ in result.offset_votes]
    counts = [count for _, count in result.offset_votes]
    figure = Figure(figsize=(10, 4), layout="constrained")
    axes = figure.subplots()
    axes.bar(offsets, counts, width=config.hop_length / config.sample_rate)
    axes.axvline(result.timestamp_seconds, color="red", linestyle="--", label="Winning offset")
    axes.set(
        title=f"Time-offset votes for {result.song_id}",
        xlabel="Candidate source timestamp (seconds)",
        ylabel="Matching fingerprints",
    )
    axes.legend()
    figure.savefig(output_dir / "offset_votes.png", dpi=150)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Apollo Stage 1 fingerprinting demo")
    parser.add_argument("clip_filename", help="Filename inside the demo-clip directory")
    parser.add_argument("--songs", type=Path, default=Path("../demo-data"))
    parser.add_argument("--clips", type=Path, default=Path("../demo-clip"))
    parser.add_argument("--output", type=Path, default=Path("../artifacts/stage1"))
    args = parser.parse_args()

    songs = sorted(
        path for path in args.songs.iterdir() if path.suffix.lower() in AUDIO_EXTENSIONS
    )
    if Path(args.clip_filename).name != args.clip_filename:
        parser.error("Provide a filename only, not a path")
    query_path = args.clips / args.clip_filename
    if not query_path.is_file():
        parser.error(f"Clip not found: {query_path}")

    result = run_demo(
        songs,
        query_path,
        args.output,
    )
    print(f"Query clip: {query_path.name}")
    print(f"Predicted song: {result.song_id}")
    print(f"Estimated timestamp: {format_timestamp(result.timestamp_seconds)}")
    print(f"Aligned fingerprint votes: {result.match_count}")
    print(f"Plots saved to: {args.output.resolve()}")


if __name__ == "__main__":
    main()
