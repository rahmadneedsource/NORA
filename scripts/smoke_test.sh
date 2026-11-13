#!/usr/bin/env bash
# Smoke test read-only terhadap server NORA yang sedang berjalan.
# Pemakaian:
#   BASE_URL=http://127.0.0.1:8000 bash scripts/smoke_test.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
export BASE_URL

python3 - <<'PY'
import json
import os
import sys
import urllib.error
import urllib.request

base = os.environ["BASE_URL"].rstrip("/")
checks = []


def request(path, method="GET", payload=None):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=20) as response:
        body = response.read()
        content_type = response.headers.get("Content-Type", "")
        if "application/json" in content_type:
            return response.status, json.loads(body)
        return response.status, body


def check(name, condition, detail=""):
    checks.append((name, bool(condition), detail))


try:
    status, html = request("/")
    check("index served", status == 200 and b"NORA" in html, status)

    for asset in (
        "vendor/tailwind.js",
        "vendor/three.min.js",
        "vendor/OrbitControls.js",
        "vendor/lucide.min.js",
        "vendor/fonts/inter.css",
        "vendor/fonts/inter-400.woff2",
    ):
        status, body = request("/" + asset)
        check(f"asset {asset}", status == 200 and len(body) > 500, f"{status} {len(body)}")

    status, health = request("/api/health")
    check("health", status == 200 and health.get("database") == "ok", health.get("status"))

    status, boot = request("/api/bootstrap")
    check("bootstrap locations", len(boot.get("locations", [])) == 7)
    check("bootstrap hazards", len(boot.get("hazards", [])) == 2)
    check("graph nodes", len(boot.get("graph", {}).get("nodes", [])) == 17)
    check("graph edges", len(boot.get("graph", {}).get("edges", [])) == 16)
    edge_ids = {edge["id"] for edge in boot.get("graph", {}).get("edges", [])}
    check("stair edge e12", "e12" in edge_ids)

    status, route = request(
        "/api/navigation/route",
        method="POST",
        payload={
            "originLocationId": "loc_bedroom_main",
            "destinationLocationId": "loc_toilet_main",
        },
    )
    check("same-floor route", route.get("status") == "ok" and len(route.get("edges", [])) == 5)
    check("route hazards", len(route.get("hazardsOnRoute", [])) == 2)

    status, cross = request(
        "/api/navigation/route",
        method="POST",
        payload={
            "originLocationId": "loc_bedroom_main",
            "destinationLocationId": "loc_guest_f2",
        },
    )
    check(
        "cross-floor route",
        cross.get("status") == "ok" and cross.get("crossFloor") is True and len(cross.get("edges", [])) == 8,
    )
except Exception as exc:  # noqa: BLE001
    print(f"FAIL  request error: {exc}")
    print("\nTidak dapat menyelesaikan smoke test.")
    sys.exit(1)

failed = [name for name, passed, _ in checks if not passed]
for name, passed, detail in checks:
    suffix = f" :: {detail}" if detail and not passed else ""
    print(("PASS  " if passed else "FAIL  ") + name + suffix)

print(f"\n{len(checks) - len(failed)}/{len(checks)} checks passed")
sys.exit(1 if failed else 0)
PY
