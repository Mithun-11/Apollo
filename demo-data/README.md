# Local demo audio

Place local full songs here when running the teaching/demo pipeline. Audio files in this directory
are intentionally ignored by Git; do not commit copyrighted music.

For the persisted catalog, run `python -m app.catalog` from `backend/` with a relative path such as
`..\..\Songs\song.wav`, a song name, and a Spotify URL. The file is fingerprinted and discarded;
the audio is not uploaded.
