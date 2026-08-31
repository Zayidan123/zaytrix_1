#!/usr/bin/env bash
# ============================================================================
# ZAYTRIX — Purge db/custom.db dari SELURUH git history (aksi pasca-insiden
# SEC-1, KRITIS).
# ----------------------------------------------------------------------------
# LATAR BELAKANG
#   File db/custom.db pernah di-commit ke repositori publik dan memuat
#   kredensial nyata (102 email + hash bcrypt + 103 hash token). File sudah
#   di-untrack (commit f81d33d) dan .gitignore sudah mengunci folder db/,
#   TETAPI blob lama MASIH ada di dalam history — siapa pun yang meng-clone
#   repo dapat membuka riwayat dan membaca file tersebut.
#
#   Script ini menjalankan `git filter-repo` untuk membuang path db/ dari
#   semua commit, lalu memandu force-push.
#
# PRASYARAT
#   1. Python 3.5+  : pip install git-filter-repo
#      (atau: pipx install git-filter-repo / apt/brew sesuai platform)
#   2. Backup! git filter-repo MENULIS ULANG history — fork/clone lain akan
#      diverifikasi ulang. Buat salinan folder sebelum lanjut:
#        cp -a zaytrix_1 zaytrix_1-backup
#
# PENGGUNAAN
#   bash scripts/purge-db-from-history.sh          # jalankan purge + verifikasi
#   bash scripts/purge-db-from-history.sh --push   # purge + force-push ke origin
#
# SETELAH SELESAI (WAJIB, tidak bisa dilakukan script ini):
#   1. Rotasi password SEMUA user lama (kredensial pernah publik).
#   2. Hapus semua baris tabel Session + rotasi SESSION_SECRET /
#      ENCRYPTION_KEY / CSRF_SECRET di .env produksi.
#   3. Minta kolaborator re-clone (history lama tidak lagi valid).
#   4. GitHub masih menyimpan blob di reflog internal selama ~90 hari —
#      hubungi GitHub Support untuk garbage-collection dini bila perlu.
# ============================================================================
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: jalankan script ini dari dalam repositori git ZAYTRIX."
  exit 1
}

DO_PUSH=0
[[ "${1:-}" == "--push" ]] && DO_PUSH=1

echo "== ZAYTRIX history purge: db/custom.db (SEC-1) =="

# ── 1. Prasyarat ────────────────────────────────────────────────────────────
if ! command -v git-filter-repo >/dev/null 2>&1; then
  cat <<'EOF'
ERROR: git-filter-repo tidak ditemukan.

Instalasi:
  pip install --user git-filter-repo     # lalu pastikan ~/.local/bin ada di PATH
  pipx install git-filter-repo           # alternatif
  brew install git-filter-repo           # macOS

Setelah terinstal, jalankan ulang script ini.
EOF
  exit 1
fi

# ── 2. Cek apakah path db/ memang ada di history ───────────────────────────
COUNT=$(git log --all --oneline -- db/custom.db db/*.db 2>/dev/null | wc -l | tr -d ' ')
if [[ "$COUNT" -eq 0 ]]; then
  echo "OK: tidak ada commit yang menyentuh db/*.db — history sudah bersih."
  exit 0
fi
echo "Ditemukan $COUNT commit yang menyentuh db/*.db — akan dibersihkan."

# ── 3. Backup branch (pengaman) ────────────────────────────────────────────
BACKUP_REF="pre-purge-backup-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP_REF" 2>/dev/null || true
echo "Backup lokal dibuat: $BACKUP_REF (hapus manual setelah yakin aman)."

# ── 4. Purge ───────────────────────────────────────────────────────────────
#   --path db/       : target path yang dibuang
#   --invert-paths   : artinya "hapus path ini" (bukan pertahankan)
#   --force          : terima repo non-fresh-clone (backup manual sudah dibuat)
echo "Menjalankan git filter-repo (ini menulis ulang seluruh history) ..."
git filter-repo --force --invert-paths --path db/

# filter-repo menghapus remote 'origin' demi keamanan — pasang ulang bila ada
if ! git remote get-url origin >/dev/null 2>&1; then
  cat <<'EOF'
CATATAN: git filter-repo menghapus remote 'origin' (perilaku default).
Pasang ulang sebelum push:
  git remote add origin https://github.com/Zayidan123/zaytrix_1.git
EOF
fi

# ── 5. Verifikasi ──────────────────────────────────────────────────────────
AFTER=$(git log --all --oneline -- db/custom.db db/*.db 2>/dev/null | wc -l | tr -d ' ')
if [[ "$AFTER" -eq 0 ]]; then
  echo "VERIFIKASI OK: db/*.db tidak lagi ada di history manapun."
else
  echo "PERINGATAN: masih ada $AFTER commit yang menyentuh db/*.db — periksa manual."
  exit 2
fi

# ── 6. Push (opsional) ─────────────────────────────────────────────────────
if [[ "$DO_PUSH" -eq 1 ]]; then
  if git remote get-url origin >/dev/null 2>&1; then
    echo "Force-push ke origin (main) ..."
    git push --force origin main
    echo "Push selesai. Jangan lupa langkah pasca-insiden (lihat header script)."
  else
    echo "Remote origin belum dipasang — pasang lalu push manual:"
    echo "  git remote add origin https://github.com/Zayidan123/zaytrix_1.git"
    echo "  git push --force origin main"
  fi
else
  echo ""
  echo "Selesai (mode lokal). Ketika siap, jalankan:"
  echo "  bash scripts/purge-db-from-history.sh --push"
  echo "atau push manual dengan --force."
fi
