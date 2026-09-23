from contextlib import closing
from pathlib import Path

import pytest

from app.database import (
    connect_database,
    db_int_to_fingerprint_hex,
    fingerprint_hex_to_db_int,
    initialize_database,
)


@pytest.mark.parametrize(
    "hash_hex",
    (
        "0000000000000000",
        "0000000000000001",
        "7fffffffffffffff",
        "8000000000000000",
        "ffffffffffffffff",
    ),
)
def test_fingerprint_integer_conversion_is_lossless(hash_hex: str) -> None:
    assert db_int_to_fingerprint_hex(fingerprint_hex_to_db_int(hash_hex)) == hash_hex


def test_database_initialization_creates_indexed_schema(tmp_path: Path) -> None:
    database_path = tmp_path / "data" / "apollo.db"

    initialize_database(database_path)

    with closing(connect_database(database_path)) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        indexes = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index'"
            )
        }
        foreign_keys_enabled = connection.execute("PRAGMA foreign_keys").fetchone()[0]

    assert {"songs", "acoustic_fingerprints"} <= tables
    assert "acoustic_fingerprint_lookup" in indexes
    assert foreign_keys_enabled == 1


def test_normal_connection_does_not_create_a_missing_database(tmp_path: Path) -> None:
    database_path = tmp_path / "apollo.db"

    with pytest.raises(FileNotFoundError, match="Initialize it with"):
        connect_database(database_path)

    assert not database_path.exists()
