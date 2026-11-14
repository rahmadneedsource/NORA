# Privasi, Keamanan, dan Batasan Penggunaan

NORA memproses data rumah dan media visual. Dokumen ini menjelaskan data apa
yang akan disimpan, ke mana data dikirim, dan langkah yang harus diambil sebelum
aplikasi dipakai di luar demo lokal.

> **Penting:** MVP ini belum memiliki autentikasi. Jangan menaruh data rumah
> nyata di instance publik tanpa perlindungan tambahan.

---

## 1. Data yang Diproses

| Data | Sumber | Disimpan di | Tujuan |
| --- | --- | --- | --- |
| Nama area/ruangan | Input pengguna | SQLite | Label rute dan scan |
| Kategori, ikon, posisi 3D | Input pengguna | SQLite | Tampilan dan navigasi |
| Foto referensi ruangan | Unggahan pengguna | `data/media/photos/` | Konteks visual lokasi |
| Video/foto scan | Unggahan pengguna | `data/uploads/scans/` | Ekstraksi frame |
| Frame hasil ekstraksi | Proses server | `data/media/scans/` | Kualitas, bukti temuan, thumbnail |
| Metrik kualitas | Proses server | SQLite | Menilai kelayakan media |
| Temuan AI | Provider AI | SQLite | Skrining awal |
| Status hambatan | Verifikasi caregiver | SQLite | Keputusan manusia |
| Riwayat aktivitas | Aplikasi | SQLite | Jejak audit sederhana |
| API key AI | `.env` operator | Environment server | Autentikasi provider |

Tidak ada analytics, cookie iklan, tracking pixel, atau layanan telemetry
pihak ketiga di frontend.

---

## 2. Di Mana Data Disimpan

Secara default:

```text
data/
├── nora.db
├── uploads/
│   ├── scans/<job>/raw/
│   └── photos/
└── media/
    ├── photos/
    └── scans/<job>/
        ├── frames/
        └── thumbs/
```

Pada deployment Docker, direktori ini berada di volume `nora_data`. Data tidak
dikirim ke server Tim NORA; operator deployment adalah pihak yang mengendalikan
infrastruktur.

---

## 3. Kapan Data Dikirim ke Pihak Ketiga

Hanya jika AI vision diaktifkan:

- Yang dikirim: maksimal 6 frame terpilih, nama area, label lantai, dan
  daftar indeks frame.
- Yang tidak dikirim: video penuh, audio, nama pengguna, alamat, GPS, database
  lokasi/hambatan, atau API key pengguna lain.
- Penerima: provider yang ditentukan `AI_BASE_URL` (misalnya OpenRouter,
  OpenAI, Groq, Ollama lokal).
- Kebijakan retensi dan pemrosesan data sepenuhnya mengikuti syarat provider.

Jika `AI_PROVIDER=none` atau key tidak diisi, tidak ada data yang keluar dari
server.

**Saran:** untuk rumah dengan data sensitif, gunakan Ollama/LM Studio lokal
atau nonaktifkan AI. Jika memakai provider cloud, jangan menulis alamat lengkap
atau nama lengkap di kolom nama area.

---

## 4. Masa Simpan dan Penghapusan

- Data bertahan sampai operator menghapusnya.
- **Pengaturan → Atur Ulang Data Demo** mengembalikan database ke seed dan
  menghapus file scan. Ini bukan fitur "hapus akun" karena memang tidak ada
  akun.
- Menghapus job scan akan menghapus baris DB dan direktori frame/raw terkait.
- Menghapus hambatan tidak menghapus frame bukti; frame milik job scan.
- Untuk menghapus seluruh data: hentikan container, hapus volume
  `nora_data`, lalu jalankan ulang. **Tindakan ini permanen.**

Sebelum digunakan di rumah nyata, tetapkan kebijakan retensi tertulis, misalnya
"media scan dihapus setelah 30 hari" dan sediakan prosedur permintaan
penghapusan.

---

## 5. Keamanan yang Sudah Ada

- API key hanya di environment; tidak ada di repo, frontend, atau log.
- Nama file unggahan dibersihkan; path traversal dicegah.
- Hapus file media dibatasi pada `DATA_DIR/media`.
- Format dan isi media divalidasi (Pillow/FFprobe).
- Ukuran upload dibatasi.
- Error 500 tidak membocorkan stack trace ke klien.
- `.env`, `data/`, dan PDF panduan diabaikan Git.
- Frontend tidak memuat CDN eksternal saat runtime.

---

## 6. Risiko yang Belum Ditutup

| Risiko | Dampak | Mitigasi sebelum publik |
| --- | --- | --- |
| Tidak ada login | Siapa pun yang tahu URL dapat melihat/mengubah data | Autentikasi aplikasi atau basic auth di reverse proxy |
| Tidak ada otorisasi per rumah | Semua pengguna melihat data yang sama | Model multi-tenant + sesi pengguna |
| HTTP tanpa TLS | Data dapat disadap | HTTPS wajib (Caddy/Nginx) |
| SQLite tanpa enkripsi | File DB dapat dibaca jika server disusupi | Enkripsi disk/volume, akses OS ketat |
| AI cloud | Frame rumah keluar dari server | Provider lokal atau nonaktifkan AI |
| Tidak ada rate limit | Abuse upload/API | Rate limit di reverse proxy |
| Tidak ada audit login | Sulit melacak akses | Log akses proxy + autentikasi |
| Bukti visual sensitif | Foto ruang pribadi tersimpan | Retensi pendek, akses terbatas |

---

## 7. Checklist Deployment Aman

- [ ] Pasang HTTPS (Caddy otomatis atau Certbot untuk Nginx).
- [ ] Batasi akses: basic auth, SSO, VPN, atau allowlist IP.
- [ ] Jangan buka port 8000 ke internet; bind ke `127.0.0.1`.
- [ ] Gunakan firewall (UFW) dan hanya buka 80/443/SSH.
- [ ] Jalankan container sebagai user non-root.
- [ ] Backup volume secara terenkripsi dan uji restore.
- [ ] Rotasi API key jika pernah terekspos.
- [ ] Tetapkan retensi media dan prosedur penghapusan.
- [ ] Cantumkan kontak operator untuk pertanyaan privasi.
- [ ] Cantumkan pemberitahuan bahwa AI pihak ketiga dapat memproses frame.

---

## 8. Kepatuhan dan Batasan Medis

NORA bukan alat diagnosis dan tidak memproses data medis pasien. Aplikasi tidak
menyimpan rekam medis, diagnosis, obat, atau data klinis. Jika ke depan data
kesehatan akan diproses, operator wajib menilai kewajiban hukum yang berlaku,
termasuk UU Perlindungan Data Pribadi Indonesia, dan mendapatkan dasar
pemrosesan yang sah.

Rekomendasi keselamatan yang dihasilkan AI bersifat umum dan harus diverifikasi
caregiver. Jangan mengambil keputusan medis atau keputusan keselamatan tunggal
berdasarkan keluaran aplikasi.

---

## 9. Kontak

Isi bagian ini pada deployment Anda:

```text
Operator:
Email:
Kebijakan retensi:
Tanggal berlaku:
```
