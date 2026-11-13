"""Location CRUD and photo handling."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File

from .. import repository
from ..config import Settings
from ..content import CATEGORY_ICONS, CATEGORY_LABELS, ICON_KEYS
from ..schemas import LocationCreate, LocationOut, LocationUpdate, PhotoOut
from ..services.navigation import get_graph
from ..services.storage import MediaError, compress_photo
from ..utils import new_id
from .system import app_settings

router = APIRouter(prefix="/api", tags=["locations"])


def _validate_node(settings: Settings, floor_id: str, node_id: str | None) -> None:
    if not node_id:
        return
    node = next((item for item in get_graph()["nodes"] if item["id"] == node_id), None)
    if node is None:
        raise HTTPException(status_code=422, detail="Titik akses tidak dikenal.")
    if node["floorId"] != floor_id:
        raise HTTPException(status_code=422, detail="Titik akses berada di lantai yang berbeda.")


def _validate_category(category: str) -> None:
    if category not in CATEGORY_LABELS:
        raise HTTPException(status_code=422, detail="Kategori lokasi tidak dikenal.")


@router.get("/locations", response_model=list[LocationOut])
def list_locations(settings: Settings = Depends(app_settings)):
    return repository.list_locations(settings)


@router.post("/locations", response_model=LocationOut, status_code=201)
def create_location(payload: LocationCreate, settings: Settings = Depends(app_settings)):
    _validate_category(payload.category)
    _validate_node(settings, payload.floor_id, payload.navigation_node_id)
    data = payload.model_dump(by_alias=True)
    data["iconKey"] = payload.icon_key or CATEGORY_ICONS.get(payload.category, "map-pin")
    data["verificationStatus"] = "verified" if payload.navigation_node_id else "needs_path"
    location = repository.insert_location(settings, data)
    repository.add_history(
        settings, "location", f"Lokasi ditambahkan: {payload.name}", f"{payload.floor_id}"
    )
    return location


@router.get("/locations/{location_id}", response_model=LocationOut)
def get_location(location_id: str, settings: Settings = Depends(app_settings)):
    location = repository.get_location(settings, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Lokasi tidak ditemukan.")
    return location


@router.patch("/locations/{location_id}", response_model=LocationOut)
def update_location(
    location_id: str, payload: LocationUpdate, settings: Settings = Depends(app_settings)
):
    existing = repository.get_location(settings, location_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Lokasi tidak ditemukan.")

    fields: dict = {}
    if payload.name is not None:
        fields["name"] = payload.name
    if payload.category is not None:
        _validate_category(payload.category)
        fields["category"] = payload.category
    if payload.floor_id is not None:
        fields["floor_id"] = payload.floor_id
        if "navigation_node_id" not in payload.model_fields_set:
            # Moving a location to another floor must not leave its access node
            # behind on the old floor.
            _validate_node(settings, payload.floor_id, existing["navigationNodeId"])
    if payload.icon_key is not None:
        if payload.icon_key not in ICON_KEYS:
            raise HTTPException(status_code=422, detail="Ikon tidak dikenal.")
        fields["icon_key"] = payload.icon_key
    if payload.label_position is not None:
        fields["x"] = payload.label_position.x
        fields["y"] = payload.label_position.y
        fields["z"] = payload.label_position.z
    if "navigation_node_id" in payload.model_fields_set:
        node_id = payload.navigation_node_id or None
        floor_id = fields.get("floor_id", existing["floorId"])
        _validate_node(settings, floor_id, node_id)
        fields["navigation_node_id"] = node_id
        fields["verification_status"] = "verified" if node_id else "needs_path"
    if "photo" in payload.model_fields_set:
        fields["photo"] = payload.photo or None

    updated = repository.update_location(settings, location_id, fields)
    return updated


@router.delete("/locations/{location_id}")
def delete_location(location_id: str, settings: Settings = Depends(app_settings)):
    existing = repository.get_location(settings, location_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Lokasi tidak ditemukan.")
    _remove_media_file(settings, existing.get("photo"))
    repository.delete_location(settings, location_id)
    repository.add_history(
        settings, "location", f"Lokasi dihapus: {existing['name']}", "Dihapus oleh caregiver"
    )
    return {"status": "ok", "id": location_id}


@router.delete("/locations/{location_id}/photo", response_model=LocationOut)
def delete_photo(location_id: str, settings: Settings = Depends(app_settings)):
    existing = repository.get_location(settings, location_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Lokasi tidak ditemukan.")
    _remove_media_file(settings, existing.get("photo"))
    return repository.update_location(settings, location_id, {"photo": None})


def _remove_media_file(settings: Settings, url: str | None) -> None:
    if not url or not url.startswith("/media/"):
        return
    path = (settings.media_dir / url.removeprefix("/media/")).resolve()
    try:
        path.relative_to(settings.media_dir.resolve())
    except ValueError:
        return
    path.unlink(missing_ok=True)
