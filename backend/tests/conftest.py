"""Shared pytest fixtures.

Every test gets its own temporary data directory, so the developer's real
`data/` folder and any seeded demo state are never touched.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.config import Settings
from app.main import create_app


@pytest.fixture()
def settings(tmp_path) -> Settings:
    cfg = Settings(
        data_dir=tmp_path / "data",
        ai_provider="none",
        ai_api_key="",
        ai_model="",
        max_upload_mb=20,
    )
    cfg.ensure_dirs()
    return cfg


@pytest.fixture()
def client(settings: Settings) -> TestClient:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture()
def app_settings(settings: Settings) -> Settings:
    """Expose the same settings object used by the test client."""
    return settings


def make_image(seed: int = 1, size: tuple[int, int] = (800, 600)) -> bytes:
    """A textured JPEG so blur/overlap analysis has real pixels to work with."""
    image = Image.new("RGB", size, (176, 168, 158))
    draw = ImageDraw.Draw(image)
    for index in range(26):
        x = (index * 71 + seed * 43) % (size[0] - 40)
        y = (index * 53 + seed * 29) % (size[1] - 40)
        draw.rectangle(
            [x, y, x + 70, y + 50],
            fill=(
                (index * 37 + seed * 60) % 255,
                (index * 59) % 255,
                (index * 23 + seed * 31) % 255,
            ),
        )
    draw.text((24, 24), f"room {seed}", fill=(0, 0, 0))
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=88)
    return buffer.getvalue()


@pytest.fixture()
def image_bytes() -> bytes:
    return make_image(1)
