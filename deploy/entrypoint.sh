#!/bin/sh
# ============================================================================
# ZAYTRIX — container entrypoint (Direksi A)
# ----------------------------------------------------------------------------
# 1. Sinkronisasi skema SQLite secara IDEMPOTEN (prisma db push):
#      - boot pertama     → membuat seluruh tabel di volume kosong
#      - boot berikutnya  → no-op bila skema sudah sinkron
#      - perubahan aditif (kolom/model baru) → diterapkan otomatis, data aman
#      - perubahan destruktif → prisma GAGAL nyaring (exit != 0) → container
#        menolak hidup — lebih jujur daripada diam-diam menghapus data.
# 2. exec node dist/server.mjs → server menjadi PID 1, menerima SIGTERM
#    langsung dari Docker (graceful shutdown OPT-1d: drain request + tutup WS).
# ============================================================================
set -e

echo "[entrypoint] sinkronisasi skema database (prisma db push)..."
npx prisma db push --skip-generate

echo "[entrypoint] memulai ZAYTRIX server (NODE_ENV=production)..."
exec node dist/server.mjs
