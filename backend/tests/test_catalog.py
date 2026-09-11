from pathlib import Path

from app import catalog


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
