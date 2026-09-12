PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (trim(name) <> ''),
    spotify_url TEXT NOT NULL UNIQUE CHECK (trim(spotify_url) <> '')
);

CREATE TABLE IF NOT EXISTS acoustic_fingerprints (
    song_id INTEGER NOT NULL,
    fingerprint_version TEXT NOT NULL,
    hash_value INTEGER NOT NULL,
    anchor_frame INTEGER NOT NULL CHECK (anchor_frame >= 0),
    PRIMARY KEY (song_id, fingerprint_version, hash_value, anchor_frame),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS acoustic_fingerprint_lookup
ON acoustic_fingerprints (fingerprint_version, hash_value);
