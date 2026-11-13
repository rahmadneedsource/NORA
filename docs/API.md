# API NORA

Base URL lokal: `http://127.0.0.1:8000`

Semua endpoint aplikasi berada di bawah `/api`. Dokumentasi interaktif
OpenAPI tersedia di `/api/docs`; spesifikasi mentah di `/api/openapi.json`.

- Request dan response JSON memakai **camelCase**.
- Error validasi memakai format FastAPI: `{"detail": ...}`.
- Tidak ada autentikasi pada MVP. Lindungi deployment publik di level reverse
  proxy.
- Status yang memakai bahasa Indonesia adalah nilai data, bukan HTTP status:
  - hambatan: `Perlu diperiksa`, `Sudah ditangani`, `Tidak relevan`
  - finding: `perlu_diperiksa`, `diterima`, `diabaikan`

---

## 1. System

### `GET /api/health`

```json
{
  "status": "ok",
  "version": "1.0.0",
  "database": "ok",
  "ai": {
    "configured": false,
    "provider": "none",
    "model": null,
    "mode": "quality_only",
    "reason": "AI vision dinonaktifkan. Pemindaian hanya memeriksa kualitas frame."
  }
}
```

### `GET /api/bootstrap`

Mengembalikan seluruh state awal yang dibutuhkan frontend: rumah, lokasi,
hambatan, riwayat, graph, daftar lantai, kategori, ikon, status AI, dan versi.

### `GET /api/ai/status`

Hanya objek status AI (sama dengan field `ai` di health).

### `POST /api/demo/reset`

Mengembalikan lokasi, hambatan, riwayat, dan scan ke data seed. File media
hasil scan dihapus.

```json
{ "status": "ok", "message": "Data demo dikembalikan ke awal." }
```

---

## 2. Navigasi

### `GET /api/navigation/graph`

```json
{
  "nodes": [
    { "id": "n1_bed_access", "floorId": "floor-1", "name": "Sisi Kasur Kamar Tidur", "x": -2.4, "z": 2.2, "type": "room_access" }
  ],
  "edges": [
    { "id": "e12", "from": "n1_stairs_base", "to": "n2_stairs_top", "walkable": true, "crossFloor": true, "cost": 2.5, "instruction": "Naiki tangga..." }
  ]
}
```

### `POST /api/navigation/route`

Request:

```json
{
  "originLocationId": "loc_bedroom_main",
  "destinationLocationId": "loc_guest_f2"
}
```

Response sukses:

```json
{
  "status": "ok",
  "message": "Rute antar-lantai via tangga - 8 segmen menuju Kamar Tamu Atas.",
  "nodes": [{ "id": "n1_bed_access", "floorId": "floor-1", "x": -2.4, "z": 2.2 }],
  "edges": [{ "id": "e1", "from": "n1_bed_access", "to": "n1_bed_door" }],
  "distance": 12.34,
  "crossFloor": true,
  "hazardsOnRoute": [],
  "alternative": null
}
```

Nilai `status` yang mungkin:

| Status | Arti |
| --- | --- |
| `ok` | Rute ditemukan |
| `missing_location` | Salah satu ID lokasi tidak ada |
| `same_location` | Asal dan tujuan sama |
| `disconnected` | Lokasi belum punya node akses |
| `missing_node` | Node graph tidak ditemukan |
| `no_path` | Tidak ada jalur walkable |

`alternative` berisi kandidat rute yang menghindari edge terdampak jika ada
hambatan aktif. Kandidat ini bukan jaminan "rute aman".

---

## 3. Lokasi

### `GET /api/locations`

Mengembalikan array `LocationOut`.

### `POST /api/locations`

```json
{
  "name": "Kamar Tidur Utama",
  "category": "bedroom",
  "floorId": "floor-1",
  "iconKey": "bed",
  "labelPosition": { "x": -4.2, "y": 1.4, "z": 2.2 },
  "navigationNodeId": "n1_bed_access",
  "photo": "/media/photos/photo_abc123.jpg"
}
```

- `category`: `bedroom`, `bathroom`, `kitchen`, `living`, `dining`, `workspace`,
  `entrance`, `stairs`, `garage`, `garden`, `laundry`, `other`.
- `navigationNodeId` opsional. Tanpa node, lokasi disimpan dengan
  `verificationStatus: "needs_path"`.
- Node harus ada dan berada di `floorId` yang sama, jika tidak → `422`.

Status: `201 Created`.

### `GET /api/locations/{id}`

`200` atau `404`.

### `PATCH /api/locations/{id}`

Kirim hanya field yang berubah:

```json
{ "name": "Kamar Utama", "photo": null }
```

Untuk melepas node akses, kirim `"navigationNodeId": null` secara eksplisit.
Status verifikasi dihitung ulang otomatis.

### `DELETE /api/locations/{id}`

```json
{ "status": "ok", "id": "loc_abc123" }
```

### `DELETE /api/locations/{id}/photo`

Menghapus file foto (jika berada di `/media/`) dan mengosongkan field `photo`.

### Bentuk `LocationOut`

```json
{
  "id": "loc_bedroom_main",
  "homeId": "home_demo_1",
  "floorId": "floor-1",
  "name": "Kamar Tidur",
  "category": "bedroom",
  "iconKey": "bed",
  "labelPosition": { "x": -4.2, "y": 1.4, "z": 2.2 },
  "navigationNodeId": "n1_bed_access",
  "photo": null,
  "verificationStatus": "verified",
  "createdAt": "2026-11-12T08:00:00+00:00",
  "updatedAt": "2026-11-12T08:00:00+00:00"
}
```

---

## 4. Unggah Foto

### `POST /api/uploads/photo`

`multipart/form-data` dengan field `file`. Maksimum 8 MB, harus JPEG/PNG/WEBP
yang dapat dibaca Pillow. Server mengompres ke JPEG maksimal 900 px.

```json
{
  "url": "/media/photos/photo_abc123.jpg",
  "width": 900,
  "height": 675
}
```

Error: `400` untuk file kosong/bukan gambar, `413` untuk file terlalu besar.

---

## 5. Hambatan

### `GET /api/hazards?floor_id=floor-1`

Filter `floor_id` opsional.

### `POST /api/hazards`

```json
{
  "floorId": "floor-1",
  "type": "Kabel melintang",
  "category": "tripping",
  "locationName": "Lorong menuju toilet",
  "position": { "x": 0.4, "y": 0.2, "z": -1.1 },
  "edgeIds": ["e3", "e4"],
  "description": "Kabel ekstensi melintang di jalur.",
  "recommendation": "Pindahkan kabel ke tepi dinding.",
  "priority": "high",
  "evidenceUrl": "/media/scans/scan_x/frames/frame_001.jpg",
  "source": "manual",
  "scannedAt": "13 Nov 2026, 09:15 WIB"
}
```

- `category`: `tripping`, `slipping`, `lighting`, `mobility`, `access`, `other`.
- `priority`: `high`, `medium`, `low`.
- `edgeIds` harus berisi edge graph yang dikenal, jika tidak → `422`.
- `status` awal selalu `Perlu diperiksa`.

### `GET /api/hazards/{id}`

`200` atau `404`.

### `PATCH /api/hazards/{id}`

```json
{ "status": "Sudah ditangani", "priority": "medium", "recommendation": "Kabel sudah dipindah." }
```

Perubahan status menulis entri riwayat. Nilai status yang valid:
`Perlu diperiksa`, `Sudah ditangani`, `Tidak relevan`.

### `DELETE /api/hazards/{id}`

Menghapus hambatan. Finding scan yang terkait dikembalikan ke
`perlu_diperiksa` dengan `hazardId` kosong, sehingga tidak ada relasi
menggantung.

---

## 6. Pemindaian

### `POST /api/scans`

`multipart/form-data`:

| Field | Tipe | Keterangan |
| --- | --- | --- |
| `area_name` | string | Nama area, maksimum 100 karakter |
| `floor_id` | string | `floor-1` atau `floor-2` |
| `files` | file[] | 1–20 file media |

Ekstensi yang diterima: `.jpg`, `.jpeg`, `.png`, `.webp`, `.mp4`, `.mov`,
`.webm`, `.m4v`. Total ukuran dibatasi `MAX_UPLOAD_MB` (default 200 MB).

Status: `202 Accepted`, body `ScanJobOut` dengan `status: "queued"`.

```json
{
  "id": "scan_abc123",
  "homeId": "home_demo_1",
  "areaName": "Lantai 1 — Kamar",
  "floorId": "floor-1",
  "status": "queued",
  "stage": "upload",
  "stages": [{ "key": "upload", "label": "Media diunggah", "status": "done", "detail": "File diterima dan disimpan di server." }],
  "error": null,
  "aiMode": "quality_only",
  "result": null,
  "createdAt": "2026-11-13T10:00:00+00:00",
  "updatedAt": "2026-11-13T10:00:00+00:00",
  "completedAt": null,
  "frames": [],
  "findings": []
}
```

### `GET /api/scans?limit=20`

Array ringkasan: `id`, `areaName`, `floorId`, `status`, `stage`, `aiMode`,
`createdAt`, `completedAt`, `frameCount`, `findingCount`.

### `GET /api/scans/{id}`

`ScanJobOut` lengkap, termasuk `frames` dan `findings`.

`result` saat selesai:

```json
{
  "frameCount": 4,
  "quality": {
    "usableFrames": 4,
    "brightnessAvg": 118.4,
    "blurAvg": 96.2,
    "coverageScore": 1.0,
    "warnings": [],
    "matchedPairs": 6,
    "note": "Prototipe ini belum menjalankan COLMAP/3D Gaussian Splatting secara live..."
  },
  "analysis": {
    "mode": "quality_only",
    "provider": "none",
    "model": null,
    "summary": "Analisis AI vision tidak aktif...",
    "limitations": ["AI vision dinonaktifkan..."],
    "usage": {},
    "latencyMs": 0,
    "error": null
  },
  "skippedFiles": []
}
```

`analysis.mode`:

| Mode | Arti |
| --- | --- |
| `ai` | AI aktif dan mengembalikan respons valid |
| `quality_only` | AI tidak dikonfigurasi |
| `degraded` | AI dikonfigurasi tetapi gagal; temuan kosong |

### `GET /api/scans/{id}/events`

Server-Sent Events.

```text
event: update
data: {"id":"scan_abc","status":"running","stage":"quality",...}

event: done
data: {}
```

### `DELETE /api/scans/{id}`

- `200` jika berhasil.
- `409` jika masih ada finding berstatus `diterima`. Hapus hambatan terkait
  lebih dulu.
- `404` jika job tidak ada.

### `POST /api/scans/{id}/findings/{findingId}/accept`

```json
{ "locationId": "loc_bedroom_main", "priority": "high" }
```

- `locationId` opsional; tanpa lokasi, hambatan memakai posisi default dan nama
  area scan.
- `priority` opsional; default mengikuti prioritas finding.
- Edge hambatan diambil otomatis dari node akses lokasi.
- Idempoten: menerima ulang finding yang sudah diterima mengembalikan hazard
  yang sama.
- `404` jika job/finding/lokasi tidak ada.
- `409` jika finding sudah ditinjau dengan status lain.

Response: `HazardOut`.

### `POST /api/scans/{id}/findings/{findingId}/dismiss`

Menandai finding `diabaikan`.

```json
{ "status": "ok", "id": "find_abc123" }
```

- `404` jika tidak ada.
- `409` jika finding sudah diterima.

---

## 7. Riwayat

### `GET /api/history`

Array `HistoryOut` terbaru (maksimum 50).

### `POST /api/history`

Untuk klien yang mencatat aktivitas lokal (misalnya pencarian rute):

```json
{
  "type": "route",
  "title": "Rute dicari: Kamar Tidur → Toilet",
  "detail": "5 segmen"
}
```

Status: `201 Created`, response berisi daftar riwayat terbaru.

Batasan: `title` 1–140 karakter, `detail` maksimum 400 karakter.

### `DELETE /api/history`

```json
{ "status": "ok", "deleted": 12 }
```

---

## 8. Media dan Frontend

| Path | Isi |
| --- | --- |
| `/` | `frontend/index.html` |
| `/vendor/*` | Tailwind, Three.js, OrbitControls, Lucide, font |
| `/media/photos/*` | Foto referensi lokasi |
| `/media/scans/<job>/frames/*` | Frame hasil scan |
| `/media/scans/<job>/thumbs/*` | Thumbnail frame |
| `/api/docs` | Swagger UI |
| `/api/openapi.json` | Skema OpenAPI |

`/media` dipasang sebagai `StaticFiles`. File hanya dapat diakses jika berada di
bawah `DATA_DIR/media`.

---

## 9. Kode Error Umum

| HTTP | Penyebab |
| --- | --- |
| `400` | Format media tidak didukung, file kosong, media tidak terbaca |
| `404` | Lokasi/hambatan/job/finding tidak ditemukan |
| `409` | Konflik status (finding sudah ditinjau, scan masih punya hazard) |
| `413` | Jumlah file atau ukuran upload melebihi batas |
| `422` | Validasi skema, lantai, kategori, ikon, node, edge, prioritas, status |
| `500` | Kesalahan tak terduga; detail tidak dibocorkan ke klien |

Untuk pengujian manual cepat, lihat `scripts/smoke_test.sh`.
