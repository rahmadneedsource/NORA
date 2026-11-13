"""Scan job pipeline: frames -> quality -> optional AI analysis -> ready."""

from __future__ import annotations

import copy
import json
import logging
import traceback
from datetime import datetime, timezone
from pathlib import Path

from .. import repository
from ..config import Settings
from ..content import FLOOR_LABELS
from .frames import FrameExtractionError, extract_frames
from .quality import analyze_frames
from .storage import MediaError, detect_kind
from .vision import analyze as analyze_hazards

logger = logging.getLogger("nora.pipeline")

STAGE_TEMPLATE = [
    {"key": "upload", "label": "Media diunggah", "status": "pending", "detail": None},
    {"key": "frames", "label": "Ekstraksi frame", "status": "pending", "detail": None},
    {
        "key": "quality",
        "label": "Pemeriksaan kualitas & tumpang tindih",
        "status": "pending",
        "detail": None,
    },
    {"key": "analysis", "label": "Analisis potensi hambatan", "status": "pending", "detail": None},
    {"key": "ready", "label": "Siap ditinjau", "status": "pending", "detail": None},
]


def new_stages() -> list[dict]:
    stages = copy.deepcopy(STAGE_TEMPLATE)
    stages[0]["status"] = "done"
    stages[0]["detail"] = "File diterima dan disimpan di server."
    return stages


def _set_stage(
    settings: Settings, job: dict, key: str, status: str, detail: str | None = None
) -> None:
    for stage in job["stages"]:
        if stage["key"] == key:
            stage["status"] = status
            if detail is not None:
                stage["detail"] = detail
            break
    repository.update_scan_job(
        settings,
        job["id"],
        {
            "stages_json": json.dumps(job["stages"], ensure_ascii=False),
            "stage": key,
        },
    )


def _completed_at() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def run_pipeline(settings: Settings, job_id: str) -> None:
    job = repository.get_scan_job(settings, job_id)
    if job is None:
        return

    current_stage = "frames"
    try:
        repository.update_scan_job(settings, job_id, {"status": "running", "stage": "frames"})

        raw_dir = settings.scans_upload_dir / job_id / "raw"
        inputs = sorted(path for path in raw_dir.glob("*") if path.is_file())
        if not inputs:
            raise FrameExtractionError("File media tidak ditemukan di server.")

        _set_stage(settings, job, "frames", "running", "Mengekstrak frame dari media...")
        kinds = []
        usable_inputs: list[Path] = []
        skipped: list[str] = []
        for path in inputs:
            try:
                kinds.append(detect_kind(path, settings))
                usable_inputs.append(path)
            except MediaError as exc:
                skipped.append(f"{path.name}: {exc}")
        if not usable_inputs:
            raise FrameExtractionError("Tidak ada file media yang valid. " + " ".join(skipped))

        extracted = extract_frames(settings, job_id, usable_inputs, kinds)
        frames: list[dict] = []
        for item in extracted:
            url = item["path"]
            local_path = settings.media_dir / url.removeprefix("/media/")
            saved = repository.insert_frame(
                settings,
                job_id,
                {
                    "filename": item["filename"],
                    "path": url,
                    "thumbPath": item["thumbPath"],
                    "timestampS": item["timestampS"],
                    "width": item["width"],
                    "height": item["height"],
                },
            )
            saved["localPath"] = str(local_path)
            frames.append(saved)
        detail = f"{len(frames)} frame diekstrak."
        if skipped:
            detail += f" {len(skipped)} file dilewati."
        _set_stage(settings, job, "frames", "done", detail)

        current_stage = "quality"
        _set_stage(
            settings, job, "quality", "running", "Menghitung kualitas dan tumpang tindih frame..."
        )
        quality = analyze_frames(frames)
        for metric in quality["frames"]:
            frame = frames[metric["index"]]
            repository.update_frame_metrics(settings, frame["id"], metric)
            frame["flags"] = metric["flags"]
            frame["usable"] = metric["usable"]
            frame["brightness"] = metric["brightness"]
            frame["blurScore"] = metric["blurScore"]
        quality_detail = f"{quality['usableFrames']} frame layak dari {quality['frameCount']}."
        if quality.get("coverageScore") is not None:
            quality_detail += f" Cakupan tumpang tindih {int(quality['coverageScore'] * 100)}%."
        _set_stage(settings, job, "quality", "done", quality_detail)

        current_stage = "analysis"
        _set_stage(
            settings,
            job,
            "analysis",
            "running",
            "Menganalisis potensi hambatan..."
            if settings.ai_configured
            else "AI vision nonaktif; melewati analisis bahaya.",
        )
        analysis = analyze_hazards(
            settings,
            frames,
            job["areaName"],
            FLOOR_LABELS.get(job["floorId"], job["floorId"]),
        )
        for finding in analysis["findings"]:
            repository.insert_finding(settings, job_id, finding)

        if analysis["mode"] == "ai":
            analysis_detail = f"{len(analysis['findings'])} temuan AI untuk ditinjau caregiver."
        elif analysis["mode"] == "degraded":
            analysis_detail = "Analisis AI gagal; tidak ada temuan yang dibuat."
        else:
            analysis_detail = "AI vision tidak aktif; hanya pemeriksaan kualitas frame."
        _set_stage(settings, job, "analysis", "done", analysis_detail)

        current_stage = "ready"
        result = {
            "frameCount": len(frames),
            "quality": {
                "usableFrames": quality["usableFrames"],
                "brightnessAvg": quality["brightnessAvg"],
                "blurAvg": quality["blurAvg"],
                "coverageScore": quality["coverageScore"],
                "warnings": quality["warnings"],
                "matchedPairs": quality["matchedPairs"],
                "note": quality["note"],
            },
            "analysis": {
                "mode": analysis["mode"],
                "provider": analysis["provider"],
                "model": analysis["model"],
                "summary": analysis["summary"],
                "limitations": analysis["limitations"],
                "usage": analysis["usage"],
                "latencyMs": analysis["latencyMs"],
                "error": analysis.get("error"),
            },
            "skippedFiles": skipped,
        }
        _set_stage(settings, job, "ready", "done", "Hasil siap ditinjau.")
        repository.update_scan_job(
            settings,
            job_id,
            {
                "status": "ready",
                "stage": "ready",
                "result_json": json.dumps(result, ensure_ascii=False),
                "completed_at": _completed_at(),
                "error": None,
            },
        )
        repository.add_history(
            settings,
            "scan",
            f"Pemindaian Selesai: {job['areaName']}",
            f"{len(frames)} frame, {len(analysis['findings'])} temuan, mode {analysis['mode']}.",
        )

    except Exception as exc:  # noqa: BLE001 - the job must record any failure
        logger.error("Scan job %s failed: %s\n%s", job_id, exc, traceback.format_exc())
        job = repository.get_scan_job(settings, job_id) or job
        _set_stage(settings, job, current_stage, "failed", str(exc)[:400])
        repository.update_scan_job(
            settings,
            job_id,
            {
                "status": "failed",
                "stage": current_stage,
                "error": str(exc)[:400],
                "completed_at": _completed_at(),
            },
        )
        repository.add_history(
            settings,
            "scan",
            f"Pemindaian Gagal: {job.get('areaName', 'Area')}",
            str(exc)[:220],
        )
