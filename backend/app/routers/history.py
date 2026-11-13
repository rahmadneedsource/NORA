"""Activity history."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import repository
from ..config import Settings
from ..schemas import HistoryCreate, HistoryOut
from .system import app_settings

router = APIRouter(prefix="/api", tags=["history"])


@router.get("/history", response_model=list[HistoryOut])
def list_history(settings: Settings = Depends(app_settings)):
    return repository.list_history(settings)


@router.post("/history", response_model=list[HistoryOut], status_code=201)
def create_history(payload: HistoryCreate, settings: Settings = Depends(app_settings)):
    repository.add_history(settings, payload.type, payload.title, payload.detail)
    return repository.list_history(settings)


@router.delete("/history")
def clear_history(settings: Settings = Depends(app_settings)):
    deleted = repository.clear_history(settings)
    return {"status": "ok", "deleted": deleted}
