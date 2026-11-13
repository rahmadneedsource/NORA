"""API contract tests: system, locations, hazards, history, navigation."""

from __future__ import annotations

from tests.conftest import make_image


def test_health_reports_database_and_ai_mode(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["database"] == "ok"
    assert payload["ai"]["configured"] is False
    assert payload["ai"]["mode"] == "quality_only"


def test_bootstrap_exposes_seed_state_and_graph(client):
    response = client.get("/api/bootstrap")

    assert response.status_code == 200
    payload = response.json()
    assert payload["home"]["name"]
    assert len(payload["locations"]) == 7
    assert len(payload["hazards"]) == 2
    assert len(payload["graph"]["nodes"]) == 17
    assert len(payload["graph"]["edges"]) == 16
    edge_ids = {edge["id"] for edge in payload["graph"]["edges"]}
    assert "e12" in edge_ids
    assert payload["categories"]["bedroom"] == "Kamar Tidur"
    assert "bed" in payload["icons"]


def test_route_same_floor_reports_active_hazards(client):
    response = client.post(
        "/api/navigation/route",
        json={
            "originLocationId": "loc_bedroom_main",
            "destinationLocationId": "loc_toilet_main",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert len(payload["edges"]) == 5
    assert payload["crossFloor"] is False
    assert len(payload["hazardsOnRoute"]) == 2


def test_route_cross_floor_uses_stair_edge(client):
    response = client.post(
        "/api/navigation/route",
        json={
            "originLocationId": "loc_bedroom_main",
            "destinationLocationId": "loc_guest_f2",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["crossFloor"] is True
    assert [edge["id"] for edge in payload["edges"]] == [
        "e1",
        "e2",
        "e3",
        "e11",
        "e12",
        "e20",
        "e21",
        "e22",
    ]


def test_route_unknown_location_is_reported_not_crashed(client):
    response = client.post(
        "/api/navigation/route",
        json={"originLocationId": "missing", "destinationLocationId": "loc_toilet_main"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "missing_location"


def test_location_create_update_and_delete(client):
    created = client.post(
        "/api/locations",
        json={
            "name": "Kamar Uji",
            "category": "bedroom",
            "floorId": "floor-1",
            "iconKey": "bed",
            "labelPosition": {"x": 1.2, "y": 1.4, "z": 3.1},
            "navigationNodeId": "n1_hall_south",
        },
    )

    assert created.status_code == 201, created.text
    location = created.json()
    assert location["id"].startswith("loc_")
    assert location["verificationStatus"] == "verified"
    assert location["labelPosition"] == {"x": 1.2, "y": 1.4, "z": 3.1}

    updated = client.patch(
        f"/api/locations/{location['id']}",
        json={"name": "Kamar Uji Edit", "navigationNodeId": None},
    )

    assert updated.status_code == 200
    assert updated.json()["name"] == "Kamar Uji Edit"
    assert updated.json()["navigationNodeId"] is None
    assert updated.json()["verificationStatus"] == "needs_path"

    deleted = client.delete(f"/api/locations/{location['id']}")

    assert deleted.status_code == 200
    assert deleted.json()["status"] == "ok"
    assert client.get(f"/api/locations/{location['id']}").status_code == 404


def test_location_validation_rejects_wrong_floor_and_unknown_category(client):
    wrong_floor = client.post(
        "/api/locations",
        json={
            "name": "Salah Lantai",
            "category": "bedroom",
            "floorId": "floor-2",
            "navigationNodeId": "n1_hall_south",
        },
    )
    unknown_category = client.post(
        "/api/locations",
        json={"name": "Kategori Aneh", "category": "spaceship", "floorId": "floor-1"},
    )
    unknown_icon = client.post(
        "/api/locations",
        json={
            "name": "Ikon Aneh",
            "category": "bedroom",
            "floorId": "floor-1",
            "iconKey": "not-a-real-icon",
        },
    )

    assert wrong_floor.status_code == 422
    assert unknown_category.status_code == 422
    assert unknown_icon.status_code == 422


def test_moving_floor_requires_a_matching_access_node(client):
    location = client.post(
        "/api/locations",
        json={
            "name": "Kamar Pindah",
            "category": "bedroom",
            "floorId": "floor-1",
            "navigationNodeId": "n1_bed_access",
        },
    ).json()

    invalid = client.patch(
        f"/api/locations/{location['id']}", json={"floorId": "floor-2"}
    )
    valid = client.patch(
        f"/api/locations/{location['id']}",
        json={"floorId": "floor-2", "navigationNodeId": "n2_guest_access"},
    )

    assert invalid.status_code == 422
    assert valid.status_code == 200
    assert valid.json()["floorId"] == "floor-2"
    assert valid.json()["navigationNodeId"] == "n2_guest_access"


def test_location_without_node_is_saved_as_needs_path(client):
    response = client.post(
        "/api/locations",
        json={"name": "Gudang Belum Terhubung", "category": "other", "floorId": "floor-1"},
    )

    assert response.status_code == 201
    assert response.json()["verificationStatus"] == "needs_path"
    assert response.json()["iconKey"] == "map-pin"


def test_photo_upload_attach_serve_and_remove(client):
    uploaded = client.post(
        "/api/uploads/photo",
        files={"file": ("foto.jpg", make_image(4), "image/jpeg")},
    )

    assert uploaded.status_code == 200, uploaded.text
    photo = uploaded.json()
    assert photo["url"].startswith("/media/photos/")
    assert photo["width"] > 0 and photo["height"] > 0
    assert client.get(photo["url"]).status_code == 200

    created = client.post(
        "/api/locations",
        json={
            "name": "Kamar Berfoto",
            "category": "bedroom",
            "floorId": "floor-1",
            "navigationNodeId": "n1_hall_south",
            "photo": photo["url"],
        },
    ).json()
    assert created["photo"] == photo["url"]

    removed = client.delete(f"/api/locations/{created['id']}/photo")

    assert removed.status_code == 200
    assert removed.json()["photo"] is None


def test_photo_upload_rejects_non_image(client):
    response = client.post(
        "/api/uploads/photo",
        files={"file": ("catatan.txt", b"bukan gambar", "text/plain")},
    )

    assert response.status_code == 400


def test_deleting_location_removes_its_photo(client):
    photo = client.post(
        "/api/uploads/photo",
        files={"file": ("foto.jpg", make_image(6), "image/jpeg")},
    ).json()
    location = client.post(
        "/api/locations",
        json={
            "name": "Kamar Sementara",
            "category": "bedroom",
            "floorId": "floor-1",
            "photo": photo["url"],
        },
    ).json()

    assert client.delete(f"/api/locations/{location['id']}").status_code == 200
    assert client.get(photo["url"]).status_code == 404


def test_hazard_create_patch_and_delete(client):
    created = client.post(
        "/api/hazards",
        json={
            "floorId": "floor-1",
            "type": "Kabel melintang",
            "category": "tripping",
            "locationName": "Lorong",
            "position": {"x": 0.4, "y": 0.2, "z": -1.1},
            "edgeIds": ["e1"],
            "priority": "high",
        },
    )

    assert created.status_code == 201, created.text
    hazard = created.json()
    assert hazard["floorId"] == "floor-1"
    assert hazard["edgeIds"] == ["e1"]
    assert hazard["priority"] == "high"
    assert hazard["status"] == "Perlu diperiksa"

    patched = client.patch(
        f"/api/hazards/{hazard['id']}", json={"status": "Sudah ditangani"}
    )

    assert patched.status_code == 200
    assert patched.json()["status"] == "Sudah ditangani"

    assert client.delete(f"/api/hazards/{hazard['id']}").status_code == 200
    assert client.get(f"/api/hazards/{hazard['id']}").status_code == 404


def test_hazard_rejects_unknown_edge_and_priority(client):
    bad_edge = client.post(
        "/api/hazards",
        json={
            "floorId": "floor-1",
            "type": "Uji",
            "category": "tripping",
            "edgeIds": ["e999"],
        },
    )
    bad_priority = client.post(
        "/api/hazards",
        json={
            "floorId": "floor-1",
            "type": "Uji",
            "category": "tripping",
            "priority": "urgent",
        },
    )
    bad_status = client.patch(
        "/api/hazards/haz_missing", json={"status": "status-tidak-ada"}
    )

    assert bad_edge.status_code == 422
    assert bad_priority.status_code == 422
    assert bad_status.status_code == 422


def test_history_create_list_and_clear(client):
    created = client.post(
        "/api/history",
        json={"type": "route", "title": "Rute dicari", "detail": "Kamar ke Toilet"},
    )

    assert created.status_code == 201
    assert any(item["title"] == "Rute dicari" for item in created.json())

    listed = client.get("/api/history")
    assert listed.status_code == 200
    assert any(item["title"] == "Rute dicari" for item in listed.json())

    cleared = client.delete("/api/history")
    assert cleared.status_code == 200
    assert cleared.json()["deleted"] >= 1
    assert client.get("/api/history").json() == []


def test_history_rejects_empty_title(client):
    response = client.post("/api/history", json={"type": "route", "title": ""})

    assert response.status_code == 422


def test_demo_reset_restores_seed_state(client, settings):
    client.post(
        "/api/locations",
        json={"name": "Lokasi Sementara", "category": "other", "floorId": "floor-1"},
    )
    client.post(
        "/api/uploads/photo",
        files={"file": ("foto.jpg", make_image(7), "image/jpeg")},
    )
    assert any(settings.photos_dir.iterdir())
    assert len(client.get("/api/locations").json()) == 8

    reset = client.post("/api/demo/reset")

    assert reset.status_code == 200
    bootstrap = client.get("/api/bootstrap").json()
    assert len(bootstrap["locations"]) == 7
    assert len(bootstrap["hazards"]) == 2
    assert client.get("/api/scans").json() == []
    assert list(settings.photos_dir.iterdir()) == []
