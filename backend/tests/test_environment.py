import librosa
import matplotlib
import numpy
import scipy
import soundfile
from fastapi import FastAPI
from supabase import Client


def test_backend_dependencies_import() -> None:
    assert all(
        module.__version__
        for module in (librosa, matplotlib, numpy, scipy, soundfile)
    )
    assert FastAPI is not None
    assert Client is not None

