"""AI vision analysis with an OpenAI-compatible or Anthropic-compatible API.

The provider is optional. When it is not configured, or when the call fails, the
pipeline returns no hazard findings instead of inventing any. The UI must show
that degraded state honestly.
"""

from __future__ import annotations

import base64
import io
import json
import time
from pathlib import Path

import httpx
from PIL import Image
from pydantic import BaseModel, Field, field_validator

from ..config import Settings
from ..content import FINDING_CATEGORIES, HAZARD_PRIORITIES

SYSTEM_PROMPT = """Anda adalah asisten inspeksi keselamatan rumah untuk caregiver lansia dengan Alzheimer.
Tugas Anda: memeriksa frame rumah dan menandai potensi hambatan yang TERLIHAT.

Aturan wajib:
- Hanya laporkan objek atau kondisi yang benar-benar terlihat pada frame.
- Jangan menyimpulkan permukaan licin hanya dari penampilan.
- Jangan memberi diagnosis medis, jangan menyatakan rute "aman", dan jangan menjamin keselamatan.
- Jika ragu, gunakan confidence rendah atau jangan laporkan.
- Jangan mengarang detail yang tidak terlihat.
- Rekomendasi harus praktis untuk caregiver.

Kembalikan HANYA satu objek JSON valid tanpa markdown, dengan skema:
{
  "summary": "ringkasan singkat dalam bahasa Indonesia",
  "findings": [
    {
      "category": "tripping|slipping|lighting|mobility|access|other",
      "title": "nama singkat temuan",
      "description": "apa yang terlihat dan mengapa perlu diperiksa",
      "priority": "high|medium|low",
      "recommendation": "tindakan praktis untuk caregiver",
      "location_hint": "posisi singkat dalam frame, mis. dekat pintu",
      "frame_index": 0,
      "confidence": 0.0
    }
  ],
  "limitations": ["batasan pemeriksaan ini"]
}
Jika tidak ada temuan yang cukup yakin, kembalikan "findings": [].
"""


class VisionFinding(BaseModel):
    category: str = "other"
    title: str = Field(min_length=1)
    description: str = ""
    priority: str = "medium"
    recommendation: str = ""
    location_hint: str = ""
    frame_index: int = 0
    confidence: float = 0.5

    @field_validator("category")
    @classmethod
    def category_valid(cls, value: str) -> str:
        value = (value or "other").lower().strip()
        return value if value in FINDING_CATEGORIES else "other"

    @field_validator("priority")
    @classmethod
    def priority_valid(cls, value: str) -> str:
        value = (value or "medium").lower().strip()
        return value if value in HAZARD_PRIORITIES else "medium"

    @field_validator("confidence")
    @classmethod
    def confidence_valid(cls, value: float) -> float:
        try:
            return max(0.0, min(1.0, float(value)))
        except (TypeError, ValueError):
            return 0.5


class VisionPayload(BaseModel):
    summary: str = ""
    findings: list[VisionFinding] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


def _select_frames(frames: list[dict], limit: int) -> list[dict]:
    if not frames:
        return []
    preferred = [frame for frame in frames if not frame.get("flags")]
    pool = preferred if len(preferred) >= 2 else frames
    if len(pool) <= limit:
        return pool
    step = len(pool) / limit
    return [pool[min(len(pool) - 1, int(index * step))] for index in range(limit)]


def _image_data_url(path: Path, max_px: int) -> tuple[str, str]:
    with Image.open(path) as image:
        image = image.convert("RGB")
        image.thumbnail((max_px, max_px), Image.LANCZOS)
        output = io.BytesIO()
        image.save(output, "JPEG", quality=72, optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii"), "image/jpeg"


def _extract_json(text: str) -> dict:
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _post_openai(
    settings: Settings,
    context_text: str,
    images: list[tuple[str, str]],
) -> tuple[str, dict]:
    url = f"{settings.ai_base_url}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if settings.ai_api_key:
        headers["Authorization"] = f"Bearer {settings.ai_api_key}"
    if settings.ai_app_url:
        headers["HTTP-Referer"] = settings.ai_app_url
    if settings.ai_app_name:
        headers["X-Title"] = settings.ai_app_name

    user_content: list[dict] = [{"type": "text", "text": context_text}]
    for data, media_type in images:
        user_content.append(
            {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{data}"}}
        )

    payload = {
        "model": settings.ai_model,
        "temperature": 0.1,
        "max_tokens": 1600,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
    }

    with httpx.Client(timeout=settings.ai_timeout_seconds) as client:
        response = client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    content = data["choices"][0]["message"]["content"]
    if isinstance(content, list):
        content = " ".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    return str(content), data.get("usage") or {}


def _post_anthropic(
    settings: Settings,
    context_text: str,
    images: list[tuple[str, str]],
) -> tuple[str, dict]:
    base = settings.ai_base_url
    url = f"{base}/messages" if base.endswith("/v1") else f"{base}/v1/messages"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": settings.ai_api_key,
        "anthropic-version": "2023-06-01",
    }
    content: list[dict] = [{"type": "text", "text": context_text}]
    for data, media_type in images:
        content.append(
            {
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": data},
            }
        )
    payload = {
        "model": settings.ai_model,
        "max_tokens": 1600,
        "temperature": 0.1,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": content}],
    }
    with httpx.Client(timeout=settings.ai_timeout_seconds) as client:
        response = client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
    parts = [
        block.get("text", "")
        for block in data.get("content", [])
        if isinstance(block, dict) and block.get("type") == "text"
    ]
    return "\n".join(parts), data.get("usage") or {}


def analyze(
    settings: Settings,
    frames: list[dict],
    area_name: str,
    floor_label: str,
) -> dict:
    started = time.perf_counter()
    selected = _select_frames(frames, max(1, settings.ai_max_frames))

    if not settings.ai_configured:
        return {
            "mode": "quality_only",
            "provider": settings.ai_provider,
            "model": None,
            "summary": (
                "Analisis AI vision tidak aktif. Hasil pemindaian hanya memeriksa kualitas "
                "frame; tidak ada temuan bahaya yang dihasilkan model."
            ),
            "findings": [],
            "limitations": [settings.public_ai_status()["reason"]],
            "usage": {},
            "latencyMs": 0,
        }

    if not selected:
        return {
            "mode": "quality_only",
            "provider": settings.ai_provider,
            "model": settings.ai_model,
            "summary": "Tidak ada frame yang dapat dianalisis.",
            "findings": [],
            "limitations": ["Frame tidak tersedia."],
            "usage": {},
            "latencyMs": 0,
        }

    lines = [
        f"Area pemindaian: {area_name}",
        f"Lokasi: {floor_label}",
        f"Jumlah frame yang dikirim: {len(selected)}",
        "",
        "Daftar frame (gunakan frame_index sesuai nomor ini):",
    ]
    for index, frame in enumerate(selected):
        lines.append(
            f"- frame_index {index}: {frame['filename']}, detik {frame.get('timestampS', 0)}"
        )
    lines.append("")
    lines.append(
        "Periksa setiap frame dan laporkan potensi hambatan yang terlihat. "
        "Ingat: hanya JSON valid."
    )
    context_text = "\n".join(lines)

    try:
        images = [
            _image_data_url(Path(frame["localPath"]), settings.ai_max_image_px)
            for frame in selected
        ]
        if settings.ai_provider == "anthropic":
            raw_text, usage = _post_anthropic(settings, context_text, images)
        else:
            raw_text, usage = _post_openai(settings, context_text, images)
        payload = VisionPayload.model_validate(_extract_json(raw_text))
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        return _degraded(settings, started, f"Provider AI menolak permintaan (HTTP {status}).")
    except httpx.HTTPError:
        return _degraded(settings, started, "Provider AI tidak dapat dihubungi.")
    except (KeyError, ValueError, TypeError, json.JSONDecodeError):
        return _degraded(settings, started, "Respons AI tidak valid dan dibuang.")
    except Exception:
        return _degraded(settings, started, "Analisis AI gagal diproses.")

    findings = []
    for item in payload.findings[:6]:
        global_index = max(0, min(len(selected) - 1, int(item.frame_index)))
        frame = selected[global_index]
        findings.append(
            {
                "category": item.category,
                "title": item.title.strip()[:120],
                "description": (item.description or "").strip()[:500],
                "recommendation": (item.recommendation or "").strip()[:400],
                "priority": item.priority,
                "confidence": item.confidence,
                "frameIndex": int(frame.get("index", global_index)),
                "frameId": frame.get("id"),
                "evidenceUrl": frame.get("path"),
                "locationHint": (item.location_hint or "").strip()[:120],
            }
        )

    limitations = [text.strip()[:240] for text in payload.limitations if text.strip()][:6]
    limitations.append(
        "Temuan AI adalah skrining awal, bukan penilaian klinis, dan wajib diperiksa caregiver."
    )

    return {
        "mode": "ai",
        "provider": settings.ai_provider,
        "model": settings.ai_model,
        "summary": (payload.summary or "").strip()[:700]
        or f"Analisis selesai untuk {len(selected)} frame.",
        "findings": findings,
        "limitations": limitations,
        "usage": usage,
        "latencyMs": int((time.perf_counter() - started) * 1000),
    }


def _degraded(settings: Settings, started: float, message: str) -> dict:
    return {
        "mode": "degraded",
        "provider": settings.ai_provider,
        "model": settings.ai_model,
        "summary": "Analisis AI tidak selesai. Tidak ada temuan bahaya yang dibuat.",
        "findings": [],
        "limitations": [message],
        "usage": {},
        "latencyMs": int((time.perf_counter() - started) * 1000),
        "error": message,
    }
