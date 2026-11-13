# Deployment VPS

Panduan ini mengasumsikan satu VPS Ubuntu 22.04/24.04 dengan domain yang sudah
diarahkan ke IP VPS. Stack berjalan sebagai satu container Docker di belakang
Nginx atau Caddy.

```text
Internet → 80/443 → Nginx/Caddy → 127.0.0.1:8000 → container NORA
```

---

## 1. Prasyarat

- VPS minimal 1 vCPU, 1 GB RAM, 10 GB disk (2 GB RAM lebih nyaman untuk OpenCV).
- Ubuntu 22.04 atau 24.04.
- Domain/subdomain, misalnya `nora.contoh.com`.
- Akses SSH dengan user sudo.
- DNS A record mengarah ke IP VPS.

Cek DNS:

```bash
dig +short nora.contoh.com
```

---

## 2. Hardening Dasar

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ufw git curl
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Jangan buka port 8000 ke internet. Container hanya di-bind ke localhost.

---

## 3. Install Docker

Ikuti dokumentasi resmi Docker untuk Ubuntu, lalu pastikan:

```bash
docker --version
docker compose version
```

Tambahkan user Anda ke grup Docker (logout/login setelahnya):

```bash
sudo usermod -aG docker "$USER"
```

---

## 4. Ambil Kode dan Konfigurasi

```bash
sudo mkdir -p /opt/nora
sudo chown "$USER":"$USER" /opt/nora
git clone <URL_REPO_ANDA> /opt/nora
cd /opt/nora

cp .env.example .env
nano .env
```

Konfigurasi produksi minimal:

```dotenv
APP_ENV=production
DATA_DIR=./data

# AI opsional. Kosongkan AI_API_KEY untuk mode quality_only.
AI_PROVIDER=openai_compatible
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=google/gemini-2.5-flash
AI_API_KEY=

MAX_UPLOAD_MB=200
MAX_FILES=20
```

Catatan:

- `DATA_DIR` di dalam container dioverride menjadi `/data` oleh
  `docker-compose.yml`.
- Jangan pernah commit `.env`.
- Jika tidak memakai AI, set `AI_PROVIDER=none` untuk menghindari panggilan
  keluar.

---

## 5. Jalankan Container

```bash
cd /opt/nora
docker compose up -d --build
docker compose ps
docker compose logs -f nora
```

Cek dari VPS:

```bash
curl -fsS http://127.0.0.1:8000/api/health | python3 -m json.tool
```

Respons sehat:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "database": "ok",
  "ai": { "configured": false, "mode": "quality_only" }
}
```

Data persisten berada di volume Docker `nora_data`. Jangan gunakan
`docker compose down -v` kecuali memang ingin menghapus semua data.

---

## 6. Reverse Proxy

### Opsi A — Caddy (HTTPS otomatis)

Install Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Salin contoh:

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Ganti `nora.contoh.com` dengan domain Anda, lalu:

```bash
sudo systemctl reload caddy
sudo journalctl -u caddy -f
```

Caddy akan mengurus sertifikat Let's Encrypt secara otomatis.

### Opsi B — Nginx + Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/nora
sudo ln -s /etc/nginx/sites-available/nora /etc/nginx/sites-enabled/nora
sudo rm -f /etc/nginx/sites-enabled/default
sudo nano /etc/nginx/sites-available/nora
```

Ganti `nora.contoh.com`, lalu:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d nora.contoh.com
```

Certbot akan mengubah konfigurasi SSL dan memasang renewal timer.

Konfigurasi contoh sudah menangani:

- `client_max_body_size 210m` untuk upload media,
- `proxy_buffering off` untuk SSE,
- header `X-Forwarded-*`,
- HTTP ke HTTPS redirect.

---

## 7. Verifikasi

```bash
curl -I https://nora.contoh.com
curl -fsS https://nora.contoh.com/api/health
```

Buka di browser:

1. Badge harus **Server aktif**.
2. Coba tambah lokasi.
3. Coba scan satu foto.
4. Reset demo dari Pengaturan.
5. Pastikan tidak ada error 502/413 di log proxy.

Log:

```bash
docker compose logs -f nora
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log
# atau
sudo journalctl -u caddy -f
```

---

## 8. Backup dan Restore

### Backup volume

```bash
docker run --rm \
  -v nora_data:/data \
  -v "$PWD/backups:/backup" \
  alpine tar czf /backup/nora-$(date +%F-%H%M).tar.gz -C /data .
```

Simpan backup di luar VPS dan enkripsi bila berisi foto rumah.

### Restore

```bash
docker compose down
docker run --rm \
  -v nora_data:/data \
  -v "$PWD/backups:/backup" \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/nama-file.tar.gz -C /data"
docker compose up -d
```

Uji restore di lingkungan terpisah sebelum mengandalkannya.

---

## 9. Pembaruan Aplikasi

```bash
cd /opt/nora
git pull --ff-only
docker compose up -d --build
docker compose logs --tail=100 nora
```

Skema SQLite dibuat dengan `CREATE TABLE IF NOT EXISTS`, jadi penambahan tabel
baru aman untuk data lama. Perubahan kolom yang merusak kompatibilitas
memerlukan migrasi manual; lakukan backup sebelum upgrade.

---

## 10. Mengubah Konfigurasi AI

```bash
cd /opt/nora
nano .env
docker compose up -d
```

Restart container diperlukan karena environment dibaca saat proses mulai.

Cek status:

```bash
curl -fsS https://nora.contoh.com/api/ai/status | python3 -m json.tool
```

`configured: false` berarti pemindaian berjalan mode `quality_only`.

---

## 11. Troubleshooting

| Gejala | Penyebab umum | Solusi |
| --- | --- | --- |
| `502 Bad Gateway` | Container mati atau port salah | `docker compose ps`, `docker compose logs nora` |
| `413 Request Entity Too Large` | Batas proxy terlalu kecil | Naikkan `client_max_body_size` / `max_size` Caddy |
| Upload video gagal | FFmpeg tidak ada di image | Pastikan build ulang image; Dockerfile memasang FFmpeg |
| AI selalu `degraded` | Key/model/base URL salah | Cek `/api/ai/status`, log container, uji endpoint provider |
| SSE tidak streaming | Buffering proxy | Pastikan `proxy_buffering off` / `flush_interval -1` |
| Data hilang setelah restart | Volume tidak terpasang | Cek `docker compose config` dan volume `nora_data` |
| Database locked | Banyak worker/penulisan paralel | Jalankan satu worker, pertimbangkan PostgreSQL |
| Waktu scan lama | Video besar/resolusi tinggi | Batasi durasi video, turunkan `MAX_UPLOAD_MB` |
| Port 8000 terbuka | Bind salah | Gunakan `127.0.0.1:8000:8000` dan firewall |

---

## 12. Checklist Keamanan Sebelum Publik

- [ ] HTTPS aktif dan redirect HTTP → HTTPS.
- [ ] Port 8000 hanya localhost.
- [ ] Autentikasi dasar/SSO/VPN aktif; aplikasi belum punya login.
- [ ] `.env` tidak dapat diakses lewat web.
- [ ] Firewall hanya membuka 22/80/443.
- [ ] Backup terenkripsi dan diuji.
- [ ] Retensi media ditetapkan.
- [ ] API key dirotasi jika pernah terekspos.
- [ ] Log tidak memuat isi gambar atau token.
- [ ] `bash scripts/check_repo_hygiene.sh` bersih sebelum deploy.

---

## 13. Catatan Skala

Deployment ini cocok untuk demo dan satu rumah. Untuk banyak rumah/pengguna:

- tambahkan autentikasi dan otorisasi per rumah,
- pindahkan job scan ke worker/queue terpisah,
- gunakan PostgreSQL,
- simpan media di object storage dengan signed URL,
- tambahkan rate limit dan observability.

Itu di luar cakupan MVP dan tidak diklaim sudah tersedia.
