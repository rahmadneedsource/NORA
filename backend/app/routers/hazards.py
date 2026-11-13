"""Hazard records and caregiver verification."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from .. import repository
from ..config import Settings
from ..content import FINDING_CATEGORIES, FLOOR_LABELS
from ..schemas import HazardCreate, HazardOut, HazardUpdate
from ..services.navigation import get_graph
from .system import app_settings

router = APIRouter(prefix="/api", tags=["hazards"])


def _validate_edges(edge_ids: list[str]) -> None:
    known = {edge["id"] for edge in get_graph()["edges"]}
    unknown = [edge_id for edge_id in edge_ids if edge_id not in known]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Edge tidak dikenal: {', '.join(unknown)}")


@router.get("/hazards", response_model=list[HazardOut])
def list_hazards(floor_id: str | None = None, settings: Settings = Depends(app_settings)):
    if floor_id and floor_id not in FLOOR_LABELS:
        raise HTTPException(status_code=422, detail="Lantai tidak dikenal.")
    return repository.list_hazards(settings, floor_id)


@router.post("/hazards", response_model=HazardOut, status_code=201)
def create_hazard(payload: HazardCreate, settings: Settings = Depends(app_settings)):
    _validate_edges(payload.edge_ids)
    if payload.category not in FINDING_CATEGORIES:
        raise HTTPException(status_code=422, detail="Kategori hambatan tidak dikenal.")
    hazard = repository.insert_hazard(settings, payload.model_dump(by_alias=True))
    repository.add_history(
        settings,
        "hazard",
        f"Hambatan dicatat: {payload.type}",
        f"{FLOOR_LABELS[payload.floor_id]} - {payload.location_name or 'tanpa lokasi'}",
    )
    return hazard


@router.get("/hazards/{hazard_id}", response_model=HazardOut)
def get_hazard(hazard_id: str, settings: Settings = Depends(app_settings)):
    hazard = repository.get_hazard(settings, hazard_id)
    if not hazard:
        raise HTTPException(status_code=404, detail="Hambatan tidak ditemukan.")
    return hazard


@router.patch("/hazards/{hazard_id}", response_model=HazardOut)
def update_hazard(
    hazard_id: str, payload: HazardUpdate, settings: Settings = Depends(app_settings)
):
    existing = repository.get_hazard(settings, hazard_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Hambatan tidak ditemukan.")
    fields: dict = {}
    if payload.status is not None:
        fields["status"] = payload.status
    if payload.priority is not None:
        fields["priority"] = payload.priority
    if payload.recommendation is not None:
        fields["recommendation"] = payload.recommendation
    updated = repository.update_hazard(settings, hazard_id, fields)
    if payload.status is not None and payload.status != existing["status"]:
        repository.add_history(
            settings,
            "hazard",
            f"Verifikasi hambatan: {existing['type']}",
            f'{existing["locationName"] or "lokasi"} - status "{payload.status}"',
        )
    return updated


@router.delete("/hazards/{hazard_id}")
def delete_hazard(hazard_id: str, settings: Settings = Depends(app_settings)):
    existing = repository.get_hazard(settings, hazard_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Hambatan tidak ditemukan.")
    repository.delete_hazard(settings, hazard_id)
    repository.add_history(
        settings, "hazard", f"Hambatan dihapus: {existing['type']}", "Dihapus oleh caregiver"
    )
    return {"status": "ok", "id": hazard_id}
