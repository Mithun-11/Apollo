from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

from .catalog import SUPPORTED_AUDIO_EXTENSIONS, ingest_song, recognize_file
from .supabase_client import get_supabase_client

MAX_AUDIO_BYTES = 50 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
app = FastAPI(title="Apollo API", version="0.1.0")


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


async def _save_upload(upload: UploadFile) -> Path:
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in SUPPORTED_AUDIO_EXTENSIONS:
        raise ValueError("audio must be WAV, MP3, FLAC, or OGG")
    temporary = tempfile.NamedTemporaryFile(prefix="apollo-", suffix=suffix, delete=False)
    path = Path(temporary.name)
    size = 0
    try:
        while chunk := await upload.read(CHUNK_SIZE):
            size += len(chunk)
            if size > MAX_AUDIO_BYTES:
                raise ValueError("audio file is too large (maximum 50 MB)")
            temporary.write(chunk)
    finally:
        temporary.close()
        await upload.close()
    return path


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/songs", response_model=None)
async def create_song(
    audio: Annotated[UploadFile, File()],
    name: Annotated[str, Form()],
    spotify_url: Annotated[str, Form()],
) -> JSONResponse | dict[str, object]:
    path: Path | None = None
    try:
        path = await _save_upload(audio)
        return ingest_song(path, name, spotify_url, get_supabase_client())
    except ValueError as exc:
        return _error(422, "INVALID_SONG", str(exc))
    except Exception:
        return _error(500, "STORAGE_ERROR", "Unable to store the song fingerprint")
    finally:
        if path is not None:
            path.unlink(missing_ok=True)


@app.post("/recognize", response_model=None)
async def recognize(audio: Annotated[UploadFile, File()]) -> JSONResponse | dict[str, object]:
    path: Path | None = None
    try:
        path = await _save_upload(audio)
        return recognize_file(path, get_supabase_client())
    except ValueError as exc:
        return _error(422, "INVALID_AUDIO", str(exc))
    except Exception:
        return _error(500, "RECOGNITION_ERROR", "Unable to recognize this audio")
    finally:
        if path is not None:
            path.unlink(missing_ok=True)
