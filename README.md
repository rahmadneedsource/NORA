# NORA

**NORA — Navigasi Rumah & Skrining Hambatan**  
*NORA 3D — Scan your home. Understand your space. Navigate more safely.*

NORA adalah aplikasi web interaktif yang membantu *caregiver* keluarga memetakan rumah lansia dengan Alzheimer ke dalam **Digital Twin 3D Parametrik**, menyimulasikan rute aman antar-ruangan, mengatur tata letak ruangan secara langsung, serta meninjau potensi hambatan jatuh berbasis panduan **CDC STEADI**.

> **Status:** MVP hackathon. Aplikasi ini adalah alat bantu peninjauan lingkungan rumah bagi keluarga/*caregiver*, bukan alat diagnosis medis maupun pengganti pendampingan langsung.

---

## 1. Identitas Tim

| Item | Keterangan |
| --- | --- |
| Nama tim | **MAULGROWUP** |
| Kategori lomba | **Hackathon** |
| Nama aplikasi | **NORA** |
| Tema | Inclusive Health & Well-being |
| Asal | Lomba Logicodix 2026 |

| Anggota | Peran |
| --- | --- |
| Mohamad Maula Aqdas Faqiha | Ide & fitur |
| Nabil Galen Alfadzi | UI/UX & Frontend |
| Rizky Afitra | UI/UX & Frontend |
| Bachtiar Rahmad Permadi | Backend |

---

## 2. Deskripsi Aplikasi

NORA mengubah foto atau video ruangan rumah menjadi **model 3D interaktif** (*Parametric Dollhouse*) yang dapat diputar, disunting tata letaknya, dan ditelusuri layaknya simulasi langsung di dalam rumah.

Alur kerja utama di dalam aplikasi:

1. **Pindai Ruangan (Foto/Video → Denah 3D):** Unggah beberapa foto atau video tur rumah. Browser mengekstrak *keyframe* penting, menjalankan estimasi kedalaman spasial (**Depth Anything V2** via Transformers.js), lalu mengirim ringkasan frame ke **AI Vision** (Gemini / OpenAI) melalui *serverless proxy* `/api/audit` untuk menghasilkan struktur ruangan, furnitur, rute, dan temuan hambatan CDC STEADI.
2. **Atur Layout Manual:** *Caregiver* dapat langsung menyeret ruangan, mengubah dimensi (`±0.25m`), menambah/menghapus ruangan dan furnitur, memutar furnitur 90°, serta membuka/menutup pintu antar-ruangan. Dinding dan jalur navigasi 3D otomatis diperbarui secara *real-time*.
3. **Navigasi Rute Aman & First-Person Walk:** Pilih ruangan asal dan tujuan untuk melihat jalur navigasi 3D lengkap dengan penunjuk arah bergaya GPS, **Auto-Jalan**, kendali **WASD**, dan *minimap* 2D.
4. **Simulasi Before vs After & Mode Malam:** Bandingkan kondisi rumah sebelum dan sesudah perbaikan hambatan, serta uji visibilitas jalur dalam simulasi pencahayaan malam.

---

## 3. Masalah yang Ingin Dibantu

Lansia dengan Alzheimer kerap mengalami gangguan memori dan disorientasi ruang (*spatial disorientation*), sehingga jalur sehari-hari menuju kamar mandi atau ruang tamu dapat memicu kebingungan hingga risiko jatuh. Di sisi lain, bahaya sederhana seperti kabel melintang, keset licin, sudut furnitur, atau lorong gelap sering terlewat oleh keluarga.

NORA membantu *caregiver* untuk:

1. Memvisualisasikan tata letak rumah lansia dalam bentuk 3D yang mudah dipahami bersama keluarga.
2. Mensimulasikan jarak pandang lansia melalui mode **First Person** dan **Mode Malam**.
3. Memetakan serta meninjau potensi hambatan jatuh di sepanjang jalur harian lansia.
4. Menyimpan riwayat pemindaian dan menyesuaikan denah dengan kondisi rumah sebenarnya.

---

## 4. Fitur Utama

### 4.1 Digital Twin 3D Parametrik (`Three.js`)
- Render rumah 3D interaktif (mendukung denah 1 lantai maupun 2 lantai) lengkap dengan lantai, dinding berpotong celah pintu, furnitur, dan label ruangan.
- 3 mode kamera: **Isometrik**, **Denah Atas**, dan **First Person** (mendukung keyboard `WASD` dan tombol **Auto-Jalan**).
- *Minimap* **Denah 2D (X-Z)** yang sinkron dengan posisi dan arah pandang kamera.
- Mode **Before vs After** dan **Mode Malam** untuk mengevaluasi dampak perbaikan dan pencahayaan.

### 4.2 Editor Tata Letak Manual (*Atur Layout Manual*)
- Seret kotak ruangan di kanvas 2D dengan *magnetic snap* dan resolusi tumpang-tindih (*overlap*) otomatis.
- Ubah nama, tipe ruangan, dan ukuran (`Lebar X` & `Panjang Z`) per `0.25m`.
- Kelola furnitur (tambah, geser, putar 90°, hapus) serta kelola koneksi pintu antar-ruangan (`Pintu`).
- Tombol **Snap Rapi** untuk merapikan posisi ruangan sekaligus memindahkan furnitur dan pin bahaya di dalamnya.

### 4.3 Navigasi Rute Aman & Skrining CDC STEADI
- Penghitungan rute antar-ruangan dengan tampilan pita jalur 3D beranimasi dan indikator jarak serta jumlah hambatan di sepanjang jalur.
- Pin bahaya interaktif di viewport 3D (dapat diklik untuk melihat detail risiko & rekomendasi perbaikan, ditambah pin baru secara manual, dan ditandai *Sudah Ditinjau*).

### 4.4 Pemindaian Foto/Video dengan AI & Depth Estimation
- **Ekstraksi Video di Browser:** Mengambil *keyframe* otomatis dari video lokal tanpa harus mengunggah video mentah berukuran besar ke server.
- **Depth Estimation Lokal:** Menggunakan model **Depth Anything V2 Small** (`@huggingface/transformers`) langsung di sisi klien (WebGPU/WASM) untuk memperkirakan kedalaman ruang dan lebar koridor.
- **AI Vision Proxy (`/api/audit`):** Mendukung **Google Gemini** (`gemini-3.8-flash` dengan *fallback* ke `gemini-3-flash-preview` dan `gemini-3.1-flash-lite`) serta **OpenAI** (`gpt-4o-mini`).
- **Mode Demo Offline:** Apabila API Key belum diisi, aplikasi tetap dapat diuji dengan simulasi *Mode Demo Offline* yang jujur tanpa memblokir alur pengguna.

### 4.5 Riwayat & Penyimpanan Lokal
- Hasil pemindaian dan suntingan tata letak disimpan di `localStorage` browser agar tetap bertahan saat halaman dimuat ulang, dilengkapi tombol **Reset** untuk kembali ke kondisi awal *preset*.

---

## 5. Tech Stack

| Lapisan | Teknologi | Catatan |
| --- | --- | --- |
| Frontend | React 19, TypeScript, Vite 7 | SPA responsif dengan kanvas 3D |
| 3D Engine | Three.js (`^0.175.0`) | Dollhouse parametrik, rute 3D, *First-Person* |
| Client-side AI Depth | `@huggingface/transformers` (`^3.5.0`) | Depth Anything V2 Small (WebGPU/WASM) |
| Ikon | `lucide-react` (`^0.511.0`) | Ikon antarmuka |
| AI Vision Proxy | Vercel Serverless Function (`api/audit.ts`) | Proxy ke Gemini API / OpenAI API |
| Pengujian E2E | `playwright-core` | Verifikasi UI & WebGL |
| Deployment | Vercel (`vercel.json`) | Hosting frontend + serverless API |

---

## 6. Struktur Repositori

```text
.
├── api/
│   └── audit.ts                   # Serverless proxy untuk Gemini & OpenAI Vision
├── docs/                          # Dokumentasi tambahan (arsitektur, AI, privasi, dll.)
├── src/
│   ├── components/
│   │   ├── DollhouseViewport.tsx  # Viewport 3D Three.js, kamera, rute, & pin bahaya
│   │   ├── FloorplanMinimap.tsx   # Minimap denah 2D & arah pandang kamera
│   │   └── LayoutEditorPanel.tsx  # Editor tata letak 2D (ruangan, furnitur, pintu)
│   ├── data/
│   │   └── blueprints.ts          # Preset rumah (2 Lantai & Studio) + graf rute
│   ├── services/
│   │   └── visionBlueprint.ts     # Prompt, parser JSON AI Vision, & Mode Demo Offline
│   ├── utils/
│   │   ├── depthEstimator.ts      # Pipeline Depth Anything V2 di browser
│   │   ├── floorGeometry.ts       # Sintesis dinding, bukaan pintu, snap grid, & rute
│   │   └── videoFrames.ts         # Ekstraktor keyframe video & kompresi frame
│   ├── App.tsx                    # State utama, tab Ruangan/Pindai/Riwayat, & panel
│   ├── index.css                  # Styling antarmuka
│   └── main.tsx                   # Entry point React
├── .env.example                   # Contoh variabel environment (kosong, aman untuk Git)
├── .gitignore                     # Mengabaikan .env.local, node_modules, dist, scripts
├── index.html
├── package.json
├── tsconfig.json
├── vercel.json
└── vite.config.ts                 # Konfigurasi Vite + middleware /api/audit saat dev lokal
```

---

## 7. Menjalankan Secara Lokal

### Prasyarat
- **Node.js 18+** dan **npm**

### Langkah Instalasi & Menjalankan

```bash
# 1. Install dependensi
npm install

# 2. (Opsional) Siapkan environment untuk AI Vision
cp .env.example .env.local
# Buka .env.local lalu isi GEMINI_API_KEY atau OPENAI_API_KEY

# 3. Jalankan server development
npm run dev
```

Buka URL lokal yang ditampilkan Vite (umumnya `http://localhost:5173`).  
Untuk membangun versi produksi:

```bash
npm run build
npm run preview
```

---

## 8. Konfigurasi Environment

Semua API Key bersifat **opsional** (tanpa API Key, fitur pemindaian dapat menggunakan **Mode Demo Offline** atau input kunci sementara di tab **Pindai**).

| Variabel | Keterangan |
| --- | --- |
| `GEMINI_API_KEY` | API Key Google Gemini untuk analisis gambar di `/api/audit` |
| `OPENAI_API_KEY` | API Key OpenAI (`gpt-4o-mini`) sebagai alternatif provider Vision |

> **Keamanan:** Jangan pernah menyimpan API Key di kode frontend atau men-commit `.env.local`. File `.gitignore` sudah dikonfigurasi untuk mengabaikan `.env`, `.env.local`, dan `.env.*.local`. Saat deploy ke **Vercel**, masukkan variabel di **Project Settings → Environment Variables**.

---

## 9. Deployment (Vercel)

Proyek ini sudah dikonfigurasi untuk langsung dideploy ke **Vercel** melalui [vercel.json](vercel.json):

1. Hubungkan repositori GitHub ini ke proyek baru di Vercel.
2. Tambahkan `GEMINI_API_KEY` (dan/atau `OPENAI_API_KEY`) di **Environment Variables**.
3. Deploy — Vercel akan menjalankan `npm run build` untuk frontend statis dan menyajikan [api/audit.ts](api/audit.ts) pada endpoint `/api/audit`.

---

## 10. Batasan yang Diakui

1. **Bukan rekonstruksi 3D fotogrametri penuh (NeRF/3DGS):** Model 3D dibangun secara parametrik berdasarkan estimasi kedalaman + pemahaman struktur ruangan oleh AI Vision agar ringan dan dapat langsung disunting secara manual oleh *caregiver*.
2. **Kalibrasi metrik perkiraan:** Ukuran ruangan hasil *scan* bersifat estimasi proporsional dan dapat disempurnakan menggunakan panel **Atur Layout Manual**.
3. **AI sebagai skrining awal:** Temuan risiko CDC STEADI merupakan bantuan identifikasi awal dan tetap memerlukan verifikasi langsung oleh anggota keluarga/*caregiver*.

---

## 11. Privasi & Keamanan

- Pemrosesan video menjadi *keyframe* dan estimasi *depth* berjalan langsung di browser pengguna.
- Hanya *keyframe* terkompresi yang dikirim ke endpoint `/api/audit` apabila pengguna memilih analisis AI aktif.
- Riwayat dan perubahan tata letak disimpan di `localStorage` perangkat pengguna sendiri.
- Kredensial server dibaca dari `.env.local` (lokal) atau Environment Variables Vercel dan tidak pernah dikirim ke repositori Git.
