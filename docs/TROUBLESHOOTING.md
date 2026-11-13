# Panduan Troubleshooting NORA

Dokumen ini merangkum kendala yang paling sering muncul saat menjalankan, menguji, atau menggunakan **NORA** secara lokal maupun di server, beserta cara mengatasinya.

---

## 1. Server & Instalasi Lokal

### `uvicorn` atau `app` tidak ditemukan (`ModuleNotFoundError: No module named 'app'`)
Pastikan `PYTHONPATH` diarahkan ke folder `backend` sebelum menjalankan `uvicorn`:

**Windows (PowerShell):**
```powershell
$env:PYTHONPATH = "backend"
uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

**Linux / macOS (Bash):**
```bash
PYTHONPATH=backend uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

### Port `8000` sudah digunakan
Jika muncul error `address already in use` / `WinError 10048`:
- Jalankan di port lain, misalnya `8080`:
  ```powershell
  uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8080
  ```
- Jika memakai frontend di origin berbeda, tambahkan URL tersebut ke `CORS_ORIGINS` di `.env`.

### Dependency Python gagal terpasang
Pastikan menggunakan **Python 3.10+** dan virtual environment sudah aktif sebelum menjalankan `pip install -r backend/requirements.txt`.

---

## 2. Pemindaian Video & FFmpeg

### Video gagal diproses / FFmpeg tidak ditemukan
Ekstraksi frame video membutuhkan `ffmpeg` dan `ffprobe`.

- **Cek ketersediaan di terminal:**
  ```powershell
  ffmpeg -version
  ffprobe -version
  ```
- **Jika belum terpasang di Windows:** pasang FFmpeg (misalnya via `winget install Gyan.FFmpeg`) lalu restart terminal.
- **Jika binary ada di folder khusus:** set path lengkapnya di `.env`:
  ```dotenv
  FFMPEG_BIN=C:\path\to\ffmpeg.exe
  FFPROBE_BIN=C:\path\to\ffprobe.exe
  ```
- **Catatan:** Pemindaian **foto** (JPG, PNG, WEBP) tetap berjalan tanpa FFmpeg karena diproses oleh Pillow dan OpenCV.

### Upload ditolak karena ukuran atau jumlah file
Batas default per pemindaian adalah **20 file** (`MAX_FILES=20`) dan total **200 MB** (`MAX_UPLOAD_MB=200`). Jika perlu menaikkan batasnya, ubah nilai tersebut di `.env` lalu restart server.

---

## 3. Mode AI (`quality_only` dan `degraded`)

NORA sengaja tidak membuat temuan palsu jika AI tidak aktif atau bermasalah.

### Status scan selalu `quality_only`
Artinya analisis AI tidak dijalankan (hanya pemeriksaan kualitas visual frame):
1. Pastikan file `.env` sudah dibuat dari `.env.example` di root proyek (`Nora-main/.env`).
2. Pastikan `AI_PROVIDER` diset ke `openai_compatible` atau `anthropic` (bukan `none`).
3. Pastikan `AI_API_KEY` terisi (kecuali jika memakai endpoint lokal seperti Ollama di `http://localhost:11434/v1`).
4. **Penting:** Jika variabel environment sudah di-set di shell sebelumnya, `_load_dotenv` di `backend/app/config.py` tidak akan menimpanya (`if key not in os.environ`). Cek nilai env shell aktif jika perubahan `.env` tidak berefek.

### Status scan `degraded`
Artinya panggilan ke provider AI gagal, timeout, atau respons tidak sesuai format JSON yang diharapkan:
- Pastikan `AI_MODEL` mendukung input gambar (**vision-capable**), misalnya `google/gemini-2.5-flash` atau `llava` di Ollama.
- Pastikan `AI_BASE_URL` benar (untuk OpenRouter: `https://openrouter.ai/api/v1`, untuk Ollama lokal: `http://localhost:11434/v1`).
- Jika koneksi ke model lambat, naikkan `AI_TIMEOUT_SECONDS` di `.env` (default `60`).

---

## 4. Database, Data Demo, & Mode Lokal

### Header menampilkan `Mode lokal` bukan `Server aktif`
Frontend otomatis jatuh ke `localStorage` jika backend tidak merespons:
- Pastikan server `uvicorn` sedang berjalan dan halaman dibuka melalui URL server (`http://127.0.0.1:8000`), bukan membuka `frontend/index.html` langsung via `file://`.
- Di `Mode lokal`, data CRUD tersimpan di browser, tetapi pemindaian media/AI tetap memerlukan server aktif.

### Ingin mengembalikan data ke kondisi awal (reset demo)
- **Dari UI:** Buka **Pengaturan → Atur Ulang Data Demo** (memanggil `POST /api/demo/reset`).
- **Reset total SQLite & file upload:** Hentikan server, hapus folder `data/` (atau lokasi `DATA_DIR` di `.env`), lalu jalankan ulang server agar `nora.db` dibuat dan di-seed ulang otomatis.

### Rute tidak bisa dibuat untuk lokasi baru
Lokasi yang belum dihubungkan ke titik akses pada graph navigasi akan ditandai `Perlu pengaturan jalur`. Edit lokasi tersebut dan pilih node/titik akses graph yang sesuai.

---

## 5. Pengujian (`pytest`)

### `pytest` gagal karena plugin pihak ketiga yang rusak di mesin lokal
Jalankan dengan menonaktifkan autoload plugin:

```powershell
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = "1"
python -m pytest -q
```

### Error `No module named 'app'` saat menjalankan `pytest`
Pastikan `pytest` dijalankan dari root proyek (`Nora-main/`), di mana `pytest.ini` berada.
