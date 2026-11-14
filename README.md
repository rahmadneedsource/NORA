# NORA — Pemetaan Rumah 3D & Audit Keselamatan Lansia (CDC STEADI)

**NORA** adalah platform web **Digital Twin 3D** dan **Asisten Terapis Okupasi AI** untuk membantu keluarga dan *caregiver* mengidentifikasi serta mencegah risiko jatuh lansia di dalam rumah berdasarkan protokol medis **CDC STEADI** (*Stopping Elderly Accidents, Deaths, & Injuries*).

Dibangun untuk **Logicodix Hackathon 2026** (Sub-tema: *Inclusive Health & Well-being*).

---

## Masalah yang Diselesaikan
Menurut CDC & WHO, jatuh adalah penyebab utama cedera fatal pada lansia 65+, dengan lebih dari separuh kejadian terjadi di rumah sendiri (terutama pada rute **Kamar Tidur → Toilet** di malam hari). Anggota keluarga sering kali tidak menyadari bahaya tersembunyi (kabel melintang, keset licin, pencahayaan redup, ketiadaan *grab bar*, atau celah jalan sempit `< 80 cm`).

## Fitur Utama
1. **Parametric 3D Dollhouse Engine (Three.js 60 FPS):**
   - Tampilan maket arsitektural bersih dengan 3 mode kamera: **Isometrik**, **Denah Atas**, dan **Walker View (150 cm)** dengan kontrol WASD untuk merasakan sudut pandang lansia.
   - **Minimap 2D Sinkron** & klik-di-3D (*raycasting*) untuk menambah titik temuan manual.
2. **Audit Bahaya AI (Tab Pindai):**
   - Ekstraksi **4–6 keyframe** langsung dari video (`.mp4`/`.mov`), multi-foto ruangan, atau sketsa denah 2D di browser.
   - Terhubung ke **Google Gemini Vision** (dengan fallback model otomatis `gemini-3.8-flash` → `gemini-3.1-flash-lite` → `gemini-3-flash-preview`) atau **OpenAI Vision** melalui serverless proxy `/api/audit` agar API key aman di server.
   - Menghasilkan JSON denah 3D (*Semantic Spatial Blueprint*), rute aman antar ruangan, dan daftar temuan **4 Pilar CDC STEADI** (*Tripping*, *Ergonomic*, *Lighting*, *Mobility*) beserta bukti foto asli.
3. **Simulator Klinis Interaktif:**
   - **Senior Eye Night Vision (0–100%):** Mensimulasikan penurunan daya tangkap cahaya mata lansia pada malam hari.
   - **Before vs After Remediation:** Mengubah objek 3D secara nyata (menyembunyikan kabel/keset berisiko, memunculkan *grab bar* di toilet, dan menyalakan lampu malam sensor gerak).
4. **Rute Aman & Checklist Keluarga/Kontraktor:**
   - Penentu jalur aman terpendek **Dari Ruangan → Ke Ruangan** dengan penanda bahaya di lintasan serta panduan suara (`id-ID`).
   - Kalkulasi estimasi biaya perbaikan (`Rp`) dan laporan **Cetak / Simpan PDF**.

## Etika Data & Efisiensi AI (Green IT)
- **Efisiensi Sumber Daya:** Video diproses lokal di browser menggunakan HTML5 Canvas untuk mengambil 4–6 keyframe terkompresi saja—tidak mengunggah video mentah berukuran besar dan tidak memerlukan GPU server berat.
- **Privasi Data:** Endpoint `/api/audit` meneruskan frame secara *ephemeral* (tidak menyimpan foto rumah pengguna di server/database). Riwayat denah disimpan lokal di `localStorage` perangkat pengguna.

---

## Menjalankan Secara Lokal (`localhost`)

### Prasyarat
- Node.js 18+

### Langkah Instalasi
```bash
npm install
cp .env.example .env.local
# Isi GEMINI_API_KEY di .env.local (opsional jika ingin menggunakan Live Vision AI; Mode Demo Offline tetap berjalan tanpa key)
npm run dev
```
Aplikasi berjalan di `http://localhost:5175` (termasuk middleware `/api/audit` otomatis).

### Build Produksi & Uji E2E
```bash
npm run build
```

## Deploy ke Vercel
1. Hubungkan repositori ke Vercel (Root Directory: `homesafe-3d` jika menggunakan monorepo, atau root proyek).
2. Tambahkan Environment Variable **`GEMINI_API_KEY`** di *Vercel Project Settings → Environment Variables*.
3. Deploy — `vercel.json` dan `api/audit.ts` akan aktif otomatis.
