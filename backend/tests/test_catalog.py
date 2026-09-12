from contextlib import closing
from pathlib import Path

from app import catalog
from app.database import connect_database, fingerprint_hex_to_db_int, initialize_database
from app.services.signal import Fingerprint, SignalConfig


def test_resolve_catalog_audio_finds_sibling_songs_folder(tmp_path: Path) -> None:
    project_root = tmp_path / "Apollo"
    songs_dir = tmp_path / "Songs"
    songs_dir.mkdir()
    song = songs_dir / "track.wav"
    song.write_bytes(b"not decoded in this path test")

    original_root = catalog.PROJECT_ROOT
    original_songs_dir = catalog.SONGS_DIR
    try:
        catalog.PROJECT_ROOT = project_root
        catalog.SONGS_DIR = songs_dir
        assert catalog.resolve_catalog_audio(Path("track.wav")) == song
    finally:
        catalog.PROJECT_ROOT = original_root
        catalog.SONGS_DIR = original_songs_dir


def test_ingest_song_stores_integer_hashes_in_one_transaction(
    tmp_path: Path, monkeypatch: object
) -> None:
    database_path = initialize_database(tmp_path / "apollo.db")
    fingerprints = (
        Fingerprint("0000000000000001", 10, "1"),
        Fingerprint("ffffffffffffffff", 20, "1"),
    )
    monkeypatch.setattr(catalog, "fingerprint_file", lambda _path, _config: fingerprints)

    with closing(connect_database(database_path)) as connection:
        result = catalog.ingest_song(
            Path("song.wav"),
            "Example Song",
            "https://open.spotify.com/track/example",
            connection,
        )
        stored_hashes = [
            row[0]
            for row in connection.execute(
                "SELECT hash_value FROM acoustic_fingerprints ORDER BY anchor_frame"
            )
        ]

    assert result["id"] == "1"
    assert result["fingerprintCount"] == 2
    assert stored_hashes == [1, -1]


def test_recognition_reads_only_matching_hashes_from_sqlite(
    tmp_path: Path, monkeypatch: object
) -> None:
    config = SignalConfig(match_threshold=1, min_match_ratio=0, min_winner_ratio=1)
    query = (Fingerprint("8000000000000000", 5, config.fingerprint_version),)
    database_path = initialize_database(tmp_path / "apollo.db")

    with closing(connect_database(database_path)) as connection:
        song_id = connection.execute(
            "INSERT INTO songs (name, spotify_url) VALUES (?, ?)",
            ("Source Song", "https://open.spotify.com/track/source"),
        ).lastrowid
        connection.executemany(
            """
            INSERT INTO acoustic_fingerprints
                (song_id, fingerprint_version, hash_value, anchor_frame)
            VALUES (?, ?, ?, ?)
            """,
            (
                (
                    song_id,
                    config.fingerprint_version,
                    fingerprint_hex_to_db_int(query[0].hash_value),
                    15,
                ),
                (song_id, config.fingerprint_version, 1, 99),
            ),
        )
        connection.commit()
        monkeypatch.setattr(catalog, "fingerprint_file", lambda _path, _config: query)

        result = catalog.recognize_file(Path("query.wav"), connection, config)

    assert result["matched"] is True
    assert result["song"] == {
        "id": "1",
        "name": "Source Song",
        "spotifyUrl": "https://open.spotify.com/track/source",
    }
    assert result["timestampSeconds"] == 10 * config.hop_length / config.sample_rate
