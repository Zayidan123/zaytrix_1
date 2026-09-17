# ZAYTRIX — Runbook Deployment Produksi (Direksi A)

> Stack: **Docker (multi-stage) + Caddy (TLS otomatis + proxy SSE/WS-aware) +
> SQLite volume persisten**. Semua artefak ada di repo:
> `Dockerfile` · `deploy/Caddyfile` · `deploy/docker-compose.yml` ·
> `deploy/entrypoint.sh` · `.github/workflows/ci.yml`.

## Arsitektur

```
Internet ──▶ Caddy :80/:443 ──▶ app :3000 (node dist/server.mjs)
             │  TLS otomatis       │
             │  flush SSE frame    ├── volume zaytrix-db (SQLite)
             │  WS upgrade auto    └── entrypoint: prisma db push (idempoten)
```

Keputusan desain penting:

| Aspek | Keputusan | Alasan |
|---|---|---|
| Reverse proxy | Caddy 2 | TLS ACME otomatis, WS otomatis, `flush_interval -1` untuk SSE (8 endpoint AI streaming kontrak QA8-C) |
| Runtime | `node:20-alpine` + `dist/server.mjs` (esbuild ESM, packages external) | Bundle server satu file; mode `NODE_ENV=production` menyajikan `dist/` statis + SPA fallback |
| Database | SQLite di named volume `zaytrix-db` | Nol dependensi eksternal; backup = salin satu file; entrypoint menjalankan `prisma db push` idempoten tiap boot (destruktif → container menolak hidup, bukan hapus data diam-diam) |
| User | non-root `zaytrix` | Container compromised ≠ root di host |
| Healthcheck | `GET /api/health` | Endpoint yang sama dipakai smoke test & monitoring |
| Graceful shutdown | SIGTERM → drain request + tutup WS (OPT-1d) | Tanpa dropped connection saat `docker compose restart` |

## Prasyarat VPS

1. VPS Ubuntu/Debian dengan **Docker Engine + docker compose plugin**
   (`curl -fsSL https://get.docker.com | sh`).
2. DNS **A-record** domain (mis. `app.zaytrix.id`) → IP publik VPS.
3. Port 80 + 443 terbuka di firewall VPS (`ufw allow 80,443/tcp`).

## Langkah Deploy

```bash
# 1. Clone repo di VPS
git clone https://github.com/Zayidan123/zaytrix_1.git && cd zaytrix_1

# 2. Siapkan secret (JANGAN pernah commit file ini)
cp .env.example .env
#    Isi minimal: SESSION_SECRET, ENCRYPTION_KEY, CSRF_SECRET (openssl rand -hex),
#    OPENROUTER_API_KEY, dan:
#    APP_URL="https://app.zaytrix.id"     ← CORS allowlist + link email
#    MAX_ORDER_NOTIONAL_USD=50000

# 3. Naikkan stack (build image + Caddy + volume db)
cd deploy
ZAYTRIX_DOMAIN=app.zaytrix.id \
ZAYTRIX_ACME_EMAIL=ops@zaytrix.id \
docker compose up -d --build

# 4. Verifikasi
docker compose ps                # keduanya healthy
curl -f https://app.zaytrix.id/api/health
docker compose logs -f app       # lihat boot + prisma db push
```

Uji coba **tanpa domain** (localhost, CTTY self-signed internal):
hilangkan `ZAYTRIX_DOMAIN` — stack default ke `localhost` mode uji.

## Operasional

| Aksi | Perintah |
|---|---|
| Update ke commit terbaru | `git pull && cd deploy && docker compose up -d --build` |
| Lihat log | `docker compose logs -f app` (JSON logger modular) |
| Backup DB | `docker run --rm -v deploy_zaytrix-db:/db -v $PWD:/out alpine sh -c "cp /db/custom.db /out/backup-$(date +%F).db"` |
| Restore DB | stop stack → salin file balik ke volume → start (SELALU uji di staging dulu) |
| Restart | `docker compose restart app` (graceful: drain + tutup WS) |
| Turunkan stack | `docker compose down` (volume db TETAP ada; `down -v` menghapus data!) |

## Keamanan Produksi (wajib baca)

1. **Rotasi secret** sebelum go-live jika repo ini pernah dipakai di mesin
   bersama — lihat seksi Roadmap README ("hutang keamanan").
2. `.env` hanya lewat `env_file` docker compose — image TIDAK memuatnya
   (`.dockerignore` mengecualikan `.env*` dan `db/`).
3. Rate-limit & helmet aktif di aplikasi (lapisan dalam), header tambahan
   dipasang Caddy (lapisan tepi) — defense in depth.
4. CI GitHub Actions menjalankan lint → test → build untuk setiap push ke
   `main`; deploy manual dari commit hijau.

## Pemecahan Masalah

| Gejala | Diagnosis |
|---|---|
| Container `app` exit kode non-zero saat boot | `prisma db push` menolak perubahan destruktif — baca `docker compose logs app`; jangan paksa `--force-reset` di produksi tanpa backup |
| Caddy error ACME / sertifikat | Cek DNS A-record + port 80/443 terbuka; `docker compose logs caddy` |
| AI streaming macet di tengah | Pastikan tidak ada proxy tambahan di depan Caddy yang buffer SSE; `flush_interval -1` sudah aktif di `deploy/Caddyfile` |
| Whale radar WS PUTUS terus | Egress VPS ke `stream.binance.com:9443` diblok? Cek `docker compose exec app node -e "..."` atau firewall keluar |
| 502 dari Caddy | `app` belum healthy — `docker compose ps`; healthcheck butuh ±25 dtk saat boot pertama (prisma db push) |
