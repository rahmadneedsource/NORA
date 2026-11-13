"""Application settings.

All secrets are read from environment variables (or a local .env file that is
never committed). Nothing in this module contains a real credential.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIR = BASE_DIR / "frontend"


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader so the app works without extra dependencies."""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(BASE_DIR / ".env")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _env_list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name, "")
    if not raw.strip():
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass
class Settings:
    app_env: str = field(default_factory=lambda: os.getenv("APP_ENV", "development"))
    data_dir: Path = field(
        default_factory=lambda: Path(os.getenv("DATA_DIR", str(BASE_DIR / "data"))).expanduser()
    )
    cors_origins: list[str] = field(
        default_factory=lambda: _env_list(
            "CORS_ORIGINS", ["http://localhost:8000", "http://127.0.0.1:8000"]
        )
    )

    ai_provider: str = field(default_factory=lambda: os.getenv("AI_PROVIDER", "none"))
    ai_base_url: str = field(default_factory=lambda: os.getenv("AI_BASE_URL", ""))
    ai_api_key: str = field(default_factory=lambda: os.getenv("AI_API_KEY", ""))
    ai_model: str = field(default_factory=lambda: os.getenv("AI_MODEL", ""))
    ai_app_name: str = field(default_factory=lambda: os.getenv("AI_APP_NAME", "NORA"))
    ai_app_url: str = field(default_factory=lambda: os.getenv("AI_APP_URL", ""))
    ai_timeout_seconds: int = field(default_factory=lambda: _env_int("AI_TIMEOUT_SECONDS", 60))
    ai_max_frames: int = field(default_factory=lambda: _env_int("AI_MAX_FRAMES", 6))
    ai_max_image_px: int = field(default_factory=lambda: _env_int("AI_MAX_IMAGE_PX", 768))

    max_upload_mb: int = field(default_factory=lambda: _env_int("MAX_UPLOAD_MB", 200))
    max_files: int = field(default_factory=lambda: _env_int("MAX_FILES", 20))

    ffmpeg_bin: str = field(default_factory=lambda: os.getenv("FFMPEG_BIN", "ffmpeg"))
    ffprobe_bin: str = field(default_factory=lambda: os.getenv("FFPROBE_BIN", "ffprobe"))

    def __post_init__(self) -> None:
        self.data_dir = Path(self.data_dir).expanduser().resolve()
        provider = (self.ai_provider or "none").strip().lower()
        if provider in {
            "openrouter",
            "openai",
            "gemini",
            "groq",
            "ollama",
            "openai-compatible",
            "openai_compatible",
        }:
            provider = "openai_compatible"
        if provider not in {"openai_compatible", "anthropic", "none"}:
            provider = "none"
        self.ai_provider = provider

        if self.ai_provider == "openai_compatible" and not self.ai_base_url:
            self.ai_base_url = "https://openrouter.ai/api/v1"
        if self.ai_provider == "anthropic" and not self.ai_base_url:
            self.ai_base_url = "https://api.anthropic.com"
        self.ai_base_url = self.ai_base_url.rstrip("/")
        if not self.ai_model:
            self.ai_model = "google/gemini-2.5-flash" if self.ai_provider == "openai_compatible" else ""

    # --- derived paths -----------------------------------------------------
    @property
    def db_path(self) -> Path:
        return self.data_dir / "nora.db"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def photos_dir(self) -> Path:
        return self.media_dir / "photos"

    @property
    def scans_media_dir(self) -> Path:
        return self.media_dir / "scans"

    @property
    def scans_upload_dir(self) -> Path:
        return self.uploads_dir / "scans"

    @property
    def ai_configured(self) -> bool:
        if self.ai_provider == "none":
            return False
        if not self.ai_model:
            return False
        if self.ai_provider == "openai_compatible":
            # Local OpenAI-compatible servers (Ollama, LM Studio) may not need a key.
            return bool(self.ai_api_key) or "localhost" in self.ai_base_url or "127.0.0.1" in self.ai_base_url
        return bool(self.ai_api_key)

    @property
    def ai_mode(self) -> str:
        return "ai" if self.ai_configured else "quality_only"

    def ensure_dirs(self) -> None:
        for directory in (
            self.data_dir,
            self.uploads_dir,
            self.media_dir,
            self.photos_dir,
            self.scans_media_dir,
            self.scans_upload_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)

    def public_ai_status(self) -> dict:
        if self.ai_configured:
            reason = "Model vision aktif untuk analisis potensi hambatan."
        elif self.ai_provider == "none":
            reason = "AI vision dinonaktifkan. Pemindaian hanya memeriksa kualitas frame."
        elif not self.ai_api_key and self.ai_provider != "openai_compatible":
            reason = "API key belum diatur. Pemindaian hanya memeriksa kualitas frame."
        else:
            reason = "Model AI belum tersedia. Pemindaian hanya memeriksa kualitas frame."
        return {
            "configured": self.ai_configured,
            "provider": self.ai_provider,
            "model": self.ai_model if self.ai_configured else None,
            "mode": self.ai_mode,
            "reason": reason,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings
