"""Shared domain vocabulary."""

from __future__ import annotations

CATEGORY_LABELS = {
    "bedroom": "Kamar Tidur",
    "bathroom": "Kamar Mandi / Toilet",
    "kitchen": "Dapur",
    "living": "Ruang Tamu",
    "dining": "Ruang Makan",
    "workspace": "Ruang Kerja",
    "entrance": "Pintu Masuk",
    "stairs": "Tangga",
    "garage": "Garasi",
    "garden": "Taman",
    "laundry": "Area Cuci",
    "other": "Lokasi Lainnya",
}

CATEGORY_ICONS = {
    "bedroom": "bed",
    "bathroom": "bath",
    "kitchen": "cooking-pot",
    "living": "sofa",
    "dining": "utensils",
    "workspace": "lamp-desk",
    "entrance": "door-open",
    "stairs": "footprints",
    "garage": "car",
    "garden": "trees",
    "laundry": "washing-machine",
    "other": "map-pin",
}

ICON_KEYS = {
    "bed",
    "bath",
    "cooking-pot",
    "sofa",
    "utensils",
    "lamp-desk",
    "door-open",
    "footprints",
    "car",
    "trees",
    "washing-machine",
    "map-pin",
}

FLOOR_LABELS = {"floor-1": "Lantai 1", "floor-2": "Lantai 2"}

HAZARD_STATUSES = [
    "Perlu diperiksa",
    "Dikonfirmasi",
    "Tidak relevan",
    "Sudah ditangani",
]

HAZARD_PRIORITIES = ["high", "medium", "low"]

FINDING_CATEGORIES = [
    "tripping",
    "slipping",
    "lighting",
    "mobility",
    "access",
    "other",
]

FINDING_CATEGORY_LABELS = {
    "tripping": "Risiko tersandung",
    "slipping": "Risiko terpeleset",
    "lighting": "Pencahayaan kurang",
    "mobility": "Hambatan mobilitas",
    "access": "Akses terhalang",
    "other": "Potensi hambatan lain",
}
