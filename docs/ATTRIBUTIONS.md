# Atribusi dan Lisensi Pihak Ketiga

NORA menggunakan pustaka dan aset berikut. Semua aset frontend disimpan lokal
di `frontend/vendor/` agar aplikasi tidak bergantung pada CDN saat demo.

---

## 1. Aset Frontend

| Aset | Versi | Lisensi | Sumber | Lokasi |
| --- | --- | --- | --- | --- |
| Three.js | r128 | MIT | <https://github.com/mrdoob/three.js> | `frontend/vendor/three.min.js` |
| OrbitControls | r128 (examples) | MIT | <https://github.com/mrdoob/three.js/tree/r128/examples/js/controls> | `frontend/vendor/OrbitControls.js` |
| Tailwind CSS | 3.4.16 (Play CDN build) | MIT | <https://tailwindcss.com> | `frontend/vendor/tailwind.js` |
| Lucide | 0.468.0 | ISC | <https://lucide.dev> | `frontend/vendor/lucide.min.js` |
| Inter | 5.0.18 (@fontsource) | SIL Open Font License 1.1 | <https://github.com/rsms/inter> | `frontend/vendor/fonts/inter-*.woff2` |

Catatan:

- Three.js memuat header lisensi MIT di dalam file.
- Lucide memuat header lisensi ISC di dalam file.
- Tailwind Play CDN build ditujukan untuk prototipe. Untuk produksi jangka
  panjang, pertimbangkan build Tailwind yang di-purge. Untuk demo hackathon,
  file lokal ini memastikan styling tetap bekerja offline.
- Font Inter diambil dari paket `@fontsource/inter` versi 5.0.18, subset latin,
  bobot 400/500/600/700.

### Teks lisensi ringkas

**MIT License** (Three.js, OrbitControls, Tailwind CSS, dan pustaka Python yang
memakai MIT): izin diberikan secara gratis untuk menggunakan, menyalin,
memodifikasi, menggabungkan, menerbitkan, mendistribusikan, mensublisensikan,
dan/atau menjual salinan perangkat lunak, dengan syarat pemberitahuan hak cipta
dan izin ini disertakan. Perangkat lunak disediakan "AS IS" tanpa jaminan.

**ISC License** (Lucide): izin untuk menggunakan, menyalin, memodifikasi,
dan/atau mendistribusikan perangkat lunak untuk tujuan apa pun, dengan atau
tanpa biaya, dengan syarat pemberitahuan hak cipta dan izin ini disertakan.
Perangkat lunak disediakan "AS IS".

**SIL Open Font License 1.1** (Inter): font boleh digunakan, dipelajari,
dimodifikasi, dan didistribusikan secara bebas, termasuk untuk tujuan komersial,
selama font yang dimodifikasi tidak memakai nama reserved dan tidak dijual
sendiri. Salinan lisensi lengkap disediakan oleh proyek Inter.

---

## 2. Pustaka Backend (Python)

| Pustaka | Lisensi | Sumber |
| --- | --- | --- |
| FastAPI | MIT | <https://github.com/fastapi/fastapi> |
| Starlette | BSD-3-Clause | <https://github.com/encode/starlette> |
| Uvicorn | BSD-3-Clause | <https://github.com/encode/uvicorn> |
| Pydantic | MIT | <https://github.com/pydantic/pydantic> |
| python-multipart | Apache-2.0 | <https://github.com/Kludex/python-multipart> |
| httpx | BSD-3-Clause | <https://github.com/encode/httpx> |
| Pillow | HPND | <https://github.com/python-pillow/Pillow> |
| NumPy | BSD-3-Clause | <https://github.com/numpy/numpy> |
| OpenCV (opencv-python-headless) | Apache-2.0 | <https://github.com/opencv/opencv-python> |
| pytest | MIT | <https://github.com/pytest-dev/pytest> |

Lisensi lengkap masing-masing pustaka tersedia di repositori atau distribusi
paket yang terpasang. Tidak ada modifikasi source pustaka dalam repositori ini.

---

## 3. Dependensi Sistem

| Komponen | Lisensi | Catatan |
| --- | --- | --- |
| FFmpeg / FFprobe | LGPL-2.1+ atau GPL tergantung build | Disediakan sebagai paket sistem; tidak di-vendor |
| Python | PSF License | Base image `python:3.12-slim` |
| Debian slim | Beragam lisensi bebas | Base image Docker |

Jika Anda mendistribusikan ulang container, pastikan kewajiban lisensi FFmpeg
dan base image dipenuhi untuk build yang Anda pakai.

---

## 4. Layanan dan API

| Layanan | Peran | Ketentuan |
| --- | --- | --- |
| OpenRouter / OpenAI / Groq / provider OpenAI-compatible lainnya | Analisis vision opsional | Tunduk pada syarat dan kebijakan privasi masing-masing |
| Anthropic API | Adapter vision opsional | Tunduk pada syarat dan kebijakan privasi Anthropic |
| Ollama / LM Studio | Opsi lokal | Tunduk pada lisensi masing-masing |

NORA tidak menyertakan SDK resmi provider; panggilan dilakukan dengan `httpx`
ke endpoint HTTP yang dikonfigurasi operator.

---

## 5. Aset Karya Sendiri

- Model rumah 3D dibangun secara prosedural dengan Three.js (dinding, lantai,
  furnitur sederhana, tangga). Tidak memakai model GLTF/BLEND pihak ketiga.
- Palet warna, komponen UI, ikon kategori, dan tata letak dirancang oleh tim.
- Data rumah contoh dan graph navigasi ditulis untuk demo ini.
- Tidak ada foto stok atau video pihak ketiga di repositori. Media scan pada
  demo harus direkam sendiri.

---

## 6. Pernyataan Orisinalitas

Kode aplikasi, alur produk, dan desain antarmuka dikerjakan oleh Tim NORA untuk
Logicodex 2026. Pustaka pihak ketiga digunakan sesuai lisensinya dan tidak
diklaim sebagai karya tim. Tidak ada hasil demo yang di-hardcode atau
difabrikasi; pemindaian tanpa AI secara eksplisit menghasilkan nol temuan.

Jika Anda menambahkan aset baru (foto, musik, model 3D, atau pustaka), tambahkan
baris atribusi ke dokumen ini sebelum commit final.
