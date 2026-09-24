import io
from contextlib import closing
from pathlib import Path
from typing import Any, cast

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app import catalog, evidence, main
from app.database import connect_database, initialize_database

RATE = 22_050


def _song(seed: int, seconds: float = 20.0) -> np.ndarray:
    """A deterministic, spectrally busy stand-in for a recording."""
    rng = np.random.default_rng(seed)
    return (0.1 * rng.standard_normal(int(RATE * seconds))).astype(np.float32)


def _use_song_files(monkeypatch: pytest.MonkeyPatch, files: list[Path]) -> None:
    monkeypatch.setattr(evidence, "_song_files", lambda: tuple(files))
    evidence._identity.clear()


def test_song_files_are_found_by_title_and_versions_by_fingerprint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    files = [
        tmp_path / "Heat Waves [XDjB9E3YtUE].wav",
        tmp_path / "Sparkle (English Version) [U52IJSyHa24].wav",
        tmp_path / "Sparkle (Original Version).wav",
    ]
    _use_song_files(monkeypatch, files)
    identities = {files[1]: "22", files[2]: "4"}
    names = {"4": "Sparkle", "22": "Sparkle (English Version)"}
    monkeypatch.setattr(evidence, "identify_catalog_song", lambda path, _db: identities.get(path))
    monkeypatch.setattr(evidence, "_song_names", lambda _db: names)

    assert evidence.find_song_file("10", "Heat Waves") == files[0]
    # Both Sparkle files have the title "Sparkle"; their fingerprints tell the versions apart.
    connection: Any = object()
    assert evidence.find_song_file("4", "Sparkle", connection) == files[2]
    assert evidence.find_song_file("22", "Sparkle (English Version)", connection) == files[1]
    assert evidence.find_song_file("", "Heat Waves") is None


def test_build_evidence_reports_votes_and_the_song_sky(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database = initialize_database(tmp_path / "apollo.db")
    song_files = []
    with closing(connect_database(database)) as connection:
        for seed in (1, 2, 3):
            path = tmp_path / f"Song {seed}.wav"
            sf.write(path, _song(seed), RATE)
            song_files.append(path)
            link = f"https://open.spotify.com/track/{seed}"
            catalog.ingest_song(path, f"Song {seed}", link, connection)
        _use_song_files(monkeypatch, song_files)
        query = tmp_path / "query.wav"
        sf.write(query, _song(2)[RATE * 5 : RATE * 11], RATE)
        recognition = catalog.recognize_file(query, connection)
        assert recognition["matched"] is True

        song = cast(dict[str, str], recognition["song"])
        timestamp = cast(float, recognition["timestampSeconds"])
        built = evidence.build_evidence(query, connection, song["id"], timestamp)
    result = cast(dict[str, Any], built)

    assert "timings" not in result
    assert {item["name"] for item in result["songs"]} == {"Song 1", "Song 2", "Song 3"}
    assert result["votes"][0]["songId"] == song["id"]
    assert result["speedCurve"] is None and result["melody"] is None
    assert len(result["songSky"]["peaks"]) > 0
    assert result["songSky"]["startSeconds"] == pytest.approx(5.0, abs=0.1)


def test_evidence_route_passes_the_recognition_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    received: dict[str, object] = {}

    def fake(
        path: Path, _connection: object, song_id: str, timestamp: float, **options: object
    ) -> dict[str, object]:
        received.update(song_id=song_id, timestamp=timestamp, **options)
        assert path.is_file()
        return {"votes": []}

    monkeypatch.setattr(main, "build_evidence", fake)
    monkeypatch.setattr(main, "connect_database", io.BytesIO)

    response = TestClient(main.app).post(
        "/recognize/evidence",
        files={"audio": ("microphone.wav", b"audio", "audio/wav")},
        data={
            "songId": "7",
            "timestampSeconds": "48.5",
            "speedFactor": "0.89",
            "matchMethod": "fingerprint",
        },
    )

    assert response.status_code == 200
    assert received == {
        "song_id": "7",
        "timestamp": 48.5,
        "speed_factor": 0.89,
        "pitch_factor": 1.0,
        "match_method": "fingerprint",
    }
