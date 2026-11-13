"""Upload validation and image normalisation."""

from __future__ import annotations

import io
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from ..config import Settings

IMAGE_TYPES = {"JPEG", "PNG", "WEBP"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".m4v"}


class MediaError(ValueError):
    """Raised when an uploaded file is not usable media."""


def probe_image(path: Path) -> tuple[int, int, str]:
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            width, height = image.size
            image_format = (image.format or "").upper()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise MediaError("File gambar tidak dapat dibaca.") from exc
    if image_format not in IMAGE_TYPES:
        raise MediaError(f"Format gambar {image_format or 'tidak dikenal'} tidak didukung.")
    return width, height, image_format


def probe_video(settings: Settings, path: Path) -> dict:
    cmd = [
        settings.ffprobe_bin,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,codec_name:format=duration,format_name",
        "-of",
        "json",
        str(path),
    ]
    try:
        completed = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except FileNotFoundError as exc:
        raise MediaError("FFprobe tidak tersedia di server.") from exc
    except subprocess.TimeoutExpired as exc:
        raise MediaError("Pemeriksaan video melebihi batas waktu.") from exc
    if completed.returncode != 0:
        raise MediaError("File video tidak dapat dibaca.")
    try:
        payload = json.loads(completed.stdout)
        stream = payload["streams"][0]
        duration = float(payload.get("format", {}).get("duration", 0) or 0)
    except (KeyError, ValueError, IndexError, TypeError) as exc:
        raise MediaError("Metadata video tidak lengkap.") from exc
    return {
        "width": int(stream.get("width", 0)),
        "height": int(stream.get("height", 0)),
        "duration": duration,
        "codec": stream.get("codec_name"),
    }


def detect_kind(path: Path, settings: Settings) -> dict:
    suffix = path.suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        width, height, image_format = probe_image(path)
        return {"kind": "image", "width": width, "height": height, "format": image_format}
    if suffix in VIDEO_EXTENSIONS:
        meta = probe_video(settings, path)
        return {"kind": "video", **meta}
    raise MediaError("Format file tidak didukung. Gunakan JPG, PNG, WEBP, MP4, MOV, atau WEBM.")


def normalise_image(path: Path, destination: Path, max_px: int = 1600, quality: int = 85) -> tuple[int, int]:
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
        image.thumbnail((max_px, max_px), Image.LANCZOS)
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, "JPEG", quality=quality, optimize=True)
        return image.size


def make_thumbnail(source: Path, destination: Path, max_px: int = 360) -> tuple[int, int]:
    with Image.open(source) as image:
        image = image.convert("RGB")
        image.thumbnail((max_px, max_px), Image.LANCZOS)
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, "JPEG", quality=72, optimize=True)
        return image.size


def compress_photo(raw: bytes, max_px: int = 900, quality: int = 82) -> tuple[bytes, int, int]:
    try:
        with Image.open(io.BytesIO(raw)) as image:
            image = ImageOps.exif_transpose(image)
            image = image.convert("RGB")
            image.thumbnail((max_px, max_px), Image.LANCZOS)
            output = io.BytesIO()
            image.save(output, "JPEG", quality=quality, optimize=True)
            return output.getvalue(), image.width, image.height
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise MediaError("Foto tidak dapat diproses.") from exc
