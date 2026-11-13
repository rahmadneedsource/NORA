# Arsitektur NORA

Dokumen ini menjelaskan komponen runtime, aliran data, dan keputusan teknis
yang dipakai di repositori ini. Fokusnya adalah kejelasan dan kejujuran: setiap
bagian memisahkan apa yang benar-benar dijalankan dari apa yang masih berupa
batasan prototipe.

---

## 1. Gambaran Sistem

```text
┌──────────────────────────────────────────────────────────────────┐
│ Browser                                                          │
│  frontend/index.html                                             │
│  ├─ Tailwind (lokal)        ├─ Three.js + OrbitControls (lokal)  │
│  ├─ Lucide (lokal)          ├─ Inter WOFF2 (lokal)               │
│  ├─ state lokal (localStorage)                                   │
│  └─ fetch same-origin ke /api/*                                  │
└───────────────────────────────┬──────────────────────────────────┘
                                │ HTTP
┌───────────────────────────────▼──────────────────────────────────┐
│ FastAPI (satu proses Uvicorn)                                    │
│  ├─ /                    → frontend statis                       │
│  ├─ /media/*             → foto & frame hasil scan               │
│  ├─ /api/docs            → OpenAPI UI                            │
│  ├─ routers/system       → health, bootstrap, reset, AI status   │
│  ├─ routers/locations    → CRUD lokasi + foto                    │
│  ├─ routers/hazards      → CRUD hambatan + verifikasi            │
│  ├─ routers/navigation   → graph + A* route                      │
│  ├─ routers/scans        → upload, status, SSE, review temuan    │
│  ├─ routers/uploads      → foto referensi lokasi                 │
│  └─ routers/history      → aktivitas                             │
│                                                                  │
│  services/navigation  → A*, hazard penalty, alternatif           │
│  services/frames      → FFmpeg frame extraction                  │
│  services/quality     → brightness, blur, ORB overlap            │
│  services/vision      → OpenAI-compatible / Anthropic adapter    │
│  services/pipeline    → orkestrasi scan                          │
│  services/storage     → validasi media, normalisasi, thumbnail   │
└───────────────┬──────────────────────────────┬───────────────────┘
                │                              │
        ┌───────▼────────┐            ┌────────▼─────────┐
        │ SQLite         │            │ Filesystem       │
        │ data/nora.db   │            │ data/uploads/*   │
        └────────────────┘            │ data/media/*     │
                                      └──────────────────┘
                │
        ┌───────▼──────────────────────────────┐
        │ Opsional: provider AI vision         │
        │ OpenAI-compatible atau Anthropic     │
        └──────────────────────────────────────┘
```

Frontend dan API berada di origin yang sama. Ini menghilangkan kebutuhan CORS
untuk penggunaan normal, menyederhanakan cookie/credential di masa depan, dan
membuat demo di VPS hanya perlu satu domain.

---

## 2. Komponen Backend

| Modul | Tanggung jawab |
| --- | --- |
| `app/main.py` | Factory `create_app`, middleware CORS, mount static, registrasi router |
| `app/config.py` | Pembacaan env, path turunan, status AI publik |
| `app/db.py` | Skema SQLite, seed awal, reset demo |
| `app/repository.py` | Query SQL, mapping snake_case ↔ camelCase |
| `app/schemas.py` | Validasi request/response Pydantic |
| `app/seed_data.py` | Data rumah contoh dan graph |
| `app/routers/*` | Kontrak HTTP per domain |
| `app/services/navigation.py` | A* deterministik dan pengayaan rute |
| `app/services/frames.py` | Ekstraksi frame dari gambar/video |
| `app/services/quality.py` | Metrik kualitas dan overlap |
| `app/services/vision.py` | Pemanggilan AI dan parsing JSON |
| `app/services/pipeline.py` | State machine scan job |
| `app/services/storage.py` | Validasi file, normalisasi gambar, thumbnail |

Tidak ada ORM. `sqlite3` dipakai langsung agar dependensi kecil dan query mudah
dibaca. Semua koneksi memakai `row_factory = sqlite3.Row`, `PRAGMA foreign_keys`,
dan mode WAL.

---

## 3. Model Data

```text
homes 1 ─── * locations
  │              └─ navigation_node_id → graph node (bukan FK SQL)
  ├────────── * hazards
  │              └─ edge_ids → JSON array edge graph
  ├────────── * scan_jobs
  │                 ├── * scan_frames
  │                 └── * scan_findings
  │                        └─ hazard_id → hazards.id (setelah diterima)
  └────────── * history
```

| Tabel | Isi penting |
| --- | --- |
| `homes` | Satu rumah demo; nama dan alamat |
| `locations` | Ruangan, kategori, ikon, posisi 3D, node akses, foto, status verifikasi |
| `hazards` | Temuan/hambatan, kategori, prioritas, edge terdampak, status caregiver |
| `scan_jobs` | Status job, stage JSON, mode AI, hasil ringkas |
| `scan_frames` | Path media, timestamp, dimensi, metrik kualitas, flag |
| `scan_findings` | Temuan per frame, keyakinan, status review, relasi ke hazard |
| `history` | Jejak aktivitas manusia dan sistem |

Graph navigasi **tidak** disimpan di SQLite. Graph adalah sumber statis
`backend/app/seed/graph.json` yang dimuat sekali dan di-cache. Lokasi
menyimpan `navigationNodeId`; validasi memastikan node ada dan berada di lantai
yang sama.

Alasan pemisahan ini: graph adalah geometri yang dikurasi, bukan data yang
berubah saat pengguna menambah ruangan. Jika nanti ada editor graph, tabel
terpisah dapat ditambahkan tanpa mengubah kontrak rute.

---

## 4. Alur Navigasi

1. Frontend mengirim `originLocationId` dan `destinationLocationId`.
2. Backend memuat kedua lokasi dan seluruh hambatan.
3. Jika lokasi tidak ada, rute belum terhubung, atau asal = tujuan, backend
   mengembalikan status yang sesuai tanpa mencoba memaksa jalur.
4. A* berjalan pada adjacency walkable. Bobot edge memakai `cost` eksplisit
   bila ada (misalnya tangga `e12` = 2,5), selain itu jarak Euclidean pada
   bidang XZ.
5. Edge pada rute dibandingkan dengan `edgeIds` hambatan aktif.
6. Jika ada hambatan aktif, A* dijalankan ulang dengan penalti pada edge
   terdampak (60 untuk prioritas tinggi, 25 untuk prioritas lain). Kandidat
   alternatif hanya dikembalikan bila edge-nya benar-benar berbeda.
7. Frontend menggambar hanya segmen pada lantai yang sedang terlihat; panduan
   langkah berpindah lantai otomatis saat melewati tangga.

Frontend memiliki implementasi A* yang sama sebagai fallback. Perbedaan kecil
dapat terjadi jika graph server dan graph lokal berbeda versi; server selalu
diutamakan saat online.

Detail graph:

- 17 node: 12 di lantai 1, 5 di lantai 2.
- 16 edge, termasuk `e12` yang menghubungkan `n1_stairs_base` ke
  `n2_stairs_top` dengan `crossFloor: true` dan `cost: 2.5`.
- Rute contoh `loc_bedroom_main → loc_guest_f2` memakai 8 edge.

---

## 5. Pipeline Pemindaian

```text
POST /api/scans (multipart)
  │
  ├─ validasi floor, jumlah file, ekstensi
  ├─ simpan file ke data/uploads/scans/<job>/raw
  ├─ deteksi jenis media (Pillow / ffprobe)
  ├─ buat scan_jobs + stage awal
  └─ BackgroundTasks: run_pipeline
         │
         ├─ frames: normalisasi gambar / ekstraksi video FFmpeg
         ├─ quality: brightness, blur, ORB overlap
         ├─ analysis: AI opsional
         └─ ready | failed
```

### 5.1 Ekstraksi frame

- Gambar: dinormalisasi ke JPEG maksimal 1600 px, dibuat thumbnail 360 px.
- Video: `ffprobe` mengambil durasi, lalu FFmpeg mengambil sampel dengan
  `fps=1/interval`, maksimal 24 frame per video dan 36 frame total per job.
- Jika tidak ada frame valid, job gagal dengan pesan yang dapat dibaca pengguna.

### 5.2 Kualitas

- Kecerahan: rata-rata kanal grayscale. Di bawah 50 diberi flag `low_light`.
- Ketajaman: variance of Laplacian. Di bawah 30 diberi flag `blurred`.
- Resolusi: sisi terpendek di bawah 480 diberi flag `low_resolution`.
- Tumpang tindih: ORB 600 fitur, BFMatcher Hamming, rasio Lowe 0,75. Pasangan
  dianggap bertumpang tindih bila skor ≥ 0,15. Coverage adalah ukuran komponen
  terhubung terbesar dibagi jumlah frame.

Metrik ini **tidak** merekonstruksi 3D. Fungsinya menilai apakah media layak
dipakai sebagai input pipeline rekonstruksi di masa depan, dan memberi saran
perekaman yang konkret.

### 5.3 Analisis AI

- Frame terpilih: utamakan frame tanpa flag, maksimal `AI_MAX_FRAMES`.
- Gambar dikecilkan ke `AI_MAX_IMAGE_PX` dan dikirim sebagai data URL.
- Respons wajib JSON; parser menolak markdown dan mengambil objek JSON pertama
  bila model menambahkan teks.
- Temuan dibatasi enam per job, keyakinan diklem 0–1, kategori/prioritas
  divalidasi.
- Jika provider gagal, mode `degraded`, temuan kosong, alasan disimpan.

### 5.4 State job

| Status | Arti |
| --- | --- |
| `queued` | Job dibuat, menunggu background task |
| `running` | Pipeline berjalan |
| `ready` | Hasil siap ditinjau |
| `failed` | Pipeline gagal; `error` berisi alasan |

Stage yang terlihat di UI: `upload`, `frames`, `quality`, `analysis`, `ready`.
Setiap stage punya status `pending`, `running`, `done`, atau `failed`.

### 5.5 Review temuan

- `accept` membuat baris `hazards` dengan `source = ai_scan`, memakai lokasi
  dan edge yang dipilih caregiver, lalu menandai finding `diterima`.
- `dismiss` menandai finding `diabaikan`.
- Scan yang masih memiliki finding `diterima` tidak dapat dihapus. Jika hazard
  terkait dihapus, finding otomatis kembali ke `perlu_diperiksa` agar data
  tidak menggantung.

### 5.6 SSE

`GET /api/scans/{id}/events` mengirim event `update` setiap ada perubahan dan
event `done` saat `ready`/`failed`. Frontend saat ini memakai polling; endpoint
SSE disediakan untuk klien yang membutuhkan progres real-time tanpa polling.

---

## 6. Frontend

`frontend/index.html` adalah satu halaman dengan tiga tab:

1. **Rumah** — viewer 3D, pin lokasi/hambatan, panel rute, panduan langkah.
2. **Pindai** — unggah media, progres pipeline, hasil kualitas, review temuan.
3. **Riwayat** — catatan scan dan aktivitas.

Prinsip integrasi:

- **Server-first, local fallback.** Setiap operasi baca/tulis mencoba API. Jika
  gagal, UI tetap berfungsi dengan `localStorage` dan menampilkan badge
  `Mode lokal`.
- **Tidak ada data palsu.** Preset contoh scan dihapus. Tanpa backend, tab
  Pindai menjelaskan bahwa pemrosesan memerlukan server, bukan menampilkan
  progres palsu.
- **Render aman.** Semua teks dari server/input pengguna melewati `escapeHtml`
  sebelum masuk `innerHTML`.
- **Posisi pin stabil.** Sinkronisasi posisi pin memakai `data-pin` dan `id`,
  bukan urutan NodeList, sehingga pin di luar frustum tidak menggeser pin lain.
- **Aksesibilitas.** Preferensi reduced motion dihormati; kontras mengikuti
  palet yang ada; kontrol utama memiliki label teks, bukan hanya ikon.

---

## 7. Konkurensi dan Penyimpanan

- Uvicorn dijalankan satu worker pada deployment contoh. Background task scan
  berjalan di threadpool proses yang sama.
- SQLite memakai WAL agar pembacaan status job tidak memblokir penulisan.
- Setiap job memiliki direktori sendiri:
  `data/uploads/scans/<job>/raw`,
  `data/media/scans/<job>/frames`,
  `data/media/scans/<job>/thumbs`.
- Foto referensi disimpan di `data/media/photos/`.
- Penghapusan job menghapus baris DB dan direktori terkait. Penghapusan hazard
  membersihkan relasi finding, bukan file bukti (bukti milik frame job).

Untuk beban lebih besar, langkah berikutnya adalah job queue eksternal
(Redis/RQ/Celery), worker terpisah, dan PostgreSQL. Itu di luar cakupan MVP.

---

## 8. Kegagalan dan Degradasi

| Kondisi | Perilaku |
| --- | --- |
| OpenCV tidak terpasang | Kualitas dilewati, semua frame dianggap layak, ada peringatan |
| FFmpeg tidak tersedia | Video gagal diekstrak dengan pesan jelas; foto tetap bisa |
| AI key kosong | Mode `quality_only`, nol temuan |
| AI menolak/timeout | Mode `degraded`, nol temuan, alasan ditampilkan |
| Respons AI bukan JSON | Respons dibuang, mode `degraded` |
| Backend mati | Frontend mode lokal, CRUD tetap jalan |
| Lokasi tanpa node | Status `disconnected`, UI minta pengaturan jalur |
| Graph tidak konsisten | `get_graph` melempar error saat startup/validasi |

Prinsipnya: **lebih baik mengakui tidak ada data daripada menampilkan hasil
yang tidak bisa dipertanggungjawabkan.**

---

## 9. Keamanan

- Tidak ada rahasia di kode atau repo; semua dari env.
- Nama file diunggah dibersihkan dengan regex dan dipecah dari path.
- Path media dihapus hanya jika berada di dalam `media_dir` (cek `relative_to`).
- Ekstensi dan isi file divalidasi; gambar diverifikasi dengan Pillow.
- Ukuran total upload dibatasi env.
- Belum ada autentikasi/otorisasi. Ini batasan yang harus ditutup sebelum
  deployment publik.
- AI menerima hanya frame terpilih, bukan video atau data lokasi perangkat.

---

## 10. Titik Ekstensi

| Kebutuhan | Titik masuk |
| --- | --- |
| Rekonstruksi 3D nyata | `services/frames.py` + worker terpisah; simpan model ke `media/` |
| Model vision lain | `services/vision.py` (tambahkan adapter baru) |
| Graph dari hasil scan | Ganti `seed/graph.json` atau tambahkan tabel graph |
| Autentikasi | Middleware FastAPI + proteksi router tulis |
| Multi-rumah | Tambahkan `home_id` pada sesi pengguna dan filter query |
| Job queue | Ganti `BackgroundTasks` dengan queue eksternal |

Perubahan tersebut tidak boleh mengubah klaim UI sebelum benar-benar
diimplementasikan.
