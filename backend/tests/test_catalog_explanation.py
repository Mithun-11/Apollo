from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from app import catalog
from app.database import connect_database, fingerprint_hex_to_db_int, initialize_database
from app.services.signal import (
    Fingerprint,
    Peak,
    SignalConfig,
    create_fingerprints_with_traces,
)


def _database(tmp_path: Path, rows: list[dict[str, Any]]) -> sqlite3.Connection:
    database_path = initialize_database(tmp_path / "apollo.db")
    connection = connect_database(database_path)
    connection.execute(
        "INSERT INTO songs (id, name, spotify_url) VALUES (?, ?, ?)",
        (1, "Source Song", "https://open.spotify.com/track/example"),
    )
    connection.executemany(
        """
        INSERT INTO acoustic_fingerprints
            (song_id, fingerprint_version, hash_value, anchor_frame)
        VALUES (?, ?, ?, ?)
        """,
        (
            (
                1,
                row["fingerprint_version"],
                fingerprint_hex_to_db_int(row["hash_value"]),
                row["anchor_frame"],
            )
            for row in rows
        ),
    )
    connection.commit()
    return connection


def _analysis_and_catalog(
    config: SignalConfig,
    *,
    source_offset: int = 240,
) -> tuple[catalog.QueryAnalysis, list[dict[str, Any]], tuple[str, ...]]:
    peaks = (
        Peak(frequency_bin=1, time_frame=0, amplitude_db=-1.0),
        Peak(frequency_bin=2, time_frame=2, amplitude_db=-2.0),
        Peak(frequency_bin=3, time_frame=5, amplitude_db=-3.0),
        Peak(frequency_bin=4, time_frame=8, amplitude_db=-4.0),
    )
    fingerprints, traces = create_fingerprints_with_traces(peaks, config)
    analysis = catalog.QueryAnalysis(
        samples=np.ones(800, dtype=np.float32),
        sample_rate=config.sample_rate,
        spectrogram_db=np.zeros((5, 9), dtype=np.float64),
        peaks=peaks,
        fingerprints=fingerprints,
        traces=traces,
    )
    rows = [
        {
            "song_id": 1,
            "fingerprint_version": fingerprint.version,
            "hash_value": fingerprint.hash_value,
            "anchor_frame": fingerprint.anchor_frame + source_offset,
        }
        for fingerprint in fingerprints
    ]
    return analysis, rows, tuple(fingerprint.hash_value for fingerprint in fingerprints)


def test_recognize_file_with_explanation_reuses_matching_evidence(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    config = SignalConfig(
        sample_rate=8_000,
        n_fft=8,
        hop_length=100,
        fan_out=3,
        max_time_delta_frames=8,
        match_threshold=3,
    )
    analysis, rows, hashes = _analysis_and_catalog(config)
    monkeypatch.setattr(catalog, "analyze_query_file", lambda _path, _config: analysis)

    with _database(tmp_path, rows) as connection:
        response = catalog.recognize_file_with_explanation(
            catalog.Path("query.wav"), connection, config
        )

    recognition = response["recognition"]
    explanation = response["explanation"]
    assert isinstance(recognition, dict)
    assert recognition["matched"] is True
    assert recognition["song"] == {
        "id": "1",
        "name": "Source Song",
        "spotifyUrl": "https://open.spotify.com/track/example",
    }
    assert recognition["timestampSeconds"] == 3.0
    assert recognition["matchCount"] >= config.match_threshold
    assert isinstance(explanation, dict)
    assert explanation["sourceInterval"] == {
        "startSeconds": 3.0,
        "endSeconds": 3.1,
    }
    assert explanation["counts"] == {
        "peaks": 4,
        "fingerprints": len(analysis.fingerprints),
        "matchingHashes": len(hashes),
        "winningVotes": recognition["matchCount"],
    }
    assert explanation["matchedFingerprints"]
    assert all(
        match["sourceAnchorSeconds"] - match["queryAnchorSeconds"] == pytest.approx(3.0)
        for match in explanation["matchedFingerprints"]
    )
    serialized = json.dumps(response)
    assert all(hash_value not in serialized for hash_value in hashes)


def test_no_query_fingerprints_returns_structurally_valid_explanation(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    config = SignalConfig(sample_rate=8_000, n_fft=8, hop_length=100)
    analysis = catalog.QueryAnalysis(
        samples=np.zeros(80, dtype=np.float32),
        sample_rate=config.sample_rate,
        spectrogram_db=np.zeros((3, 4), dtype=np.float64),
        peaks=(),
        fingerprints=(),
        traces=(),
    )
    monkeypatch.setattr(catalog, "analyze_query_file", lambda _path, _config: analysis)

    with _database(tmp_path, []) as connection:
        response = catalog.recognize_file_with_explanation(
            catalog.Path("query.wav"), connection, config
        )

    assert response["recognition"] == {
        "matched": False,
        "song": None,
        "timestampSeconds": None,
        "confidence": 0.0,
        "matchCount": 0,
    }
    explanation = response["explanation"]
    assert isinstance(explanation, dict)
    assert explanation["sourceInterval"] is None
    assert explanation["matchedFingerprints"] == []
    assert explanation["offsetVotes"] == []
    assert explanation["counts"]["fingerprints"] == 0


def test_hashes_without_an_accepted_offset_explain_the_no_match(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    config = SignalConfig(
        sample_rate=8_000,
        n_fft=8,
        hop_length=100,
        match_threshold=2,
    )
    fingerprint = Fingerprint(
        "0000000000000001", anchor_frame=4, version=config.fingerprint_version
    )
    analysis = catalog.QueryAnalysis(
        samples=np.ones(80, dtype=np.float32),
        sample_rate=config.sample_rate,
        spectrogram_db=np.zeros((3, 4), dtype=np.float64),
        peaks=(Peak(1, 4, -1.0),),
        fingerprints=(fingerprint,),
        traces=(),
    )
    rows = [
        {
            "song_id": 1,
            "fingerprint_version": config.fingerprint_version,
            "hash_value": fingerprint.hash_value,
            "anchor_frame": 100,
        }
    ]
    monkeypatch.setattr(catalog, "analyze_query_file", lambda _path, _config: analysis)

    with _database(tmp_path, rows) as connection:
        response = catalog.recognize_file_with_explanation(
            catalog.Path("query.wav"), connection, config
        )

    explanation = response["explanation"]
    assert response["recognition"]["matched"] is False
    assert explanation["counts"]["matchingHashes"] == 1
    assert explanation["counts"]["winningVotes"] == 0
    assert explanation["offsetVotes"] == []
