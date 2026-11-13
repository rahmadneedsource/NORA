"""Scan upload, job status, SSE events, and finding review."""

from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import StreamingResponse

from .. import repository
from ..config import Settings
from ..content import FINDING_CATEGORIES, FLOOR_LABELS
from ..schemas import (
    FindingAcceptRequest,
    HazardOut,
    ScanJobOut,
    ScanJobSummary,
)
from ..services.frames import cleanup_job_dirs
from ..services.navigation import get_graph
from ..services.pipeline import new_stages, run_pipeline
from ..services.storage import MediaError, detect_kind
from ..utils import new_id, safe_filename, wib_now_label
from .system import app_settings

router = APIRouter(prefix="/api/scans", tags=["scans"])

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".webm", ".m4v"}


def _detail(settings: Settings, job: dict) -> dict:
    payload = dict(job)
    payload["frames"] = repository.list_frames(settings, job["id"])
    payload["findings"] = repository.list_findings(settings, job["id"])
    return payload


def _summary(job: dict) -> dict:
    return {
        "id": job["id"],
        "area_name": job["areaName"],
        "floor_id": job["floorId"],
        "status": job["status"],
        "stage": job["stage"],
        "ai_mode": job["aiMode"],
        "created_at": job["createdAt"],
        "completed_at": job["completedAt"],
        "frame_count": job.get("frameCount", 0),
        "finding_count": job.get("findingCount", 0),
    }


@router.post("", response_model=ScanJobOut, status_code=202)
async def create_scan(
    background_tasks: BackgroundTasks,
    settings: Settings = Depends(app_settings),
    area_name: str = Form("Area Rumah"),
    floor_id: str = Form("floor-1"),
    files: list[UploadFile] = File(...),
) -> dict:
    if floor_id not in FLOOR_LABELS:
        raise HTTPException(status_code=422, detail="Lantai tidak dikenal.")
    area_name = (area_name or "Area Rumah").strip()[:100] or "Area Rumah"
    if not files:
        raise HTTPException(status_code=400, detail="Tidak ada file yang diunggah.")
    if len(files) > settings.max_files:
        raise HTTPException(
            status_code=413, detail=f"Maksimum {settings.max_files} file per pemindaian."
        )

    job_id = new_id("scan")
    raw_dir = settings.scans_upload_dir / job_id / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    total_bytes = 0
    limit_bytes = settings.max_upload_mb * 1024 * 1024
    saved: list[Path] = []

    try:
        for index, upload in enumerate(files):
            original = upload.filename or f"file_{index + 1}"
            suffix = Path(original).suffix.lower()
            if suffix not in ALLOWED_EXTENSIONS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Format {suffix or 'file'} tidak didukung. Gunakan JPG, PNG, WEBP, MP4, MOV, atau WEBM.",
                )
            destination = raw_dir / f"{index + 1:02d}_{safe_filename(original)}"
            with destination.open("wb") as handle:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    total_bytes += len(chunk)
                    if total_bytes > limit_bytes:
                        raise HTTPException(
                            status_code=413,
                            detail=f"Total upload melebihi {settings.max_upload_mb} MB.",
                        )
                    handle.write(chunk)
            if destination.stat().st_size == 0:
                raise HTTPException(status_code=400, detail=f"File {original} kosong.")
            saved.append(destination)

        for path in saved:
            try:
                detect_kind(path, settings)
            except MediaError as exc:
                raise HTTPException(status_code=400, detail=f"{path.name}: {exc}") from exc

        job = repository.create_scan_job(
            settings,
            area_name=area_name,
            floor_id=floor_id,
            stages=new_stages(),
            ai_mode=settings.ai_mode,
            job_id=job_id,
        )
        background_tasks.add_task(run_pipeline, settings, job_id)
        return _detail(settings, job)

    except HTTPException:
        shutil.rmtree(settings.scans_upload_dir / job_id, ignore_errors=True)
        raise
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(settings.scans_upload_dir / job_id, ignore_errors=True)
        raise HTTPException(status_code=500, detail="Gagal menyimpan file pemindaian.") from exc


@router.get("", response_model=list[ScanJobSummary])
def list_scans(limit: int = 20, settings: Settings = Depends(app_settings)):
    limit = max(1, min(limit, 100))
    return [_summary(job) for job in repository.list_scan_jobs(settings, limit)]


@router.get("/{job_id}", response_model=ScanJobOut)
def get_scan(job_id: str, settings: Settings = Depends(app_settings)):
    job = repository.get_scan_job(settings, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job pemindaian tidak ditemukan.")
    return _detail(settings, job)


@router.get("/{job_id}/events")
async def scan_events(job_id: str, request: Request, settings: Settings = Depends(app_settings)):
    job = repository.get_scan_job(settings, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job pemindaian tidak ditemukan.")

    async def stream():
        last_payload: str | None = None
        for _ in range(1200):
            if await request.is_disconnected():
                break
            current = await asyncio.to_thread(repository.get_scan_job, settings, job_id)
            if current is None:
                break
            payload = {
                "id": current["id"],
                "status": current["status"],
                "stage": current["stage"],
                "stages": current["stages"],
                "error": current["error"],
                "result": current["result"],
            }
            serialised = json.dumps(payload, ensure_ascii=False)
            if serialised != last_payload:
                last_payload = serialised
                yield f"event: update\ndata: {serialised}\n\n"
            if current["status"] in {"ready", "failed"}:
                yield "event: done\ndata: {}\n\n"
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/{job_id}")
def delete_scan(job_id: str, settings: Settings = Depends(app_settings)):
    job = repository.get_scan_job(settings, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job pemindaian tidak ditemukan.")
    accepted = [
        finding
        for finding in repository.list_findings(settings, job_id)
        if finding["status"] == "diterima"
    ]
    if accepted:
        raise HTTPException(
            status_code=409,
            detail="Pemindaian ini memiliki hambatan yang sudah diterima. Hapus hambatan terkait lebih dulu.",
        )
    repository.delete_scan_job(settings, job_id)
    cleanup_job_dirs(settings, job_id)
    repository.add_history(
        settings, "scan", f"Pemindaian dihapus: {job['areaName']}", "Media dan frame dihapus"
    )
    return {"status": "ok", "id": job_id}


@router.post("/{job_id}/findings/{finding_id}/accept", response_model=HazardOut)
def accept_finding(
    job_id: str,
    finding_id: str,
    payload: FindingAcceptRequest,
    settings: Settings = Depends(app_settings),
):
    job = repository.get_scan_job(settings, job_id)
    finding = repository.get_finding(settings, finding_id)
    if not job or not finding or finding["jobId"] != job_id:
        raise HTTPException(status_code=404, detail="Temuan tidak ditemukan.")
    if finding["status"] == "diterima" and finding.get("hazardId"):
        existing = repository.get_hazard(settings, finding["hazardId"])
        if existing:
            return existing
    if finding["status"] in {"diterima", "diabaikan"}:
        raise HTTPException(status_code=409, detail="Temuan ini sudah ditinjau.")

    location = (
        repository.get_location(settings, payload.location_id) if payload.location_id else None
    )
    if payload.location_id and location is None:
        raise HTTPException(status_code=404, detail="Lokasi tidak ditemukan.")

    floor_id = location["floorId"] if location else job["floorId"]
    position = (
        location["labelPosition"] if location else {"x": 0.0, "y": 0.6, "z": 0.0}
    )
    edge_ids: list[str] = []
    if location and location.get("navigationNodeId"):
        node_id = location["navigationNodeId"]
        edge_ids = [
            edge["id"]
            for edge in get_graph()["edges"]
            if edge["from"] == node_id or edge["to"] == node_id
        ]

    priority = payload.priority if payload.priority in {"high", "medium", "low"} else finding["priority"]
    hazard = repository.insert_hazard(
        settings,
        {
            "floorId": floor_id,
            "type": finding["title"],
            "category": finding["category"]
            if finding["category"] in FINDING_CATEGORIES
            else "other",
            "locationName": location["name"] if location else job["areaName"],
            "position": position,
            "edgeIds": edge_ids,
            "description": finding["description"],
            "recommendation": finding["recommendation"],
            "priority": priority,
            "evidenceUrl": finding["evidenceUrl"],
            "status": "Perlu diperiksa",
            "source": "ai_scan",
            "scannedAt": wib_now_label(),
        },
    )
    repository.update_finding_status(settings, finding_id, "diterima", hazard["id"])
    repository.add_history(
        settings,
        "hazard",
        f"Temuan AI diterima: {finding['title']}",
        f"{location['name'] if location else job['areaName']} - menunggu verifikasi caregiver",
    )
    return hazard


@router.post("/{job_id}/findings/{finding_id}/dismiss")
def dismiss_finding(job_id: str, finding_id: str, settings: Settings = Depends(app_settings)):
    job = repository.get_scan_job(settings, job_id)
    finding = repository.get_finding(settings, finding_id)
    if not job or not finding or finding["jobId"] != job_id:
        raise HTTPException(status_code=404, detail="Temuan tidak ditemukan.")
    if finding["status"] == "diterima":
        raise HTTPException(status_code=409, detail="Temuan sudah diterima sebagai hambatan.")
    repository.update_finding_status(settings, finding_id, "diabaikan")
    return {"status": "ok", "id": finding_id}
