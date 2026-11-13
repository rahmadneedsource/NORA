"""Navigation graph search (A*) and route enrichment."""

from __future__ import annotations

import heapq
import math
from functools import lru_cache

from ..seed_data import load_graph


@lru_cache(maxsize=1)
def get_graph() -> dict:
    graph = load_graph()
    node_ids = {node["id"] for node in graph["nodes"]}
    for edge in graph["edges"]:
        if edge["from"] not in node_ids or edge["to"] not in node_ids:
            raise ValueError(f"Graph edge {edge['id']} references an unknown node")
    return graph


def _distance(a: dict, b: dict) -> float:
    return math.hypot(float(b["x"]) - float(a["x"]), float(b["z"]) - float(a["z"]))


def _adjacency(graph: dict) -> dict[str, list[dict]]:
    nodes = {node["id"]: node for node in graph["nodes"]}
    adjacency: dict[str, list[dict]] = {node_id: [] for node_id in nodes}
    for edge in graph["edges"]:
        if not edge.get("walkable", True):
            continue
        a = nodes[edge["from"]]
        b = nodes[edge["to"]]
        base_cost = float(edge.get("cost", _distance(a, b)) or 0.05)
        adjacency[edge["from"]].append({"to": edge["to"], "cost": base_cost, "edge": edge})
        adjacency[edge["to"]].append({"to": edge["from"], "cost": base_cost, "edge": edge})
    return adjacency


def find_route(
    graph: dict,
    start_id: str,
    end_id: str,
    penalties: dict[str, float] | None = None,
) -> dict:
    """A* over walkable edges. Returns graph node/edge dicts, never DB rows."""
    nodes = {node["id"]: node for node in graph["nodes"]}
    if start_id not in nodes or end_id not in nodes:
        return {"status": "missing_node", "nodes": [], "edges": [], "distance": 0.0}

    if start_id == end_id:
        return {
            "status": "same_location",
            "nodes": [nodes[start_id]],
            "edges": [],
            "distance": 0.0,
        }

    adjacency = _adjacency(graph)
    penalties = penalties or {}
    start = nodes[start_id]
    end = nodes[end_id]

    g_score = {node_id: math.inf for node_id in nodes}
    g_score[start_id] = 0.0
    came_from: dict[str, tuple[str, dict]] = {}
    heap = [(math.hypot(end["x"] - start["x"], end["z"] - start["z"]), 0, start_id)]
    visited: set[str] = set()
    counter = 0

    while heap:
        _, _, current = heapq.heappop(heap)
        if current in visited:
            continue
        visited.add(current)
        if current == end_id:
            break
        for neighbour in adjacency[current]:
            edge = neighbour["edge"]
            extra = penalties.get(edge["id"], 0.0)
            tentative = g_score[current] + neighbour["cost"] + extra
            if tentative < g_score[neighbour["to"]]:
                g_score[neighbour["to"]] = tentative
                came_from[neighbour["to"]] = (current, edge)
                target = nodes[neighbour["to"]]
                heuristic = math.hypot(end["x"] - target["x"], end["z"] - target["z"])
                counter += 1
                heapq.heappush(heap, (tentative + heuristic, counter, neighbour["to"]))

    if end_id not in came_from and end_id != start_id:
        return {"status": "no_path", "nodes": [], "edges": [], "distance": 0.0}

    path_nodes = [nodes[end_id]]
    path_edges: list[dict] = []
    cursor = end_id
    while cursor != start_id:
        previous, edge = came_from[cursor]
        path_edges.insert(0, edge)
        path_nodes.insert(0, nodes[previous])
        cursor = previous

    return {
        "status": "ok",
        "nodes": path_nodes,
        "edges": path_edges,
        "distance": round(g_score[end_id], 2),
    }


def _active_hazards(hazards: list[dict]) -> list[dict]:
    ignored = {"Sudah ditangani", "Tidak relevan"}
    return [hazard for hazard in hazards if hazard.get("status") not in ignored]


def route_between_locations(
    graph: dict,
    origin: dict | None,
    destination: dict | None,
    hazards: list[dict],
) -> dict:
    if not origin or not destination:
        return {
            "status": "missing_location",
            "message": "Lokasi awal atau tujuan tidak ditemukan.",
            "nodes": [],
            "edges": [],
            "hazardsOnRoute": [],
        }

    if origin["id"] == destination["id"]:
        return {
            "status": "same_location",
            "message": f"Anda sudah berada di {destination['name']}. Pilih tujuan lain.",
            "nodes": [],
            "edges": [],
            "hazardsOnRoute": [],
        }

    if not origin.get("navigationNodeId") or not destination.get("navigationNodeId"):
        missing = destination if not destination.get("navigationNodeId") else origin
        return {
            "status": "disconnected",
            "message": f'"{missing["name"]}" belum terhubung ke titik lantai yang dapat dilalui.',
            "nodes": [],
            "edges": [],
            "hazardsOnRoute": [],
        }

    result = find_route(graph, origin["navigationNodeId"], destination["navigationNodeId"])
    if result["status"] != "ok":
        return {
            "status": result["status"],
            "message": "Tidak ditemukan jalur yang dapat dilalui antar kedua lokasi.",
            "nodes": [],
            "edges": [],
            "hazardsOnRoute": [],
        }

    edge_ids = {edge["id"] for edge in result["edges"]}
    hazards_on_route = [
        hazard for hazard in _active_hazards(hazards) if set(hazard.get("edgeIds", [])) & edge_ids
    ]
    cross_floor = len({node["floorId"] for node in result["nodes"]}) > 1

    alternative = None
    if hazards_on_route:
        penalties = {}
        for hazard in hazards_on_route:
            weight = 60.0 if hazard.get("priority") == "high" else 25.0
            for edge_id in hazard.get("edgeIds", []):
                penalties[edge_id] = penalties.get(edge_id, 0.0) + weight
        candidate = find_route(
            graph,
            origin["navigationNodeId"],
            destination["navigationNodeId"],
            penalties=penalties,
        )
        if (
            candidate["status"] == "ok"
            and {edge["id"] for edge in candidate["edges"]} != edge_ids
        ):
            alternative = {
                "edges": candidate["edges"],
                "nodes": candidate["nodes"],
                "distance": candidate["distance"],
                "note": "Kandidat jalur alternatif. Wajib diverifikasi caregiver sebelum digunakan.",
            }

    if cross_floor:
        message = (
            f"Rute antar-lantai via tangga - {len(result['edges'])} segmen menuju "
            f"{destination['name']}."
        )
    else:
        message = f"Jalur tersedia - {len(result['edges'])} segmen menuju {destination['name']}."

    return {
        "status": "ok",
        "message": message,
        "nodes": result["nodes"],
        "edges": result["edges"],
        "distance": result["distance"],
        "crossFloor": cross_floor,
        "hazardsOnRoute": hazards_on_route,
        "alternative": alternative,
    }
