"""Photo upload for location references."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..config import Settings
from ..schemas import PhotoOut
from ..services.storage import MediaError, compress_photo
from ..utils import new_id
from .system import app_settings

router = APIRouter(prefix="/api/uploads", tags=["uploads"])
MAX_PHOTO_BYTES = 8 * 1024 * 1024


@router.post("/photo", response_model=PhotoOut)
async def upload_photo(
    file: UploadFile = File(...), settings: Settings = Depends(app_settings)
) -> dict:
    raw = await file.read(MAX_PHOTO_BYTES + 1)
    if len(raw) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Foto terlalu besar (maksimum 8 MB).")
    if not raw:
        raise HTTPException(status_code=400, detail="File foto kosong.")
    try:
        data, width, height = compress_photo(raw)
    except MediaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    filename = f"{new_id('photo')}.jpg"
    destination = settings.photos_dir / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    return {"url": f"/media/photos/{filename}", "width": width, "height": height}
