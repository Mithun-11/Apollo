from __future__ import annotations

import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, cast

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .catalog import (
    SUPPORTED_AUDIO_EXTENSIONS,
    CatalogCache,
    ingest_song,
    load_catalog_cache,
    recognize_file,
    recognize_file_with_explanation,
)
from .supabase_client import get_supabase_client

MAX_AUDIO_BYTES = 50 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    application.state.catalog_cache = load_catalog_cache(get_supabase_client())
    yield
    application.state.catalog_cache = None


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


def _get_catalog_cache(request: Request) -> CatalogCache:
    cache = getattr(request.app.state, "catalog_cache", None)
    if cache is None:
        raise RuntimeError("Catalog cache is not loaded")
    return cast(CatalogCache, cache)


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
async def recognize(
    request: Request, audio: Annotated[UploadFile, File()]
) -> JSONResponse | dict[str, object]:
    path: Path | None = None
    try:
        path = await _save_upload(audio)
        return recognize_file(path, _get_catalog_cache(request))
    except ValueError as exc:
        return _error(422, "INVALID_AUDIO", str(exc))
    except Exception:
        return _error(500, "RECOGNITION_ERROR", "Unable to recognize this audio")
    finally:
        if path is not None:
            path.unlink(missing_ok=True)


@app.post("/recognize/explain", response_model=None)
async def recognize_with_explanation(
    request: Request,
    audio: Annotated[UploadFile, File()],
) -> JSONResponse | dict[str, object]:
    path: Path | None = None
    try:
        path = await _save_upload(audio)
        return recognize_file_with_explanation(path, _get_catalog_cache(request))
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
