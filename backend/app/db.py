"""SQLite connection, schema, and seed bootstrap."""

from __future__ import annotations

import shutil
import sqlite3
from contextlib import contextmanager

from . import seed_data
from .config import Settings

SCHEMA = """
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS homes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL,
    floor_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    icon_key TEXT,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL,
    navigation_node_id TEXT,
    photo TEXT,
    verification_status TEXT NOT NULL DEFAULT 'needs_path',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_locations_home ON locations(home_id);
CREATE INDEX IF NOT EXISTS idx_locations_floor ON locations(floor_id);

CREATE TABLE IF NOT EXISTS hazards (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL,
    floor_id TEXT NOT NULL,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    location_name TEXT,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL,
    edge_ids TEXT NOT NULL DEFAULT '[]',
    description TEXT,
    recommendation TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    evidence_url TEXT,
    status TEXT NOT NULL DEFAULT 'Perlu diperiksa',
    source TEXT NOT NULL DEFAULT 'manual',
    scanned_at TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hazards_home ON hazards(home_id);
CREATE INDEX IF NOT EXISTS idx_hazards_floor ON hazards(floor_id);

CREATE TABLE IF NOT EXISTS scan_jobs (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL,
    area_name TEXT NOT NULL,
    floor_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    stage TEXT NOT NULL DEFAULT 'upload',
    stages_json TEXT NOT NULL,
    error TEXT,
    ai_mode TEXT NOT NULL DEFAULT 'quality_only',
    result_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_created ON scan_jobs(created_at DESC);

CREATE TABLE IF NOT EXISTS scan_frames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    thumb_path TEXT,
    timestamp_s REAL NOT NULL DEFAULT 0,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    brightness REAL,
    blur_score REAL,
    usable INTEGER NOT NULL DEFAULT 1,
    flags_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_scan_frames_job ON scan_frames(job_id);

CREATE TABLE IF NOT EXISTS scan_findings (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    recommendation TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    frame_index INTEGER NOT NULL DEFAULT 0,
    frame_id INTEGER,
    evidence_url TEXT,
    confidence REAL NOT NULL DEFAULT 0.5,
    status TEXT NOT NULL DEFAULT 'perlu_diperiksa',
    hazard_id TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scan_findings_job ON scan_findings(job_id);

CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_time ON history(timestamp DESC);
"""


def connect(settings: Settings) -> sqlite3.Connection:
    conn = sqlite3.connect(settings.db_path, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def session(settings: Settings):
    conn = connect(settings)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(settings: Settings) -> None:
    settings.ensure_dirs()
    with session(settings) as conn:
        conn.executescript(SCHEMA)
        home = conn.execute("SELECT id FROM homes LIMIT 1").fetchone()
        if home is None:
            _seed(conn)
        conn.commit()


def _seed(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO homes (id, name, address, created_at) VALUES (?, ?, ?, ?)",
        (
            "home_demo_1",
            "Rumah Keluarga",
            "Model demo - bukan hasil rekonstruksi langsung",
            seed_data.SEED_TIMESTAMP,
        ),
    )
    for loc in seed_data.INITIAL_LOCATIONS:
        conn.execute(
            """
            INSERT INTO locations
            (id, home_id, floor_id, name, category, icon_key, x, y, z,
             navigation_node_id, photo, verification_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                loc["id"],
                loc["homeId"],
                loc["floorId"],
                loc["name"],
                loc["category"],
                loc["iconKey"],
                loc["labelPosition"]["x"],
                loc["labelPosition"]["y"],
                loc["labelPosition"]["z"],
                loc["navigationNodeId"],
                loc["photo"],
                loc["verificationStatus"],
                seed_data.SEED_TIMESTAMP,
                seed_data.SEED_TIMESTAMP,
            ),
        )
    for haz in seed_data.INITIAL_HAZARDS:
        conn.execute(
            """
            INSERT INTO hazards
            (id, home_id, floor_id, type, category, location_name, x, y, z,
             edge_ids, description, recommendation, priority, evidence_url,
             status, source, scanned_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                haz["id"],
                haz["homeId"],
                haz["floorId"],
                haz["type"],
                haz["category"],
                haz["locationName"],
                haz["position"]["x"],
                haz["position"]["y"],
                haz["position"]["z"],
                __import__("json").dumps(haz["edgeIds"]),
                haz["description"],
                haz["recommendation"],
                haz["priority"],
                haz["evidenceUrl"],
                haz["status"],
                haz["source"],
                haz["scannedAt"],
                seed_data.SEED_TIMESTAMP,
            ),
        )
    for entry in seed_data.INITIAL_HISTORY:
        conn.execute(
            "INSERT INTO history (id, home_id, type, title, detail, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            (
                entry["id"],
                "home_demo_1",
                entry["type"],
                entry["title"],
                entry["detail"],
                entry["timestamp"],
            ),
        )


def reset_demo_data(settings: Settings) -> None:
    """Clear user data, generated media, and restore the seeded demo household."""
    with session(settings) as conn:
        for table in (
            "scan_findings",
            "scan_frames",
            "scan_jobs",
            "hazards",
            "locations",
            "history",
            "homes",
        ):
            conn.execute(f"DELETE FROM {table}")
        _seed(conn)
        conn.commit()

    # Database rows and media must not drift apart after a demo reset.
    for directory in (
        settings.scans_media_dir,
        settings.scans_upload_dir,
        settings.photos_dir,
    ):
        shutil.rmtree(directory, ignore_errors=True)
        directory.mkdir(parents=True, exist_ok=True)
