"""Data access helpers. Every function opens a short-lived SQLite connection."""

from __future__ import annotations

import json
from typing import Any

from .config import Settings
from .db import session
from .utils import iso_now, json_loads, new_id, wib_now_label

HOME_ID = "home_demo_1"


# ---------------------------------------------------------------------------
# Mapping helpers
# ---------------------------------------------------------------------------
def _location(row) -> dict:
    return {
        "id": row["id"],
        "homeId": row["home_id"],
        "floorId": row["floor_id"],
        "name": row["name"],
        "category": row["category"],
        "iconKey": row["icon_key"],
        "labelPosition": {"x": row["x"], "y": row["y"], "z": row["z"]},
        "navigationNodeId": row["navigation_node_id"],
        "photo": row["photo"],
        "verificationStatus": row["verification_status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _hazard(row) -> dict:
    return {
        "id": row["id"],
        "homeId": row["home_id"],
        "floorId": row["floor_id"],
        "type": row["type"],
        "category": row["category"],
        "locationName": row["location_name"],
        "position": {"x": row["x"], "y": row["y"], "z": row["z"]},
        "edgeIds": json_loads(row["edge_ids"], []),
        "description": row["description"],
        "recommendation": row["recommendation"],
        "priority": row["priority"],
        "evidenceUrl": row["evidence_url"],
        "status": row["status"],
        "source": row["source"],
        "scannedAt": row["scanned_at"],
        "createdAt": row["created_at"],
    }


def _frame(row) -> dict:
    return {
        "id": row["id"],
        "jobId": row["job_id"],
        "filename": row["filename"],
        "path": row["path"],
        "thumbPath": row["thumb_path"],
        "timestampS": row["timestamp_s"],
        "width": row["width"],
        "height": row["height"],
        "brightness": row["brightness"],
        "blurScore": row["blur_score"],
        "usable": bool(row["usable"]),
        "flags": json_loads(row["flags_json"], []),
    }


def _finding(row) -> dict:
    return {
        "id": row["id"],
        "jobId": row["job_id"],
        "category": row["category"],
        "title": row["title"],
        "description": row["description"],
        "recommendation": row["recommendation"],
        "priority": row["priority"],
        "frameIndex": row["frame_index"],
        "frameId": row["frame_id"],
        "evidenceUrl": row["evidence_url"],
        "confidence": row["confidence"],
        "status": row["status"],
        "hazardId": row["hazard_id"],
        "createdAt": row["created_at"],
    }


def _job(row) -> dict:
    return {
        "id": row["id"],
        "homeId": row["home_id"],
        "areaName": row["area_name"],
        "floorId": row["floor_id"],
        "status": row["status"],
        "stage": row["stage"],
        "stages": json_loads(row["stages_json"], []),
        "error": row["error"],
        "aiMode": row["ai_mode"],
        "result": json_loads(row["result_json"], None),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "completedAt": row["completed_at"],
    }


# ---------------------------------------------------------------------------
# Home & locations
# ---------------------------------------------------------------------------
def get_home(settings: Settings) -> dict | None:
    with session(settings) as conn:
        row = conn.execute("SELECT * FROM homes LIMIT 1").fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "name": row["name"],
            "address": row["address"],
            "createdAt": row["created_at"],
        }


def list_locations(settings: Settings) -> list[dict]:
    with session(settings) as conn:
        rows = conn.execute(
            "SELECT * FROM locations ORDER BY floor_id, name COLLATE NOCASE"
        ).fetchall()
        return [_location(row) for row in rows]


def get_location(settings: Settings, location_id: str) -> dict | None:
    with session(settings) as conn:
        row = conn.execute("SELECT * FROM locations WHERE id = ?", (location_id,)).fetchone()
        return _location(row) if row else None


def insert_location(settings: Settings, data: dict) -> dict:
    now = iso_now()
    location_id = data.get("id") or new_id("loc")
    with session(settings) as conn:
        conn.execute(
            """
            INSERT INTO locations
            (id, home_id, floor_id, name, category, icon_key, x, y, z,
             navigation_node_id, photo, verification_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                location_id,
                data.get("homeId", HOME_ID),
                data["floorId"],
                data["name"],
                data["category"],
                data.get("iconKey"),
                data["labelPosition"]["x"],
                data["labelPosition"]["y"],
                data["labelPosition"]["z"],
                data.get("navigationNodeId"),
                data.get("photo"),
                data.get("verificationStatus", "needs_path"),
                now,
                now,
            ),
        )
        conn.commit()
    return get_location(settings, location_id)


def update_location(settings: Settings, location_id: str, fields: dict) -> dict | None:
    allowed = {
        "floor_id",
        "name",
        "category",
        "icon_key",
        "x",
        "y",
        "z",
        "navigation_node_id",
        "photo",
        "verification_status",
    }
    updates = {key: value for key, value in fields.items() if key in allowed}
    if not updates:
        return get_location(settings, location_id)
    updates["updated_at"] = iso_now()
    columns = ", ".join(f"{key} = ?" for key in updates)
    values = list(updates.values()) + [location_id]
    with session(settings) as conn:
        cursor = conn.execute(f"UPDATE locations SET {columns} WHERE id = ?", values)
        conn.commit()
        if cursor.rowcount == 0:
            return None
    return get_location(settings, location_id)


def delete_location(settings: Settings, location_id: str) -> bool:
    with session(settings) as conn:
        cursor = conn.execute("DELETE FROM locations WHERE id = ?", (location_id,))
        conn.commit()
        return cursor.rowcount > 0


# ---------------------------------------------------------------------------
# Hazards
# ---------------------------------------------------------------------------
def list_hazards(settings: Settings, floor_id: str | None = None) -> list[dict]:
    with session(settings) as conn:
        if floor_id:
            rows = conn.execute(
                "SELECT * FROM hazards WHERE floor_id = ? ORDER BY created_at DESC", (floor_id,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM hazards ORDER BY created_at DESC").fetchall()
        return [_hazard(row) for row in rows]


def get_hazard(settings: Settings, hazard_id: str) -> dict | None:
    with session(settings) as conn:
        row = conn.execute("SELECT * FROM hazards WHERE id = ?", (hazard_id,)).fetchone()
        return _hazard(row) if row else None


def insert_hazard(settings: Settings, data: dict) -> dict:
    hazard_id = data.get("id") or new_id("haz")
    with session(settings) as conn:
        conn.execute(
            """
            INSERT INTO hazards
            (id, home_id, floor_id, type, category, location_name, x, y, z,
             edge_ids, description, recommendation, priority, evidence_url,
             status, source, scanned_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                hazard_id,
                data.get("homeId", HOME_ID),
                data["floorId"],
                data["type"],
                data.get("category", "other"),
                data.get("locationName"),
                data["position"]["x"],
                data["position"]["y"],
                data["position"]["z"],
                json.dumps(data.get("edgeIds", [])),
                data.get("description"),
                data.get("recommendation"),
                data.get("priority", "medium"),
                data.get("evidenceUrl"),
                data.get("status", "Perlu diperiksa"),
                data.get("source", "manual"),
                data.get("scannedAt") or wib_now_label(),
                iso_now(),
            ),
        )
        conn.commit()
    return get_hazard(settings, hazard_id)


def update_hazard(settings: Settings, hazard_id: str, fields: dict) -> dict | None:
    allowed = {
        "floor_id",
        "type",
        "category",
        "location_name",
        "x",
        "y",
        "z",
        "edge_ids",
        "description",
        "recommendation",
        "priority",
        "evidence_url",
        "status",
        "source",
        "scanned_at",
    }
    updates = {key: value for key, value in fields.items() if key in allowed}
    if not updates:
        return get_hazard(settings, hazard_id)
    for key in ("edge_ids",):
        if key in updates and not isinstance(updates[key], str):
            updates[key] = json.dumps(updates[key])
    columns = ", ".join(f"{key} = ?" for key in updates)
    values = list(updates.values()) + [hazard_id]
    with session(settings) as conn:
        cursor = conn.execute(f"UPDATE hazards SET {columns} WHERE id = ?", values)
        conn.commit()
        if cursor.rowcount == 0:
            return None
    return get_hazard(settings, hazard_id)


def delete_hazard(settings: Settings, hazard_id: str) -> bool:
    with session(settings) as conn:
        # A finding whose hazard was removed becomes reviewable again instead of
        # staying "accepted" forever and blocking scan deletion.
        conn.execute(
            "UPDATE scan_findings SET status = 'perlu_diperiksa', hazard_id = NULL "
            "WHERE hazard_id = ?",
            (hazard_id,),
        )
        cursor = conn.execute("DELETE FROM hazards WHERE id = ?", (hazard_id,))
        conn.commit()
        return cursor.rowcount > 0


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------
def list_history(settings: Settings, limit: int = 50) -> list[dict]:
    with session(settings) as conn:
        rows = conn.execute(
            "SELECT * FROM history ORDER BY rowid DESC LIMIT ?", (limit,)
        ).fetchall()
        return [
            {
                "id": row["id"],
                "type": row["type"],
                "title": row["title"],
                "detail": row["detail"],
                "timestamp": row["timestamp"],
            }
            for row in rows
        ]


def add_history(
    settings: Settings,
    entry_type: str,
    title: str,
    detail: str = "",
    timestamp: str | None = None,
) -> dict:
    entry = {
        "id": new_id("hist"),
        "type": entry_type,
        "title": title,
        "detail": detail,
        "timestamp": timestamp or wib_now_label(),
    }
    with session(settings) as conn:
        conn.execute(
            "INSERT INTO history (id, home_id, type, title, detail, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            (entry["id"], HOME_ID, entry_type, title, detail, entry["timestamp"]),
        )
        conn.commit()
    return entry


def clear_history(settings: Settings) -> int:
    with session(settings) as conn:
        cursor = conn.execute("DELETE FROM history")
        conn.commit()
        return cursor.rowcount


# ---------------------------------------------------------------------------
# Scan jobs
# ---------------------------------------------------------------------------
def create_scan_job(
    settings: Settings,
    area_name: str,
    floor_id: str,
    stages: list[dict],
    ai_mode: str,
    job_id: str | None = None,
) -> dict:
    job_id = job_id or new_id("scan")
    now = iso_now()
    with session(settings) as conn:
        conn.execute(
            """
            INSERT INTO scan_jobs
            (id, home_id, area_name, floor_id, status, stage, stages_json,
             error, ai_mode, result_json, created_at, updated_at, completed_at)
            VALUES (?, ?, ?, ?, 'queued', 'upload', ?, NULL, ?, NULL, ?, ?, NULL)
            """,
            (job_id, HOME_ID, area_name, floor_id, json.dumps(stages), ai_mode, now, now),
        )
        conn.commit()
    return get_scan_job(settings, job_id)


def get_scan_job(settings: Settings, job_id: str) -> dict | None:
    with session(settings) as conn:
        row = conn.execute("SELECT * FROM scan_jobs WHERE id = ?", (job_id,)).fetchone()
        return _job(row) if row else None


def list_scan_jobs(settings: Settings, limit: int = 20) -> list[dict]:
    with session(settings) as conn:
        rows = conn.execute(
            "SELECT * FROM scan_jobs ORDER BY rowid DESC LIMIT ?", (limit,)
        ).fetchall()
        jobs = []
        for row in rows:
            job = _job(row)
            job["frameCount"] = conn.execute(
                "SELECT COUNT(*) FROM scan_frames WHERE job_id = ?", (job["id"],)
            ).fetchone()[0]
            job["findingCount"] = conn.execute(
                "SELECT COUNT(*) FROM scan_findings WHERE job_id = ?", (job["id"],)
            ).fetchone()[0]
            jobs.append(job)
        return jobs


def update_scan_job(settings: Settings, job_id: str, fields: dict) -> None:
    allowed = {
        "status",
        "stage",
        "stages_json",
        "error",
        "ai_mode",
        "result_json",
        "updated_at",
        "completed_at",
    }
    updates = {key: value for key, value in fields.items() if key in allowed}
    if not updates:
        return
    updates.setdefault("updated_at", iso_now())
    columns = ", ".join(f"{key} = ?" for key in updates)
    values = list(updates.values()) + [job_id]
    with session(settings) as conn:
        conn.execute(f"UPDATE scan_jobs SET {columns} WHERE id = ?", values)
        conn.commit()


def delete_scan_job(settings: Settings, job_id: str) -> bool:
    with session(settings) as conn:
        cursor = conn.execute("DELETE FROM scan_jobs WHERE id = ?", (job_id,))
        conn.execute("DELETE FROM scan_frames WHERE job_id = ?", (job_id,))
        conn.execute("DELETE FROM scan_findings WHERE job_id = ?", (job_id,))
        conn.commit()
        return cursor.rowcount > 0


# ---------------------------------------------------------------------------
# Frames & findings
# ---------------------------------------------------------------------------
def insert_frame(settings: Settings, job_id: str, frame: dict) -> dict:
    with session(settings) as conn:
        cursor = conn.execute(
            """
            INSERT INTO scan_frames
            (job_id, filename, path, thumb_path, timestamp_s, width, height,
             brightness, blur_score, usable, flags_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                frame["filename"],
                frame["path"],
                frame.get("thumbPath"),
                frame.get("timestampS", 0.0),
                frame.get("width", 0),
                frame.get("height", 0),
                frame.get("brightness"),
                frame.get("blurScore"),
                1 if frame.get("usable", True) else 0,
                json.dumps(frame.get("flags", [])),
            ),
        )
        conn.commit()
        frame_id = cursor.lastrowid
    return get_frame(settings, frame_id)


def get_frame(settings: Settings, frame_id: int) -> dict | None:
    with session(settings) as conn:
        row = conn.execute("SELECT * FROM scan_frames WHERE id = ?", (frame_id,)).fetchone()
        return _frame(row) if row else None


def list_frames(settings: Settings, job_id: str) -> list[dict]:
    with session(settings) as conn:
        rows = conn.execute(
            "SELECT * FROM scan_frames WHERE job_id = ? ORDER BY id", (job_id,)
        ).fetchall()
        return [_frame(row) for row in rows]


def update_frame_metrics(settings: Settings, frame_id: int, metrics: dict) -> None:
    with session(settings) as conn:
        conn.execute(
            "UPDATE scan_frames SET brightness = ?, blur_score = ?, usable = ?, flags_json = ? WHERE id = ?",
            (
                metrics.get("brightness"),
                metrics.get("blurScore"),
                1 if metrics.get("usable", True) else 0,
                json.dumps(metrics.get("flags", [])),
                frame_id,
            ),
        )
        conn.commit()


def insert_finding(settings: Settings, job_id: str, finding: dict) -> dict:
    finding_id = finding.get("id") or new_id("find")
    with session(settings) as conn:
        conn.execute(
            """
            INSERT INTO scan_findings
            (id, job_id, category, title, description, recommendation, priority,
             frame_index, frame_id, evidence_url, confidence, status, hazard_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                finding_id,
                job_id,
                finding["category"],
                finding["title"],
                finding.get("description"),
                finding.get("recommendation"),
                finding.get("priority", "medium"),
                finding.get("frameIndex", 0),
                finding.get("frameId"),
                finding.get("evidenceUrl"),
                finding.get("confidence", 0.5),
                finding.get("status", "perlu_diperiksa"),
                finding.get("hazardId"),
                iso_now(),
            ),
        )
        conn.commit()
    return get_finding(settings, finding_id)


def get_finding(settings: Settings, finding_id: str) -> dict | None:
    with session(settings) as conn:
        row = conn.execute("SELECT * FROM scan_findings WHERE id = ?", (finding_id,)).fetchone()
        return _finding(row) if row else None


def list_findings(settings: Settings, job_id: str) -> list[dict]:
    with session(settings) as conn:
        rows = conn.execute(
            "SELECT * FROM scan_findings WHERE job_id = ? ORDER BY frame_index, id", (job_id,)
        ).fetchall()
        return [_finding(row) for row in rows]


def update_finding_status(
    settings: Settings, finding_id: str, status: str, hazard_id: str | None = None
) -> dict | None:
    with session(settings) as conn:
        conn.execute(
            "UPDATE scan_findings SET status = ?, hazard_id = COALESCE(?, hazard_id) WHERE id = ?",
            (status, hazard_id, finding_id),
        )
        conn.commit()
    return get_finding(settings, finding_id)
