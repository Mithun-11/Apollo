from __future__ import annotations

from typing import Any

from app.catalog import load_catalog_cache
from app.services.signal import SignalConfig


class FakeResponse:
    def __init__(self, data: list[dict[str, Any]], count: int | None = None) -> None:
        self.data = data
        self.count = count


class FakeQuery:
    def __init__(self, rows: list[dict[str, Any]], count: int | None = None) -> None:
        self.rows = rows
        self.count = count

    def select(self, _fields: str, **_kwargs: Any) -> FakeQuery:
        return self

    def eq(self, field: str, value: object) -> FakeQuery:
        self.rows = [row for row in self.rows if row.get(field) == value]
        self.count = len(self.rows)
        return self

    def order(self, _column: str) -> FakeQuery:
        return self

    def range(self, start: int, end: int) -> FakeQuery:
        self.rows = self.rows[start : end + 1]
        return self

    def execute(self) -> FakeResponse:
        return FakeResponse(self.rows, self.count)


class FakeClient:
    def __init__(self, tables: dict[str, list[dict[str, Any]]]) -> None:
        self.tables = tables

    def table(self, name: str) -> FakeQuery:
        rows = list(self.tables[name])
        return FakeQuery(rows, len(rows))


def test_load_catalog_cache_groups_versioned_fingerprints_and_reports_progress(
    capsys: Any,
) -> None:
    config = SignalConfig(sample_rate=8_000, fingerprint_version="v-test")
    client = FakeClient(
        {
            "songs": [
                {"id": "song-1", "name": "One", "spotify_url": "https://open.spotify.com/1"},
                {"id": "song-2", "name": "Two", "spotify_url": "https://open.spotify.com/2"},
            ],
            "acoustic_fingerprints": [
                {
                    "song_id": "song-1",
                    "fingerprint_version": "v-test",
                    "hash_value": "1111111111111111",
                    "anchor_frame": 2,
                },
                {
                    "song_id": "song-2",
                    "fingerprint_version": "v-old",
                    "hash_value": "2222222222222222",
                    "anchor_frame": 3,
                },
                {
                    "song_id": "song-2",
                    "fingerprint_version": "v-test",
                    "hash_value": "3333333333333333",
                    "anchor_frame": 4,
                },
            ],
        }
    )

    cache = load_catalog_cache(client, config, page_size=1)

    assert set(cache.songs) == {"song-1", "song-2"}
    assert [fingerprint.hash_value for fingerprint in cache.fingerprints["song-1"]] == [
        "1111111111111111"
    ]
    assert [fingerprint.hash_value for fingerprint in cache.fingerprints["song-2"]] == [
        "3333333333333333"
    ]
    assert cache.fingerprint_count == 2
    output = capsys.readouterr().out
    assert "2 songs" in output
    assert "2 fingerprints" in output


def test_load_catalog_cache_handles_empty_catalog(capsys: Any) -> None:
    cache = load_catalog_cache(
        FakeClient({"songs": [], "acoustic_fingerprints": []}),
        SignalConfig(fingerprint_version="v-test"),
    )

    assert cache.songs == {}
    assert cache.fingerprints == {}
    assert cache.fingerprint_count == 0
    assert "Cached 0 songs / 0 fingerprints" in capsys.readouterr().out
