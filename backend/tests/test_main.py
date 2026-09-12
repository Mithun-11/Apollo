from __future__ import annotations

import asyncio
import io
import tempfile
from pathlib import Path
from typing import Any

import pytest
from fastapi import UploadFile
from fastapi.testclient import TestClient

from app import main


def _explanation_response(matched: bool) -> dict[str, object]:
    return {
        "recognition": {
            "matched": matched,
            "song": (
                {
                    "id": "song-1",
                    "name": "Example Song",
                    "spotifyUrl": "https://open.spotify.com/track/example",
                }
                if matched
                else None
            ),
            "timestampSeconds": 3.0 if matched else None,
            "confidence": 0.8 if matched else 0.0,
            "matchCount": 8 if matched else 0,
        },
        "explanation": {
            "queryDurationSeconds": 1.0,
            "sampleRate": 8_000,
            "waveformEnvelope": [],
            "spectrogram": {
                "valuesDb": [],
                "minimumDb": -80,
                "maximumDb": 0,
                "maximumFrequencyHz": 4_000.0,
                "durationSeconds": 1.0,
            },
            "peaks": [],
            "matchedFingerprints": [],
            "offsetVotes": [],
            "sourceInterval": (
                {"startSeconds": 3.0, "endSeconds": 4.0} if matched else None
            ),
            "counts": {
                "peaks": 0,
                "fingerprints": 0,
                "matchingHashes": 0,
                "winningVotes": 8 if matched else 0,
            },
            "matchThreshold": 5,
            "candidateVotes": [],
            "processingTimesMs": None,
        },
    }


@pytest.fixture(autouse=True)
def catalog_cache_state(monkeypatch: Any) -> None:
    monkeypatch.setattr(main.app.state, "catalog_cache", object(), raising=False)


def test_health_route_returns_status() -> None:
    response = TestClient(main.app).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_lifespan_loads_catalog_cache_before_requests(monkeypatch: Any) -> None:
    expected_cache = object()
    monkeypatch.setattr(main, "load_catalog_cache", lambda _client: expected_cache)
    monkeypatch.setattr(main, "get_supabase_client", lambda: object())

    with TestClient(main.app):
        assert main.app.state.catalog_cache is expected_cache


def test_explain_route_returns_successful_response_and_cleans_temp_file(
    monkeypatch: Any,
) -> None:
    captured_paths: list[Path] = []

    def recognize(path: Path, _client: object) -> dict[str, object]:
        captured_paths.append(path)
        assert path.is_file()
        return _explanation_response(matched=True)

    monkeypatch.setattr(main, "recognize_file_with_explanation", recognize)
    monkeypatch.setattr(main, "get_supabase_client", lambda: object())

    response = TestClient(main.app).post(
        "/recognize/explain",
        files={"audio": ("microphone.wav", b"audio", "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json() == _explanation_response(matched=True)
    assert captured_paths and not captured_paths[0].exists()


def test_explain_route_returns_no_match_response(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        main,
        "recognize_file_with_explanation",
        lambda _path, _client: _explanation_response(matched=False),
    )
    monkeypatch.setattr(main, "get_supabase_client", lambda: object())

    response = TestClient(main.app).post(
        "/recognize/explain",
        files={"audio": ("microphone.wav", b"audio", "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json()["recognition"]["matched"] is False
    assert response.json()["explanation"]["sourceInterval"] is None


def test_existing_recognize_contract_is_unchanged(monkeypatch: Any) -> None:
    expected = {
        "matched": True,
        "song": {
            "id": "song-1",
            "name": "Example Song",
            "spotifyUrl": "https://open.spotify.com/track/example",
        },
        "timestampSeconds": 3.0,
        "confidence": 0.8,
        "matchCount": 8,
    }
    monkeypatch.setattr(main, "recognize_file", lambda _path, _client: expected)
    monkeypatch.setattr(main, "get_supabase_client", lambda: object())

    response = TestClient(main.app).post(
        "/recognize",
        files={"audio": ("microphone.wav", b"audio", "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json() == expected


def test_recognize_route_passes_startup_cache_to_service(monkeypatch: Any) -> None:
    expected_cache = object()
    main.app.state.catalog_cache = expected_cache
    received: list[object] = []

    def recognize(_path: Path, cache: object) -> dict[str, object]:
        received.append(cache)
        return {
            "matched": False,
            "song": None,
            "timestampSeconds": None,
            "confidence": 0.0,
            "matchCount": 0,
        }

    monkeypatch.setattr(main, "recognize_file", recognize)

    response = TestClient(main.app).post(
        "/recognize",
        files={"audio": ("microphone.wav", b"audio", "audio/wav")},
    )

    assert response.status_code == 200
    assert received == [expected_cache]


def test_recognize_route_rejects_request_when_cache_is_missing() -> None:
    main.app.state.catalog_cache = None

    response = TestClient(main.app).post(
        "/recognize",
        files={"audio": ("microphone.wav", b"audio", "audio/wav")},
    )

    assert response.status_code == 500
    assert response.json() == {
        "error": {
            "code": "RECOGNITION_ERROR",
            "message": "Unable to recognize this audio",
        }
    }


def test_unsupported_extension_uses_error_envelope() -> None:
    response = TestClient(main.app).post(
        "/recognize/explain",
        files={"audio": ("microphone.txt", b"audio", "text/plain")},
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "INVALID_AUDIO",
            "message": "audio must be WAV, MP3, FLAC, or OGG",
        }
    }


def test_invalid_audio_uses_error_envelope(monkeypatch: Any) -> None:
    def reject(_path: Path, _client: object) -> dict[str, object]:
        raise ValueError("audio could not be decoded")

    monkeypatch.setattr(main, "recognize_file_with_explanation", reject)
    monkeypatch.setattr(main, "get_supabase_client", lambda: object())

    response = TestClient(main.app).post(
        "/recognize/explain",
        files={"audio": ("microphone.wav", b"invalid", "audio/wav")},
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {"code": "INVALID_AUDIO", "message": "audio could not be decoded"}
    }


def test_missing_audio_uses_error_envelope() -> None:
    response = TestClient(main.app).post("/recognize/explain")

    assert response.status_code == 422
    assert response.json() == {
        "error": {"code": "INVALID_AUDIO", "message": "audio file is required"}
    }


def test_oversized_upload_deletes_partial_temp_file(monkeypatch: Any) -> None:
    created_paths: list[Path] = []
    original_named_temporary_file = tempfile.NamedTemporaryFile

    def capture_temporary_file(*args: Any, **kwargs: Any) -> Any:
        temporary = original_named_temporary_file(*args, **kwargs)
        created_paths.append(Path(temporary.name))
        return temporary

    monkeypatch.setattr(main.tempfile, "NamedTemporaryFile", capture_temporary_file)
    monkeypatch.setattr(main, "MAX_AUDIO_BYTES", 3)
    upload = UploadFile(file=io.BytesIO(b"1234"), filename="microphone.wav")

    with pytest.raises(ValueError, match="too large"):
        asyncio.run(main._save_upload(upload))

    assert created_paths and not created_paths[0].exists()
