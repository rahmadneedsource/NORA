"""Unit tests for the optional vision adapter.

No external API is called. The provider function is monkeypatched so the tests
cover the success, malformed-response, and network-failure paths.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.config import Settings
from app.services import vision
from tests.conftest import make_image


def _ai_settings(tmp_path, provider="openai_compatible") -> Settings:
    cfg = Settings(
        data_dir=tmp_path / "data",
        ai_provider=provider,
        ai_api_key="test-key",
        ai_base_url="https://provider.invalid/v1",
        ai_model="test-vision",
        ai_max_frames=2,
    )
    cfg.ensure_dirs()
    return cfg


def _frames(tmp_path):
    frame_path = tmp_path / "frame.jpg"
    frame_path.write_bytes(make_image(3))
    return [
        {
            "id": 1,
            "index": 0,
            "filename": "frame_001.jpg",
            "path": "/media/scans/scan_test/frames/frame_001.jpg",
            "thumbPath": "/media/scans/scan_test/thumbs/frame_001.jpg",
            "timestampS": 0.0,
            "width": 800,
            "height": 600,
            "flags": [],
            "localPath": str(frame_path),
        }
    ]


def test_vision_success_maps_findings(tmp_path, monkeypatch):
    settings = _ai_settings(tmp_path)
    payload = {
        "summary": "Ada kabel di lorong.",
        "findings": [
            {
                "category": "tripping",
                "title": "Kabel melintang",
                "description": "Kabel terlihat di jalur.",
                "priority": "high",
                "recommendation": "Rapikan kabel.",
                "location_hint": "dekat pintu",
                "frame_index": 0,
                "confidence": 0.87,
            }
        ],
        "limitations": ["Hanya satu frame."],
    }
    monkeypatch.setattr(
        vision, "_post_openai", lambda *args, **kwargs: (json.dumps(payload), {"total_tokens": 42})
    )

    result = vision.analyze(settings, _frames(tmp_path), "Lorong", "Lantai 1")

    assert result["mode"] == "ai"
    assert result["model"] == "test-vision"
    assert len(result["findings"]) == 1
    finding = result["findings"][0]
    assert finding["title"] == "Kabel melintang"
    assert finding["frameId"] == 1
    assert finding["evidenceUrl"].endswith("frame_001.jpg")
    assert finding["confidence"] == 0.87
    assert any("wajib diperiksa caregiver" in text for text in result["limitations"])


def test_vision_network_failure_is_degraded(tmp_path, monkeypatch):
    settings = _ai_settings(tmp_path)

    def fail(*args, **kwargs):
        raise httpx.ConnectError("provider offline")

    monkeypatch.setattr(vision, "_post_openai", fail)

    result = vision.analyze(settings, _frames(tmp_path), "Lorong", "Lantai 1")

    assert result["mode"] == "degraded"
    assert result["findings"] == []
    assert result["error"]


def test_vision_invalid_json_is_degraded(tmp_path, monkeypatch):
    settings = _ai_settings(tmp_path)
    monkeypatch.setattr(vision, "_post_openai", lambda *args, **kwargs: ("bukan json", {}))

    result = vision.analyze(settings, _frames(tmp_path), "Lorong", "Lantai 1")

    assert result["mode"] == "degraded"
    assert result["findings"] == []


def test_vision_disabled_never_calls_provider(tmp_path, monkeypatch):
    settings = _ai_settings(tmp_path, provider="none")

    def unexpected(*args, **kwargs):
        raise AssertionError("provider must not be called when AI is disabled")

    monkeypatch.setattr(vision, "_post_openai", unexpected)

    result = vision.analyze(settings, _frames(tmp_path), "Lorong", "Lantai 1")

    assert result["mode"] == "quality_only"
    assert result["findings"] == []


def test_vision_merges_same_object_seen_in_several_frames(tmp_path, monkeypatch):
    settings = _ai_settings(tmp_path)
    payload = {
        "summary": "Ada benda di lantai lorong.",
        "findings": [
            {
                "category": "tripping",
                "title": "Benda di lantai",
                "priority": "medium",
                "confidence": 0.6,
                "frame_index": 0,
            },
            {
                "category": "tripping",
                "title": "benda  di LANTAI",
                "description": "Terlihat di frame kedua.",
                "priority": "medium",
                "confidence": 0.9,
                "frame_index": 1,
            },
            {
                "category": "lighting",
                "title": "Lorong gelap",
                "priority": "high",
                "confidence": 0.7,
                "frame_index": 1,
            },
        ],
        "limitations": [],
    }
    monkeypatch.setattr(
        vision, "_post_openai", lambda *args, **kwargs: (json.dumps(payload), {})
    )

    result = vision.analyze(settings, _frames(tmp_path), "Lorong", "Lantai 1")

    assert result["mode"] == "ai"
    assert len(result["findings"]) == 2
    merged = next(item for item in result["findings"] if item["category"] == "tripping")
    assert merged["confidence"] == 0.9
    assert merged["frameIndex"] == 0
    assert merged["description"] == "Terlihat di frame kedua."
    assert [item["category"] for item in result["findings"]] == ["tripping", "lighting"]
