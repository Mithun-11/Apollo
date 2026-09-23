from __future__ import annotations

import argparse
import os
import sqlite3
from contextlib import closing
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_PATH = PROJECT_ROOT / "data" / "apollo-v3.db"
SCHEMA_PATH = PROJECT_ROOT / "data" / "schema.sql"


def fingerprint_hex_to_db_int(hash_hex: str) -> int:
    if len(hash_hex) != 16 or any(character not in "0123456789abcdef" for character in hash_hex):
        raise ValueError("fingerprint hash must be 16 lowercase hexadecimal characters")
    value = int(hash_hex, 16)
    return value - 2**64 if value >= 2**63 else value


def db_int_to_fingerprint_hex(value: int) -> str:
    if not -(2**63) <= value < 2**63:
        raise ValueError("database fingerprint must be a signed 64-bit integer")
    return f"{value % 2**64:016x}"


def database_path(path: str | Path | None = None) -> Path:
    configured_path = path if path is not None else os.getenv("APOLLO_DB_PATH")
    return Path(configured_path or DEFAULT_DATABASE_PATH).resolve()


def connect_database(path: str | Path | None = None) -> sqlite3.Connection:
    resolved_path = database_path(path)
    if not resolved_path.is_file():
        raise FileNotFoundError(
            f"Apollo database not found at {resolved_path}. "
            "Initialize it with: python -m app.database"
        )
    connection = sqlite3.connect(resolved_path)
    _configure_connection(connection)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database(path: str | Path | None = None) -> Path:
    resolved_path = database_path(path)
    resolved_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(resolved_path)) as connection:
        _configure_connection(connection)
        connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        connection.commit()
    return resolved_path


def _configure_connection(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")


def main() -> None:
    parser = argparse.ArgumentParser(description="Initialize the local Apollo SQLite database")
    parser.add_argument("--path", type=Path)
    args = parser.parse_args()
    print(f"Initialized Apollo database at {initialize_database(args.path)}")


if __name__ == "__main__":
    main()
