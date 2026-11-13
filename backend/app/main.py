"""NORA FastAPI application factory."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import FRONTEND_DIR, Settings, get_settings
from .db import init_db
from .routers import hazards, history, locations, navigation, scans, system, uploads

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

APP_VERSION = "1.0.0"


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or get_settings()
    cfg.ensure_dirs()
    init_db(cfg)

    app = FastAPI(
        title="NORA API",
        description=(
            "Backend untuk pemetaan rumah 3D, navigasi, dan skrining potensi hambatan. "
            "Temuan AI adalah skrining awal dan wajib diverifikasi caregiver."
        ),
        version=APP_VERSION,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.state.settings = cfg

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    app.include_router(system.router)
    app.include_router(locations.router)
    app.include_router(uploads.router)
    app.include_router(hazards.router)
    app.include_router(navigation.router)
    app.include_router(scans.router)
    app.include_router(history.router)

    app.mount("/media", StaticFiles(directory=cfg.media_dir), name="media")
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
    return app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(create_app(), host="0.0.0.0", port=8000)
