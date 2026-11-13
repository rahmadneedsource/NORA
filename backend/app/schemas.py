"""Pydantic request/response models.

Field names use camelCase on the wire to match the existing frontend, while
Python code uses snake_case.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .content import (
    FINDING_CATEGORIES,
    HAZARD_PRIORITIES,
    HAZARD_STATUSES,
    ICON_KEYS,
)


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class APIModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
        str_strip_whitespace=True,
    )


FloorId = Literal["floor-1", "floor-2"]


class Vec3(APIModel):
    x: float = 0.0
    y: float = 1.4
    z: float = 0.0


class HomeOut(APIModel):
    id: str
    name: str
    address: str | None = None
    created_at: str


class LocationCreate(APIModel):
    name: str = Field(min_length=1, max_length=80)
    category: str = "other"
    floor_id: FloorId
    icon_key: str | None = None
    label_position: Vec3 = Field(default_factory=Vec3)
    navigation_node_id: str | None = None
    photo: str | None = None

    @field_validator("icon_key")
    @classmethod
    def icon_must_exist(cls, value: str | None) -> str | None:
        if value is not None and value not in ICON_KEYS:
            raise ValueError("Ikon tidak dikenal")
        return value


class LocationUpdate(APIModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    category: str | None = None
    floor_id: FloorId | None = None
    icon_key: str | None = None
    label_position: Vec3 | None = None
    navigation_node_id: str | None = None
    photo: str | None = None

    @field_validator("icon_key")
    @classmethod
    def icon_must_exist(cls, value: str | None) -> str | None:
        if value is not None and value not in ICON_KEYS:
            raise ValueError("Ikon tidak dikenal")
        return value


class LocationOut(APIModel):
    id: str
    home_id: str
    floor_id: str
    name: str
    category: str
    icon_key: str | None
    label_position: Vec3
    navigation_node_id: str | None
    photo: str | None
    verification_status: str
    created_at: str
    updated_at: str


class HazardCreate(APIModel):
    floor_id: FloorId
    type: str = Field(min_length=1, max_length=120)
    category: str = "other"
    location_name: str | None = None
    position: Vec3 = Field(default_factory=Vec3)
    edge_ids: list[str] = Field(default_factory=list)
    description: str | None = None
    recommendation: str | None = None
    priority: str = "medium"
    evidence_url: str | None = None
    source: str = "manual"
    scanned_at: str | None = None

    @field_validator("priority")
    @classmethod
    def priority_valid(cls, value: str) -> str:
        if value not in HAZARD_PRIORITIES:
            raise ValueError("Prioritas harus high, medium, atau low")
        return value


class HazardUpdate(APIModel):
    status: str | None = None
    priority: str | None = None
    recommendation: str | None = None

    @field_validator("status")
    @classmethod
    def status_valid(cls, value: str | None) -> str | None:
        if value is not None and value not in HAZARD_STATUSES:
            raise ValueError("Status verifikasi tidak dikenal")
        return value

    @field_validator("priority")
    @classmethod
    def priority_valid(cls, value: str | None) -> str | None:
        if value is not None and value not in HAZARD_PRIORITIES:
            raise ValueError("Prioritas harus high, medium, atau low")
        return value


class HazardOut(APIModel):
    id: str
    home_id: str
    floor_id: str
    type: str
    category: str
    location_name: str | None
    position: Vec3
    edge_ids: list[str]
    description: str | None
    recommendation: str | None
    priority: str
    evidence_url: str | None
    status: str
    source: str
    scanned_at: str | None
    created_at: str


class HistoryOut(APIModel):
    id: str
    type: str
    title: str
    detail: str
    timestamp: str


class HistoryCreate(APIModel):
    type: str = "activity"
    title: str = Field(min_length=1, max_length=140)
    detail: str = Field(default="", max_length=400)


class GraphNode(APIModel):
    id: str
    floor_id: str
    name: str
    x: float
    z: float
    type: str


class GraphEdge(APIModel):
    id: str
    from_: str = Field(alias="from")
    to: str
    walkable: bool = True
    instruction: str = ""
    cross_floor: bool = False
    cost: float | None = None

    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class GraphOut(APIModel):
    nodes: list[dict]
    edges: list[dict]


class RouteRequest(APIModel):
    origin_location_id: str
    destination_location_id: str


class RouteResponse(APIModel):
    status: str
    message: str
    nodes: list[dict]
    edges: list[dict]
    distance: float | None = None
    cross_floor: bool = False
    hazards_on_route: list[dict] = Field(default_factory=list)
    alternative: dict | None = None


class AIStatus(APIModel):
    configured: bool
    provider: str
    model: str | None
    mode: str
    reason: str


class StageOut(APIModel):
    key: str
    label: str
    status: str
    detail: str | None = None


class FrameOut(APIModel):
    id: int
    job_id: str
    filename: str
    path: str
    thumb_path: str | None
    timestamp_s: float
    width: int
    height: int
    brightness: float | None
    blur_score: float | None
    usable: bool
    flags: list[str]


class FindingOut(APIModel):
    id: str
    job_id: str
    category: str
    title: str
    description: str | None
    recommendation: str | None
    priority: str
    frame_index: int
    frame_id: int | None
    evidence_url: str | None
    confidence: float
    status: str
    created_at: str


class ScanJobOut(APIModel):
    id: str
    home_id: str
    area_name: str
    floor_id: str
    status: str
    stage: str
    stages: list[dict]
    error: str | None
    ai_mode: str
    result: dict | None
    created_at: str
    updated_at: str
    completed_at: str | None
    frames: list[dict] = Field(default_factory=list)
    findings: list[dict] = Field(default_factory=list)


class ScanJobSummary(APIModel):
    id: str
    area_name: str
    floor_id: str
    status: str
    stage: str
    ai_mode: str
    created_at: str
    completed_at: str | None
    frame_count: int = 0
    finding_count: int = 0


class FindingAcceptRequest(APIModel):
    location_id: str | None = None
    priority: str | None = None


class PhotoOut(APIModel):
    url: str
    width: int
    height: int


class BootstrapOut(APIModel):
    home: dict | None
    locations: list[dict]
    hazards: list[dict]
    history: list[dict]
    graph: dict
    floors: list[dict]
    categories: dict
    icons: list[str]
    ai: AIStatus
    version: str


class HealthOut(APIModel):
    status: str
    version: str
    database: str
    ai: AIStatus
