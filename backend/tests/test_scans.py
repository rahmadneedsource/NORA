"""Scan pipeline and finding review tests.

The AI provider is forced to `none` in the test settings, so these tests
verify the honest degraded path: real frame extraction and quality metrics,
no fabricated hazard findings.
"""

from __future__ import annotations

import shutil
import subprocess
import time

import pytest

from app import repository
from tests.conftest import make_image


def _wait_for_job(client, job_id: str, timeout: float = 60.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/scans/{job_id}").json()
        if job["status"] in {"ready", "failed"}:
            return job
        time.sleep(0.2)
    raise AssertionError(f"Scan job {job_id} did not finish in {timeout}s")


def _create_scan(client, names=("a.jpg", "b.jpg", "c.jpg"), floor_id="floor-1"):
    files = [
        ("files", (name, make_image(index + 1), "image/jpeg"))
        for index, name in enumerate(names)
    ]
    return client.post(
        "/api/scans",
        data={"area_name": "Kamar Uji", "floor_id": floor_id},
        files=files,
    )


def test_photo_scan_reaches_ready_without_fabricated_findings(client):
    response = _create_scan(client)

    assert response.status_code == 202, response.text
    job = _wait_for_job(client, response.json()["id"])

    assert job["status"] == "ready", job.get("error")
    assert job["aiMode"] == "quality_only"
    assert len(job["frames"]) == 3
    assert all(stage["status"] == "done" for stage in job["stages"])
    assert job["result"]["frameCount"] == 3
    assert job["result"]["quality"]["usableFrames"] == 3
    assert job["result"]["quality"]["coverageScore"] is not None
    assert job["result"]["analysis"]["mode"] == "quality_only"
    assert job["findings"] == []

    frame = job["frames"][0]
    assert client.get(frame["path"]).status_code == 200
    assert client.get(frame["thumbPath"]).status_code == 200


def test_scan_appears_in_history_and_summary(client):
    job_id = _create_scan(client).json()["id"]
    job = _wait_for_job(client, job_id)

    summaries = client.get("/api/scans").json()

    assert any(item["id"] == job["id"] and item["status"] == "ready" for item in summaries)
    history = client.get("/api/history").json()
    assert any("Pemindaian Selesai" in item["title"] for item in history)


def test_scan_rejects_unsupported_extension(client):
    response = client.post(
        "/api/scans",
        data={"area_name": "Uji", "floor_id": "floor-1"},
        files={"files": ("catatan.txt", b"bukan media", "text/plain")},
    )

    assert response.status_code == 400
    assert "tidak didukung" in response.json()["detail"]


def test_scan_rejects_unknown_floor(client):
    response = _create_scan(client, floor_id="floor-99")

    assert response.status_code == 422


def test_finding_accept_creates_hazard_and_blocks_scan_delete(client, settings):
    job_id = _create_scan(client).json()["id"]
    job = _wait_for_job(client, job_id)
    assert job["status"] == "ready"

    finding = repository.insert_finding(
        settings,
        job_id,
        {
            "category": "tripping",
            "title": "Kabel di lantai",
            "description": "Kabel melintang di lorong.",
            "recommendation": "Rapikan kabel.",
            "priority": "high",
            "confidence": 0.82,
        },
    )

    accepted = client.post(
        f"/api/scans/{job_id}/findings/{finding['id']}/accept",
        json={"locationId": "loc_bedroom_main"},
    )

    assert accepted.status_code == 200, accepted.text
    hazard = accepted.json()
    assert hazard["source"] == "ai_scan"
    assert hazard["category"] == "tripping"
    assert hazard["floorId"] == "floor-1"
    assert hazard["edgeIds"]

    again = client.post(
        f"/api/scans/{job_id}/findings/{finding['id']}/accept",
        json={"locationId": "loc_bedroom_main"},
    )
    assert again.status_code == 200
    assert again.json()["id"] == hazard["id"]

    findings = client.get(f"/api/scans/{job_id}").json()["findings"]
    reviewed = next(item for item in findings if item["id"] == finding["id"])
    assert reviewed["status"] == "diterima"
    assert reviewed["hazardId"] == hazard["id"]

    blocked = client.delete(f"/api/scans/{job_id}")
    assert blocked.status_code == 409

    assert client.delete(f"/api/hazards/{hazard['id']}").status_code == 200
    detached = client.get(f"/api/scans/{job_id}").json()["findings"]
    assert next(item for item in detached if item["id"] == finding["id"])["status"] == "perlu_diperiksa"
    assert client.delete(f"/api/scans/{job_id}").status_code == 200
    assert client.get(f"/api/scans/{job_id}").status_code == 404


def test_finding_accept_validates_location(client, settings):
    job_id = _create_scan(client).json()["id"]
    _wait_for_job(client, job_id)
    finding = repository.insert_finding(
        settings,
        job_id,
        {"category": "other", "title": "Uji", "confidence": 0.4},
    )

    response = client.post(
        f"/api/scans/{job_id}/findings/{finding['id']}/accept",
        json={"locationId": "loc_missing"},
    )

    assert response.status_code == 404


def test_finding_dismiss_and_unknown_ids(client, settings):
    job_id = _create_scan(client).json()["id"]
    _wait_for_job(client, job_id)
    finding = repository.insert_finding(
        settings,
        job_id,
        {"category": "other", "title": "Uji", "confidence": 0.4},
    )

    dismissed = client.post(f"/api/scans/{job_id}/findings/{finding['id']}/dismiss")

    assert dismissed.status_code == 200
    findings = client.get(f"/api/scans/{job_id}").json()["findings"]
    assert next(item for item in findings if item["id"] == finding["id"])["status"] == "diabaikan"

    assert client.post(f"/api/scans/{job_id}/findings/missing/dismiss").status_code == 404


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg not installed")
def test_video_scan_extracts_frames(client, tmp_path):
    source = tmp_path / "source.jpg"
    source.write_bytes(make_image(9, size=(640, 480)))
    video = tmp_path / "walkthrough.mp4"
    completed = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-loop",
            "1",
            "-i",
            str(source),
            "-t",
            "2",
            "-r",
            "8",
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "mpeg4",
            str(video),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if completed.returncode != 0 or not video.is_file():
        pytest.skip("FFmpeg could not synthesise a test video")

    response = client.post(
        "/api/scans",
        data={"area_name": "Video Uji", "floor_id": "floor-1"},
        files={"files": ("walkthrough.mp4", video.read_bytes(), "video/mp4")},
    )

    assert response.status_code == 202, response.text
    job = _wait_for_job(client, response.json()["id"])

    assert job["status"] == "ready", job.get("error")
    assert len(job["frames"]) >= 1
    assert job["result"]["quality"]["usableFrames"] >= 1
