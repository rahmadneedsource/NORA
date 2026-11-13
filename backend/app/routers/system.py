"""Bootstrap, health, and demo reset endpoints."""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Request

from .. import repository
from ..config import Settings
from ..content import CATEGORY_LABELS, ICON_KEYS
from ..db import reset_demo_data
from ..schemas import AIStatus, BootstrapOut, HealthOut
from ..services.navigation import get_graph

router = APIRouter(prefix="/api", tags=["system"])
APP_VERSION = "1.0.0"


def app_settings(request: Request) -> Settings:
    return request.app.state.settings


@router.get("/health", response_model=HealthOut)
def health(request: Request, settings: Settings = Depends(app_settings)) -> dict:
    database = "ok"
    try:
        with sqlite3.connect(settings.db_path) as conn:
            conn.execute("SELECT 1").fetchone()
    except sqlite3.Error:
        database = "error"
    return {
        "status": "ok" if database == "ok" else "degraded",
        "version": APP_VERSION,
        "database": database,
        "ai": settings.public_ai_status(),
    }


@router.get("/bootstrap", response_model=BootstrapOut)
def bootstrap(settings: Settings = Depends(app_settings)) -> dict:
    return {
        "home": repository.get_home(settings),
        "locations": repository.list_locations(settings),
        "hazards": repository.list_hazards(settings),
        "history": repository.list_history(settings),
        "graph": get_graph(),
        "floors": [
            {"id": "floor-1", "label": "Lantai 1"},
            {"id": "floor-2", "label": "Lantai 2"},
        ],
        "categories": CATEGORY_LABELS,
        "icons": sorted(ICON_KEYS),
        "ai": settings.public_ai_status(),
        "version": APP_VERSION,
    }


@router.post("/demo/reset")
def reset_demo(settings: Settings = Depends(app_settings)) -> dict:
    reset_demo_data(settings)
    return {"status": "ok", "message": "Data demo dikembalikan ke awal."}


@router.get("/ai/status", response_model=AIStatus)
def ai_status(settings: Settings = Depends(app_settings)) -> dict:
    return settings.public_ai_status()
