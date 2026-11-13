"""Navigation route API."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import repository
from ..config import Settings
from ..schemas import RouteRequest, RouteResponse
from ..services.navigation import get_graph, route_between_locations
from .system import app_settings

router = APIRouter(prefix="/api/navigation", tags=["navigation"])


@router.get("/graph")
def graph():
    return get_graph()


@router.post("/route", response_model=RouteResponse)
def route(payload: RouteRequest, settings: Settings = Depends(app_settings)):
    origin = repository.get_location(settings, payload.origin_location_id)
    destination = repository.get_location(settings, payload.destination_location_id)
    hazards = repository.list_hazards(settings)
    return route_between_locations(get_graph(), origin, destination, hazards)
