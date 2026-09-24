"""Optional vocal separation with Demucs (htdemucs) for melody matching.

Demucs and PyTorch are large optional dependencies (see ``requirements-melody.txt``). When they
are not installed, :func:`is_available` is False and melody matching is skipped; fingerprint
recognition never depends on this module. The model is loaded once and reused, on the GPU when
PyTorch can see one.
"""

from __future__ import annotations

import importlib.util
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import librosa
import numpy as np
from numpy.typing import NDArray

FloatArray = NDArray[np.float64]
MODEL_NAME = "htdemucs"

_model: Any = None
_device = "cpu"
_lock = threading.Lock()


@dataclass(frozen=True, slots=True)
class SeparatedAudio:
    """Mono separated vocals and the mono full mix, both at ``sample_rate``."""

    vocals: FloatArray
    mix: FloatArray
    sample_rate: int


def is_available() -> bool:
    return (
        importlib.util.find_spec("torch") is not None
        and importlib.util.find_spec("demucs") is not None
    )


def _load_model() -> Any:
    global _model, _device
    if _model is None:
        import torch
        from demucs.pretrained import get_model

        _device = "cuda" if torch.cuda.is_available() else "cpu"
        _model = get_model(MODEL_NAME).to(_device).eval()
    return _model


def preload_in_background() -> None:
    """Load the model on a background thread so the first melody request does not pay for it."""
    if not is_available():
        return

    def load() -> None:
        with _lock:
            _load_model()

    threading.Thread(target=load, name="demucs-preload", daemon=True).start()


def separate_file(path: str | Path, sample_rate: int = 16_000) -> SeparatedAudio:
    """Separate the vocals of an audio file; raises RuntimeError when Demucs is unavailable."""
    if not is_available():
        raise RuntimeError(
            "Vocal separation needs the optional packages in requirements-melody.txt"
        )
    import torch
    from demucs.apply import apply_model

    with _lock:
        model = _load_model()
        audio, _ = librosa.load(path, sr=model.samplerate, mono=False, dtype=np.float32)
        if audio.ndim == 1:
            audio = np.stack([audio, audio])
        stereo = torch.from_numpy(np.ascontiguousarray(audio[:2])).to(_device)
        reference = stereo.mean(0)
        mean, spread = reference.mean(), reference.std() + 1e-8
        with torch.no_grad():
            sources = apply_model(
                model,
                ((stereo - mean) / spread)[None],
                device=_device,
                split=True,
                overlap=0.25,
                shifts=0,  # no random time shift: the same audio always gives the same result
                progress=False,
            )[0]
        vocals = (sources[model.sources.index("vocals")] * spread + mean).mean(0).cpu().numpy()
    mono_mix = audio[:2].mean(axis=0)
    return SeparatedAudio(
        vocals=librosa.resample(vocals, orig_sr=model.samplerate, target_sr=sample_rate).astype(
            np.float64
        ),
        mix=librosa.resample(mono_mix, orig_sr=model.samplerate, target_sr=sample_rate).astype(
            np.float64
        ),
        sample_rate=sample_rate,
    )
