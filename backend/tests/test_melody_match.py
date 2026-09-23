from contextlib import closing
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app import catalog, melody_catalog
from app.database import connect_database, initialize_database
from app.services import vocal_separation
from app.services.melody_match import (
    DEFAULT_MELODY_CONFIG,
    MelodyFeatures,
    chroma_cost,
    extract_features,
    extract_melody,
    features_from_blobs,
    features_to_blobs,
    match_melody,
    melody_cost,
)

SAMPLE_RATE = DEFAULT_MELODY_CONFIG.sample_rate
SCALE = np.array([0, 2, 4, 5, 7, 9, 11])


def _notes(seed: int, count: int) -> list[tuple[int, float]]:
    """A deterministic tune: (MIDI note, duration in seconds) pairs."""
    rng = np.random.default_rng(seed)
    return [
        (
            int(60 + SCALE[rng.integers(0, 7)] + 12 * rng.integers(0, 2)),
            float(rng.choice([0.3, 0.45, 0.6])),
        )
        for _ in range(count)
    ]


def _render(
    notes: list[tuple[int, float]],
    transpose: int = 0,
    tempo: float = 1.0,
    harmonics: tuple[float, ...] = (1.0, 0.5, 0.25),
) -> np.ndarray:
    """Sing the tune: another key (semitones), tempo (> 1 faster) or timbre is another version."""
    parts = []
    for midi, duration in notes:
        seconds = duration / tempo
        time = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
        frequency = 440.0 * 2 ** ((midi + transpose - 69) / 12)
        tone = sum(
            amplitude * np.sin(2 * np.pi * frequency * (index + 1) * time)
            for index, amplitude in enumerate(harmonics)
        )
        envelope = np.minimum(1.0, np.minimum(time, seconds - time) / 0.02)
        parts.append(tone * envelope)
    return (0.3 * np.concatenate(parts)).astype(np.float64)


def _random_melody(seed: int, length: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return np.repeat(60 + SCALE[rng.integers(0, 7, size=length // 4 + 1)], 4)[:length].astype(float)


def _random_chroma(seed: int, frames: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    chroma = np.repeat(rng.random((12, frames // 4 + 1)) ** 4, 4, axis=1)[:, :frames]
    return chroma / np.linalg.norm(chroma, axis=0, keepdims=True)


def test_extract_melody_tracks_sung_notes() -> None:
    audio = _render([(69, 1.0), (72, 1.0), (64, 1.0)])

    melody = extract_melody(audio)

    assert len(melody) >= 25
    assert set(np.round(melody).astype(int)) <= {69, 72, 64}
    assert np.round(np.median(melody[:5])) == 69


def test_melody_cost_finds_a_transposed_and_stretched_excerpt() -> None:
    song = _random_melody(1, 600)
    excerpt = song[200:300]
    # 25% slower and three semitones higher, as another singer might perform it.
    stretched = np.interp(np.linspace(0, len(excerpt) - 1, 125), np.arange(len(excerpt)), excerpt)
    query = stretched + 3

    cost, start, shift = melody_cost(query, song)
    unrelated_cost, _, _ = melody_cost(query, _random_melody(2, 600))

    assert cost < 0.2
    assert abs(start - 200) <= 3
    assert shift == 9  # the query is lifted by 9 (i.e. lowered by 3) semitones to meet the song
    assert unrelated_cost > 3 * cost + 0.3


def test_chroma_cost_finds_a_key_shifted_excerpt() -> None:
    song = _random_chroma(3, 500)
    query = np.roll(song[:, 120:220], -5, axis=0)

    cost, start, shift = chroma_cost(query, song)

    assert cost < 0.05
    assert abs(start - 120) <= 2
    assert shift == 5
    assert chroma_cost(query, _random_chroma(4, 500))[0] > cost + 0.2


def _catalog_features(count: int) -> dict[str, MelodyFeatures]:
    return {
        str(index): MelodyFeatures(
            melody=_random_melody(10 + index, 900),
            vocal_chroma=_random_chroma(20 + index, 1200),
            mix_chroma=_random_chroma(30 + index, 1200),
        )
        for index in range(1, count + 1)
    }


def _query_from(features: MelodyFeatures, start: int, frames: int) -> MelodyFeatures:
    return MelodyFeatures(
        melody=features.melody[start : start + frames] + 2,
        vocal_chroma=np.roll(features.vocal_chroma[:, start : start + frames], 2, axis=0),
        mix_chroma=np.roll(features.mix_chroma[:, start : start + frames], 2, axis=0),
    )


def test_match_melody_accepts_a_clear_winner() -> None:
    songs = _catalog_features(6)
    query = _query_from(songs["4"], 300, 120)

    match = match_melody(query, 12.0, songs)

    assert match is not None
    assert match.song_id == "4"
    assert match.timestamp_seconds == pytest.approx(300 / 10.4, abs=0.5)
    assert match.key_shift_semitones == 2
    assert match.ranking[0][0] == "4"


def test_match_melody_rejects_unknown_short_and_silent_queries() -> None:
    songs = _catalog_features(6)
    unknown = MelodyFeatures(
        melody=_random_melody(99, 120),
        vocal_chroma=_random_chroma(98, 120),
        mix_chroma=_random_chroma(97, 120),
    )
    known = _query_from(songs["2"], 100, 120)
    silent = MelodyFeatures(np.zeros(5), known.vocal_chroma, known.mix_chroma)

    assert match_melody(unknown, 12.0, songs) is None
    assert match_melody(known, 5.0, songs) is None  # shorter than min_query_seconds
    assert match_melody(silent, 12.0, songs) is None  # too little singing
    assert match_melody(known, 12.0, {"2": songs["2"]}) is None  # catalog too small to rank


def test_feature_blobs_round_trip() -> None:
    features = _catalog_features(1)["1"]

    restored = features_from_blobs(*features_to_blobs(features))

    np.testing.assert_allclose(restored.melody, features.melody, rtol=1e-6)
    np.testing.assert_allclose(restored.vocal_chroma, features.vocal_chroma, atol=1e-6)
    assert restored.mix_chroma.shape == features.mix_chroma.shape


def test_melody_catalog_is_empty_for_databases_without_the_table(tmp_path: Path) -> None:
    path = tmp_path / "old.db"
    with closing(connect_database(initialize_database(path))) as connection:
        connection.execute("DROP TABLE melody_features")
        assert melody_catalog.load_melody_catalog(connection) == {}


def test_recognize_file_matches_another_version_by_melody(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    tunes = {seed: _notes(seed, 110) for seed in (1, 2, 3, 4)}
    database_path = initialize_database(tmp_path / "apollo.db")
    with closing(connect_database(database_path)) as connection:
        for seed, notes in tunes.items():
            audio = _render(notes)
            song_path = tmp_path / f"song-{seed}.wav"
            sf.write(song_path, audio, SAMPLE_RATE)
            song = catalog.ingest_song(
                song_path, f"Song {seed}", f"https://open.spotify.com/track/{seed}", connection
            )
            melody_catalog.store_melody_features(
                int(str(song["id"])), extract_features(audio, audio), connection
            )

        # Another version of song 3: a different singer (timbre), 3 semitones up, 20% slower.
        cover = _render(tunes[3][30:60], transpose=3, tempo=0.8, harmonics=(1.0, 0.1, 0.4, 0.2))
        cover_path = tmp_path / "cover.wav"
        sf.write(cover_path, cover, SAMPLE_RATE)
        separated = vocal_separation.SeparatedAudio(cover, cover, SAMPLE_RATE)
        monkeypatch.setattr(vocal_separation, "is_available", lambda: True)
        monkeypatch.setattr(vocal_separation, "separate_file", lambda path, rate: separated)

        recognition = catalog.recognize_file(cover_path, connection)

        assert recognition["matched"] is True
        assert recognition["matchMethod"] == "melody"
        assert recognition["song"]["name"] == "Song 3"  # type: ignore[index]
        assert recognition["keyShiftSemitones"] == 3


def test_melody_fallback_is_skipped_without_vocal_separation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(vocal_separation, "is_available", lambda: False)
    audio_path = tmp_path / "query.wav"
    sf.write(audio_path, _render(_notes(5, 40)), SAMPLE_RATE)
    with closing(connect_database(initialize_database(tmp_path / "apollo.db"))) as connection:
        assert melody_catalog.recognize_melody(audio_path, connection) is None


def test_a_failing_melody_step_does_not_break_recognition(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(path: Path, connection: object) -> None:
        raise RuntimeError("CUDA out of memory")

    monkeypatch.setattr(catalog, "recognize_melody", broken)
    audio_path = tmp_path / "query.wav"
    sf.write(audio_path, _render(_notes(6, 40)), SAMPLE_RATE)
    with closing(connect_database(initialize_database(tmp_path / "apollo.db"))) as connection:
        assert catalog.recognize_file(audio_path, connection)["matched"] is False
