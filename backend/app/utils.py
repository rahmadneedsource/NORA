"""Small shared helpers."""

from __future__ import annotations

import json
import re
import secrets
from datetime import datetime, timedelta, timezone

WIB = timezone(timedelta(hours=7))


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat(timespec="seconds")


def wib_now_label() -> str:
    return datetime.now(WIB).strftime("%d %b %Y, %H:%M WIB")


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(6)}"


def clamp_text(value: object, limit: int) -> str:
    text = "" if value is None else str(value).strip()
    text = re.sub(r"\s+", " ", text)
    return text[:limit]


def json_loads(text: str | None, fallback):
    if not text:
        return fallback
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return fallback


_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def safe_filename(name: str, fallback: str = "file") -> str:
    """Strip directories and unsafe characters from an uploaded filename."""
    base = (name or fallback).replace("\\", "/").split("/")[-1]
    base = _FILENAME_RE.sub("_", base).strip("._")
    if not base:
        base = fallback
    if len(base) > 90:
        stem, dot, ext = base.rpartition(".")
        if dot and len(ext) <= 8:
            base = stem[:80] + "." + ext
        else:
            base = base[:90]
    return base
