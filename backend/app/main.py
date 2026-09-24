from __future__ import annotations

import tempfile
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager, closing
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .catalog import (
    SUPPORTED_AUDIO_EXTENSIONS,
    ingest_song,
    recognize_file,
    recognize_file_with_explanation,
)
from .database import connect_database
from .services import vocal_separation

MAX_AUDIO_BYTES = 50 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024

@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    with closing(connect_database()):
        pass
    vocal_separation.preload_in_background()
    yield


app = FastAPI(title="Apollo API", version="0.1.0", lifespan=lifespan)


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
        try:
            while chunk := await upload.read(CHUNK_SIZE):
                size += len(chunk)
                if size > MAX_AUDIO_BYTES:
                    raise ValueError("audio file is too large (maximum 50 MB)")
                temporary.write(chunk)
        finally:
            temporary.close()
            await upload.close()
    except Exception:
        path.unlink(missing_ok=True)
        raise
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
        with closing(connect_database()) as connection:
            return ingest_song(path, name, spotify_url, connection)
    except ValueError as exc:
        return _error(422, "INVALID_SONG", str(exc))
    except Exception:
        return _error(500, "STORAGE_ERROR", "Unable to store the song fingerprint")
    finally:
        if path is not None:
            path.unlink(missing_ok=True)


def _recognize(path: Path) -> dict[str, object]:
    with closing(connect_database()) as connection:
        return recognize_file(path, connection)


def _recognize_with_explanation(path: Path, skip_edit_search: bool) -> dict[str, object]:
    with closing(connect_database()) as connection:
        return recognize_file_with_explanation(
            path, connection, skip_edit_search=skip_edit_search
        )


# Recognition runs in a worker thread, so a request never waits behind an earlier one whose
# answer the page no longer needs (e.g. the last live check when listening stops).
@app.post("/recognize", response_model=None)
async def recognize(audio: Annotated[UploadFile, File()]) -> JSONResponse | dict[str, object]:
    path: Path | None = None
    try:
        path = await _save_upload(audio)
        return await run_in_threadpool(_recognize, path)
    except ValueError as exc:
        return _error(422, "INVALID_AUDIO", str(exc))
    except Exception:
        return _error(500, "RECOGNITION_ERROR", "Unable to recognize this audio")
    finally:
        if path is not None:
            path.unlink(missing_ok=True)


@app.post("/recognize/explain", response_model=None)
async def recognize_with_explanation(
    audio: Annotated[UploadFile, File()],
    live_checks_failed: Annotated[bool, Form(alias="liveChecksFailed")] = False,
) -> JSONResponse | dict[str, object]:
    path: Path | None = None
    try:
        path = await _save_upload(audio)
        return await run_in_threadpool(_recognize_with_explanation, path, live_checks_failed)
    except ValueError as exc:
        return _error(422, "INVALID_AUDIO", str(exc))
    except Exception:
        return _error(500, "RECOGNITION_ERROR", "Unable to recognize this audio")
    finally:
        if path is not None:
            path.unlink(missing_ok=True)


@app.exception_handler(RequestValidationError)
async def request_validation_error(
    request: Request, _exc: RequestValidationError
) -> JSONResponse:
    code = "INVALID_SONG" if request.url.path == "/songs" else "INVALID_AUDIO"
    return _error(422, code, "audio file is required")
