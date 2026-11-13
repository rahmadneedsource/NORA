# Skenario Video Demo NORA (3–5 menit)

Video harus direkam dari **aplikasi yang benar-benar berjalan** pada commit
final. Tidak ada mockup, animasi pengganti, atau hasil yang ditempel. Jika AI
gagal saat rekaman, tunjukkan mode `degraded` apa adanya; jangan mengarang
temuan.

---

## Persiapan Sebelum Rekaman

1. Siapkan server:

   ```bash
   cp .env.example .env
   # isi AI_API_KEY jika ingin mendemokan analisis AI
   docker compose up -d --build
   # atau jalankan lokal:
   # PYTHONPATH=backend uvicorn app.main:create_app --factory --port 8000
   ```

2. Buka `http://127.0.0.1:8000` (atau domain HTTPS).
3. Pastikan badge kanan atas menunjukkan **Server aktif**.
4. Siapkan media scan nyata:
   - 1 video pendek 10–20 detik, kamera bergerak perlahan, atau
   - 4–6 foto dari sudut berbeda di satu ruangan.
   - Media harus direkam khusus untuk demo, bukan diambil dari internet.
5. Reset data demo: **Pengaturan → Atur Ulang Data Demo**.
6. Tutup tab lain, aktifkan mode fokus, resolusi 1920×1080, font browser default.
7. Rekam sekaligus (satu take) bila memungkinkan. Durasi target 4 menit.

---

## Struktur Waktu

| Waktu | Bagian | Tujuan |
| --- | --- | --- |
| 0:00–0:25 | Pembuka | Masalah dan nama aplikasi |
| 0:25–0:55 | Digital twin | Memperlihatkan rumah 3D dan pin |
| 0:55–1:45 | Navigasi | Rute biasa, lintas lantai, panduan |
| 1:45–2:55 | Pemindaian | Unggah media nyata, pipeline, hasil |
| 2:55–3:35 | Review temuan | Terima/abaikan, hambatan baru |
| 3:35–4:10 | Dampak & batasan | Kejujuran produk |
| 4:10–4:30 | Penutup | Ringkasan dan tim |

---

## Naskah dan Aksi

### 0:00–0:25 — Pembuka

**Layar:** Tab **Rumah**, tampilan 3D penuh.

**Narasi:**

> "Rumah yang familiar bisa terasa membingungkan bagi lansia dengan Alzheimer.
> Di saat yang sama, keluarga sulit melihat hambatan kecil di jalur sehari-hari.
> Ini NORA — HomeSafe 3D — yang membantu caregiver memetakan rumah, menelusuri
> rute, dan meninjau potensi hambatan."

**Aksi:** Putar model sedikit dengan drag, lalu reset kamera.

---

### 0:25–0:55 — Digital twin

**Layar:** Tab **Rumah**.

**Narasi:**

> "Rumah ditampilkan sebagai digital twin dua lantai. Setiap ruangan punya pin
> dan label. Pin hambatan berwarna oranye menunjukkan area yang perlu
> perhatian."

**Aksi:**

1. Arahkan kursor ke satu pin lokasi, tunjukkan nama ruangan.
2. Klik satu pin hambatan, tunjukkan panel detail.
3. Tutup panel.

---

### 0:55–1:45 — Navigasi dan panduan

**Layar:** Panel rute kanan/bawah.

**Narasi:**

> "Caregiver memilih lokasi awal dan tujuan. Rute dihitung dengan A* pada graph
> navigasi, bukan garis dekoratif."

**Aksi:**

1. Pilih asal **Kamar Tidur**.
2. Pilih tujuan **Toilet**.
3. Tunjukkan rute muncul di lantai 1, status "Jalur tersedia", dan jumlah
   hambatan pada jalur.
4. Klik **Panduan**; tunjukkan langkah pertama dan tombol suara.
5. Ganti tujuan ke **Kamar Tamu Atas**.
6. Tunjukkan status **Rute antar-lantai via tangga**, pita rute berpindah ke
   lantai 2 saat melewati tangga, dan jumlah segmen bertambah.

**Narasi:**

> "Rute lintas lantai otomatis memakai tangga. Panduan langkah ikut berpindah
> lantai, dan caregiver bisa memutar instruksi singkat."

---

### 1:45–2:55 — Pemindaian nyata

**Layar:** Tab **Pindai**.

**Narasi:**

> "Sekarang bagian yang paling sering disalahpahami di demo 3D: pemindaian.
> Kami tidak mengklaim rekonstruksi 3D otomatis. Yang benar-benar berjalan
> adalah ekstraksi frame, penilaian kualitas, dan analisis AI opsional."

**Aksi:**

1. Isi nama area, misalnya **Lantai 1 — Lorong**.
2. Pilih lantai **Lantai 1**.
3. Klik area unggah, pilih 4 foto nyata (atau satu video pendek).
4. Tunjukkan daftar file dan pesan validasi bila hanya satu foto.
5. Klik **Mulai Pemrosesan**.
6. Tunjukkan stage berjalan: unggah, ekstraksi frame, kualitas, analisis.
7. Setelah selesai, tunjukkan:
   - jumlah frame dan frame layak,
   - cahaya rata-rata,
   - skor tumpang tindih,
   - thumbnail frame,
   - badge mode (`AI vision aktif`, `Kualitas frame saja`, atau `AI gagal`),
   - ringkasan dan batasan.

**Narasi:**

> "Server mengekstrak frame dengan FFmpeg, menghitung kecerahan, ketajaman, dan
> tumpang tindih dengan ORB. Jika AI aktif, frame terpilih dikirim ke model
> vision. Jika AI tidak aktif atau gagal, kami menampilkan nol temuan dan
> menjelaskan alasannya. Tidak ada temuan yang difabrikasi."

**Jika AI aktif dan menemukan sesuatu:**

> "Setiap temuan masih berupa usulan. Caregiver yang memutuskan."

**Jika AI gagal:**

> "Di rekaman ini provider AI tidak tersedia. Aplikasi tetap menyelesaikan
> pemeriksaan kualitas dan secara eksplisit menandai mode degraded. Ini perilaku
> yang memang kami rancang."

---

### 2:55–3:35 — Review temuan

**Layar:** Hasil pemindaian.

**Aksi:**

1. Tunjukkan satu kartu temuan (jika ada).
2. Pilih lokasi terkait dari dropdown, misalnya **Lorong** atau **Kamar Tidur**.
3. Klik **Terima sebagai Hambatan**.
4. Tunjukkan toast dan status temuan berubah menjadi "Diterima sebagai
   hambatan".
5. Buka tab **Rumah**; tunjukkan pin hambatan baru.
6. Buka panel hambatan; ubah status menjadi **Sudah ditangani**, lalu
   kembalikan ke **Perlu diperiksa** bila ingin menunjukkan verifikasi.
7. Kembali ke tab **Pindai**; tunjukkan tombol **Abaikan** pada temuan lain
   (jika ada).

**Narasi:**

> "Temuan tidak langsung menjadi kebenaran. Caregiver menautkannya ke ruangan,
> menerima atau mengabaikannya, lalu memverifikasi statusnya. Inilah lapisan
> manusia yang membuat alat ini aman dipakai."

Jika tidak ada temuan AI, lewati langkah 2–3 dan tunjukkan penjelasan UI bahwa
temuan manual dapat dicatat dari menu Hambatan. Jangan menyuntikkan temuan
palsu untuk rekaman.

---

### 3:35–4:10 — Dampak, arsitektur, dan batasan

**Layar:** Tab **Riwayat**, lalu **Pengaturan**.

**Narasi:**

> "Semua aktivitas tercatat. Frontend dan API berjalan di origin yang sama,
> data disimpan di SQLite dan volume server, dan tidak ada CDN eksternal saat
> runtime. AI bersifat opsional dan bisa dimatikan sepenuhnya."

**Aksi:**

1. Tunjukkan riwayat scan dan aktivitas.
2. Buka **Pengaturan**; tunjukkan status server dan AI.
3. Tunjukkan tombol reset demo.

**Narasi batasan:**

> "Kami ingin jujur: model 3D adalah twin demo yang sudah dikurasi, bukan hasil
> rekonstruksi otomatis dari video. Graph navigasi juga dikurasi. AI hanya
> skrining awal dan tidak menggantikan caregiver. Belum ada autentikasi, jadi
> deployment publik harus dilindungi di reverse proxy."

---

### 4:10–4:30 — Penutup

**Layar:** Tab **Rumah**, tampilan 3D.

**Narasi:**

> "NORA membantu keluarga melihat rumah, merencanakan jalur, dan menemukan
> hambatan sebelum sesuatu terjadi. Tim NORA — Muhammad Maula, Nabil Galen,
> Rizky Alfitra, dan Bachtiar Rahmad. Terima kasih."

---

## Checklist Setelah Rekaman

- [ ] Durasi 3–5 menit.
- [ ] Tidak ada mockup atau hasil tempelan.
- [ ] Badge server terlihat.
- [ ] Media scan adalah file nyata yang diunggah saat rekaman.
- [ ] Jika AI gagal, mode degraded terlihat dan dijelaskan.
- [ ] Tidak ada API key, email, atau data pribadi di layar.
- [ ] Suara jelas; teks di layar terbaca.
- [ ] Video diunggah ke platform yang disyaratkan lomba.
- [ ] Cantumkan commit hash pada deskripsi video.

---

## Audio dan Editing

- Rekaman layar tanpa musik latar lebih aman untuk penilaian.
- Jika memakai musik, gunakan lisensi bebas dan cantumkan atribusi.
- Jangan menambahkan animasi produk yang tidak ada di aplikasi.
- Jangan memotong bagian saat AI gagal; justru tunjukkan penanganannya.
- Teks judul singkat boleh ditambahkan, tetapi bukan pengganti rekaman nyata.
