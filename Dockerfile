# ============================================================================
# ZAYTRIX — Production Image (Direksi A: Deployment Produksi)
# ----------------------------------------------------------------------------
# Multi-stage build:
#   1. builder  — npm ci + prisma generate + `npm run build`
#                 (vite client bundle + esbuild server.mjs → dist/)
#   2. runtime  — node:20-alpine, non-root user, tanpa source/frontend tooling
#                 source, HEALTHCHECK /api/health, graceful SIGTERM (OPT-1d).
#
# Image TIDAK memuat .env (secret di-inject via env_file docker-compose) dan
# TIDAK memuat database (SQLite hidup di volume `zaytrix-db`).
#
# Build:   docker build -t zaytrix:latest .
# Jalankan lengkap (app + Caddy + TLS otomatis): lihat deploy/docker-compose.yml
# ============================================================================

# ---------- Stage 1: builder ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Layer manifest dulu → cache dependensi tidak invalidasi tiap perubahan source
COPY package.json package-lock.json ./
RUN npm ci

# Source + generate Prisma Client (butuh prisma/schema.prisma)
COPY . .
RUN npx prisma generate

# Build produksi: client (vite → dist/assets, public/ disalin ke dist/) +
# server bundle ESM (esbuild --packages=external → dist/server.mjs)
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# SQLite path — relatif folder prisma/ → /app/db/custom.db (volume terpisah)
ENV DATABASE_URL="file:../db/custom.db"

# Non-root: container compromised ≠ root di host
RUN addgroup -S zaytrix && adduser -S zaytrix -G zaytrix

# server.mjs di-bundle dengan --packages=external → node_modules penuh dibutuhkan.
# Base image sama dengan builder → salin langsung (lebih cepat dari npm ci ulang).
COPY --from=builder /app/node_modules ./node_modules

# Artefak build: client + sw.js + manifest + icons + offline.html + server.mjs
COPY --from=builder /app/dist ./dist

# Prisma CLI + schema — dipakai entrypoint untuk sinkronisasi skema idempoten
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY package.json ./

# Entryppoint: prisma db push idempoten lalu exec server (PID 1 = node)
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
  && mkdir -p /app/db \
  && chown -R zaytrix:zaytrix /app

USER zaytrix
EXPOSE 3000

# Docker HEALTHCHECK resmi — sama dengan probe yang dipakai docker-compose.
# start-period 25s memberi ruang untuk prisma db push di boot pertama.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
