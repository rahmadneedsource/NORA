# Dokumentasi AI — NORA

NORA memakai model vision sebagai **alat skrining awal**, bukan penentu
keselamatan. Dokumen ini menjelaskan provider yang didukung, data yang dikirim,
prompt, penanganan kegagalan, dan batasan yang harus disampaikan saat demo.

---

## 1. Prinsip

1. **Tidak ada temuan tanpa bukti.** Jika AI tidak aktif, gagal, atau
   mengembalikan respons tidak valid, server tidak membuat temuan.
2. **Manusia tetap pengambil keputusan.** Setiap temuan harus diterima atau
   diabaikan caregiver. Temuan yang diterima menjadi hambatan berstatus
   `Perlu diperiksa`, bukan "fakta".
3. **Tidak ada klaim medis.** Prompt melarang diagnosis, klaim "rute aman", dan
   jaminan keselamatan.
4. **Data minimal.** Hanya frame terpilih yang dikirim, bukan video penuh,
   bukan audio, bukan metadata perangkat.
5. **Transparan.** Mode `quality_only` dan `degraded` ditampilkan di UI beserta
   alasannya.

---

## 2. Provider yang Didukung

### 2.1 OpenAI-compatible (utama)

Request:

```http
POST {AI_BASE_URL}/chat/completions
Authorization: Bearer {AI_API_KEY}
Content-Type: application/json
```

Payload memakai format chat completions dengan `image_url` data URL dan
`response_format: {"type": "json_object"}`.

Cocok untuk:

| Provider | Contoh `AI_BASE_URL` | Contoh model |
| --- | --- | --- |
| OpenRouter | `https://openrouter.ai/api/v1` | `google/gemini-2.5-flash` |
| OpenAI | `https://api.openai.com/v1` | model vision yang tersedia di akun |
| Groq | `https://api.groq.com/openai/v1` | model vision yang tersedia |
| Ollama lokal | `http://localhost:11434/v1` | `llava`, `qwen2.5vl` |
| LM Studio | `http://localhost:1234/v1` | model vision yang dimuat |

Tidak semua provider lokal mendukung `response_format`. Parser tetap berusaha
mengambil objek JSON pertama dari teks; jika gagal, hasil dibuang dan mode
menjadi `degraded`.

### 2.2 Anthropic-compatible (opsional)

Adapter kedua memakai:

```http
POST {AI_BASE_URL}/v1/messages
x-api-key: {AI_API_KEY}
anthropic-version: 2023-06-01
```

Aktifkan dengan `AI_PROVIDER=anthropic`. Ini opsional; jalur utama tetap
OpenAI-compatible agar fleksibel dan tidak mengunci ke satu vendor.

---

## 3. Konfigurasi

```dotenv
AI_PROVIDER=openai_compatible
AI_BASE_URL=https://openrouter.ai/api/v1
AI_API_KEY=isi_hanya_di_env_lokal
AI_MODEL=google/gemini-2.5-flash
AI_TIMEOUT_SECONDS=60
AI_MAX_FRAMES=6
AI_MAX_IMAGE_PX=768
AI_APP_NAME=NORA
AI_APP_URL=
```

Aturan status (`Settings.ai_configured`):

- `AI_PROVIDER=none` → tidak aktif.
- `openai_compatible` tanpa key tetapi base URL localhost/127.0.0.1 → dianggap
  aktif (untuk Ollama/LM Studio tanpa auth).
- `openai_compatible` tanpa key dan base URL remote → tidak aktif.
- `anthropic` tanpa key → tidak aktif.

Status yang terlihat pengguna:

| `analysis.mode` | Kondisi | Temuan |
| --- | --- | --- |
| `ai` | Provider aktif dan respons valid | Maksimal 6, menunggu review |
| `quality_only` | Provider tidak aktif | Nol |
| `degraded` | Provider aktif tetapi gagal | Nol |

---

## 4. Data yang Dikirim

Untuk setiap job scan:

1. Maksimal `AI_MAX_FRAMES` frame.
2. Frame tanpa flag kualitas diprioritaskan; jika kurang dari dua, semua frame
   boleh dipakai.
3. Setiap frame dikecilkan agar sisi terpanjang ≤ `AI_MAX_IMAGE_PX`, dikonversi
   ke JPEG kualitas 72, lalu dikirim sebagai base64 data URL.
4. Teks konteks berisi nama area, label lantai, jumlah frame, dan daftar
   `frame_index` beserta nama file dan timestamp.

Yang **tidak** dikirim:

- video asli,
- audio,
- nama pengguna atau caregiver,
- alamat rumah,
- koordinat GPS,
- isi database lain.

Catatan: nama area yang diisi pengguna ikut terkirim. Jangan menulis alamat
lengkap atau nama lengkap di kolom nama area jika tidak ingin data itu diproses
provider AI.

---

## 5. Prompt

System prompt (diringkas; teks lengkap ada di
`backend/app/services/vision.py`):

```text
Anda adalah asisten inspeksi keselamatan rumah untuk caregiver lansia
dengan Alzheimer. Periksa frame dan tandai potensi hambatan yang TERLIHAT.

Aturan:
- Hanya laporkan objek/kondisi yang benar-benar terlihat.
- Jangan menyimpulkan permukaan licin dari penampilan.
- Jangan memberi diagnosis medis.
- Jangan menyatakan rute "aman".
- Jika ragu, gunakan confidence rendah atau jangan laporkan.
- Rekomendasi harus praktis untuk caregiver.

Kembalikan hanya JSON valid:
{
  "summary": "...",
  "findings": [{
    "category": "tripping|slipping|lighting|mobility|access|other",
    "title": "...",
    "description": "...",
    "priority": "high|medium|low",
    "recommendation": "...",
    "location_hint": "...",
    "frame_index": 0,
    "confidence": 0.0
  }],
  "limitations": ["..."]
}
```

Kategori yang dikenali:

| Kategori | Contoh |
| --- | --- |
| `tripping` | Kabel, barang di lantai, keset bergeser |
| `slipping` | Permukaan tampak basah, alas tanpa anti-slip |
| `lighting` | Lorong gelap, pencahayaan tidak merata |
| `mobility` | Furnitur mempersempit jalur |
| `access` | Pintu/akses terhalang |
| `other` | Potensi hambatan lain yang terlihat |

Setelah parsing, server:

- membatasi maksimal 6 temuan,
- mengklemp keyakinan ke 0–1,
- memetakan kategori/prioritas tak dikenal ke nilai aman,
- memotong panjang teks,
- menggabungkan temuan yang merujuk objek sama (kategori + judul) agar satu objek
  tidak menjadi beberapa hambatan; versi dengan keyakinan tertinggi dipertahankan,
- menautkan temuan ke frame dan bukti visual,
- menambahkan batasan wajib: "Temuan AI adalah skrining awal ... wajib
  diperiksa caregiver."

---

## 6. Penanganan Kegagalan

| Kejadian | Respons server | Dampak UI |
| --- | --- | --- |
| Key kosong/provider `none` | `quality_only`, nol temuan | Badge "Kualitas frame saja" |
| HTTP 4xx/5xx dari provider | `degraded`, alasan menyebut status | Badge "AI gagal — hanya kualitas frame" |
| Timeout/jaringan | `degraded`, alasan provider tidak dapat dihubungi | Sama |
| JSON tidak valid | `degraded`, respons dibuang | Sama |
| Field wajib hilang | `degraded` | Sama |
| Tidak ada frame terpilih | `quality_only`, nol temuan | Sama |

Tidak ada retry otomatis. Ini disengaja agar kegagalan provider tidak
memperpanjang waktu tunggu demo dan tidak menimbulkan biaya berulang.

---

## 7. Evaluasi dan Keterbatasan

AI tidak dievaluasi sebagai alat medis. Evaluasi yang relevan untuk MVP:

- Apakah temuan yang dilaporkan benar-benar terlihat pada frame?
- Apakah model mengarang objek saat frame gelap/buram?
- Apakah rekomendasi tetap praktis dan tidak berbahaya?
- Apakah UI memaksa caregiver memverifikasi?

Keterbatasan yang harus disebut saat demo:

1. Model hanya melihat frame yang dikirim; area di luar frame tidak dinilai.
2. Model tidak dapat memastikan kekasaran/licinnya permukaan.
3. Model dapat salah mengenali objek atau konteks.
4. Tidak ada pengukuran jarak/lebar jalur.
5. Tidak ada jaminan bahwa rute bebas hambatan.
6. Hasil berbahasa Indonesia bergantung pada kemampuan model.
7. Biaya dan kualitas berbeda antar provider/model.

---

## 8. Biaya dan Latensi

- Satu job mengirim maksimal 6 gambar kecil. Biaya tergantung harga model dan
  jumlah token gambar.
- `AI_MAX_FRAMES` dan `AI_MAX_IMAGE_PX` dapat diturunkan untuk menekan biaya.
- `AI_TIMEOUT_SECONDS` membatasi waktu tunggu; pipeline tetap menyimpan hasil
  kualitas meski AI gagal.
- Untuk demo offline, gunakan `AI_PROVIDER=none`. Aplikasi tetap menunjukkan
  pipeline nyata dan tidak memalsukan temuan.

---

## 9. Keamanan dan Privasi

- API key hanya dibaca dari environment; tidak pernah dikirim ke frontend.
- Frontend tidak memanggil provider AI secara langsung.
- Tidak ada logging isi gambar atau API key. Log hanya metadata job dan error.
- Provider pihak ketiga menerima frame dan nama area. Jelaskan hal ini kepada
  pengguna sebelum mengunggah media rumah.
- Untuk data sensitif, gunakan provider lokal (Ollama/LM Studio) atau
  nonaktifkan AI.
- Lihat [PRIVACY.md](PRIVACY.md) untuk rekomendasi kebijakan.

---

## 10. Cara Menguji Tanpa Biaya

```bash
AI_PROVIDER=none python3 -m pytest -q
```

Tes pipeline memverifikasi bahwa mode `quality_only` menghasilkan nol temuan.
Untuk menguji jalur `ai` tanpa provider nyata, tambahkan mock pada
`services.vision` di masa depan; saat ini tidak ada tes yang memanggil API
eksternal.
