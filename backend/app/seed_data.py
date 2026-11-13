"""Seed data for the demo household.

The 3D scene in the frontend is a prebuilt demo twin; this data mirrors its
floor plan so navigation and hazard markers stay consistent. No claim is made
that the twin was reconstructed live from video.
"""

from __future__ import annotations

import json
from pathlib import Path

SEED_DIR = Path(__file__).resolve().parent / "seed"

SEED_TIMESTAMP = "2026-11-12T08:00:00+00:00"
SEED_SCAN_LABEL = "13 Nov 2026, 09:15 WIB"


def load_graph() -> dict:
    return json.loads((SEED_DIR / "graph.json").read_text(encoding="utf-8"))


INITIAL_LOCATIONS = [
    {
        "id": "loc_bedroom_main",
        "homeId": "home_demo_1",
        "floorId": "floor-1",
        "name": "Kamar Tidur",
        "category": "bedroom",
        "iconKey": "bed",
        "labelPosition": {"x": -4.2, "y": 1.4, "z": 2.2},
        "navigationNodeId": "n1_bed_access",
        "photo": None,
        "verificationStatus": "verified",
    },
    {
        "id": "loc_toilet_main",
        "homeId": "home_demo_1",
        "floorId": "floor-1",
        "name": "Toilet",
        "category": "bathroom",
        "iconKey": "bath",
        "labelPosition": {"x": 0.8, "y": 1.5, "z": -6.2},
        "navigationNodeId": "n1_toilet_access",
        "photo": None,
        "verificationStatus": "verified",
    },
    {
        "id": "loc_living_main",
        "homeId": "home_demo_1",
        "floorId": "floor-1",
        "name": "Ruang Tamu",
        "category": "living",
        "iconKey": "sofa",
        "labelPosition": {"x": 4.8, "y": 1.4, "z": 2.2},
        "navigationNodeId": "n1_living_access",
        "photo": None,
        "verificationStatus": "verified",
    },
    {
        "id": "loc_kitchen_main",
        "homeId": "home_demo_1",
        "floorId": "floor-1",
        "name": "Dapur",
        "category": "kitchen",
        "iconKey": "cooking-pot",
        "labelPosition": {"x": 4.8, "y": 1.4, "z": -4.2},
        "navigationNodeId": "n1_kitchen_access",
        "photo": None,
        "verificationStatus": "verified",
    },
    {
        "id": "loc_entrance_main",
        "homeId": "home_demo_1",
        "floorId": "floor-1",
        "name": "Pintu Masuk",
        "category": "entrance",
        "iconKey": "door-open",
        "labelPosition": {"x": 0.1, "y": 1.4, "z": 5.8},
        "navigationNodeId": "n1_entrance",
        "photo": None,
        "verificationStatus": "verified",
    },
    {
        "id": "loc_lounge_f2",
        "homeId": "home_demo_1",
        "floorId": "floor-2",
        "name": "Ruang Keluarga Atas",
        "category": "living",
        "iconKey": "sofa",
        "labelPosition": {"x": -0.4, "y": 1.4, "z": -1.5},
        "navigationNodeId": "n2_lounge_mid",
        "photo": None,
        "verificationStatus": "verified",
    },
    {
        "id": "loc_guest_f2",
        "homeId": "home_demo_1",
        "floorId": "floor-2",
        "name": "Kamar Tamu Atas",
        "category": "bedroom",
        "iconKey": "bed",
        "labelPosition": {"x": 4.5, "y": 1.4, "z": -1.5},
        "navigationNodeId": "n2_guest_access",
        "photo": None,
        "verificationStatus": "verified",
    },
]

INITIAL_HAZARDS = [
    {
        "id": "haz_cable_1",
        "homeId": "home_demo_1",
        "floorId": "floor-1",
        "type": "Kabel melintang",
        "category": "tripping",
        "locationName": "Jalur Kamar Tidur > Pintu",
        "position": {"x": -2.0, "y": 0.35, "z": 1.7},
        "edgeIds": ["e1"],
        "description": "Kabel lampu meja terbentang di lantai dekat jalur keluar sisi tempat tidur.",
        "recommendation": "Rapikan kabel ke sepanjang dinding atau gunakan pelindung kabel datar.",
        "priority": "high",
        "evidenceUrl": None,
        "scannedAt": SEED_SCAN_LABEL,
        "status": "Perlu diperiksa",
        "source": "demo",
    },
    {
        "id": "haz_chair_2",
        "homeId": "home_demo_1",
        "floorId": "floor-1",
        "type": "Kursi menghalangi akses",
        "category": "mobility",
        "locationName": "Lorong Tengah",
        "position": {"x": 1.35, "y": 0.85, "z": -1.8},
        "edgeIds": ["e3", "e4"],
        "description": "Kursi kayu sedikit menjorok ke area lorong menuju pintu Toilet.",
        "recommendation": "Geser kursi merapat ke dinding kanan agar lebar lorong tetap lapang.",
        "priority": "medium",
        "evidenceUrl": None,
        "scannedAt": SEED_SCAN_LABEL,
        "status": "Perlu diperiksa",
        "source": "demo",
    },
]

INITIAL_HISTORY = [
    {
        "id": "hist_init_1",
        "type": "scan",
        "title": "Pemindaian Model Demo - Rumah Keluarga",
        "detail": "Lantai 1 & Lantai 2 - 2 temuan potensi hambatan dicatat (data demo)",
        "timestamp": SEED_SCAN_LABEL,
    }
]
