/**
 * FUNC-14: Vitest globalSetup — test suite self-booting.
 * ------------------------------------------------------
 * Sebelumnya suite integrasi (`bun run test`) mengharuskan server ZAYTRIX
 * berjalan manual di port 3000 (`bun run dev` di terminal lain). Setup ini
 * menghilangkan kebutuhan itu:
 *
 *   1. Jika `.env` TIDAK ada (fresh checkout / CI), setup membuat `.env`
 *      sementara dengan secret acak yang kuat + DATABASE_URL default.
 *      File dihapus lagi saat teardown (tidak menyentuh .env milik user).
 *   2. Men-spawn server (`tsx server.ts`) pada port test.
 *   3. Menunggu endpoint /health siap (timeout 60 detik, polling 500 ms).
 *   4. Teardown: SIGTERM → SIGKILL, hapus .env sementara bila dibuat setup.
 *
 * Port test:
 *   - Default 3000 (konsisten dengan BASE di file test).
 *   - Override: ZAYTRIX_TEST_PORT=4170 bun run test
 *     (berguna bila 3000 dipakai aplikasi lain — file test membaca env yang
 *     sama, jadi selalu konsisten).
 *
 * Jika server sudah berjalan di port tersebut (mis. dev aktif), spawn anak
 * akan gagal EADDRINUSE tetapi health-check tetap berhasil ke server yang
 * sudah ada — suite lalu berjalan terhadap server itu (perilaku lama).
 */

import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PORT = process.env.ZAYTRIX_TEST_PORT || "3000";
const HEALTH_URL = `http://localhost:${PORT}/health`;
const ENV_PATH = path.resolve(process.cwd(), ".env");

let serverProcess: ChildProcess | null = null;
let createdEnvFile = false;

function log(msg: string): void {
  console.log(`[globalSetup] ${msg}`);
}

/** Pastikan .env ada; bila tidak, buat dengan secret acak (dihapus saat teardown). */
function ensureEnvFile(): void {
  if (fs.existsSync(ENV_PATH)) {
    log(".env ditemukan — memakai environment developer apa adanya.");
    return;
  }
  const sessionSecret = crypto.randomBytes(48).toString("hex");
  const encryptionKey = crypto.randomBytes(32).toString("hex");
  const csrfSecret = crypto.randomBytes(32).toString("hex");
  const content = [
    "# TEMPORARY — dibuat otomatis oleh vitest globalSetup (dihapus saat teardown)",
    `DATABASE_URL="file:../db/custom.db"`,
    `SESSION_SECRET="${sessionSecret}"`,
    `ENCRYPTION_KEY="${encryptionKey}"`,
    `CSRF_SECRET="${csrfSecret}"`,
    `GEMINI_API_KEY=""`,
    `EMAIL_DEV_MODE="true"`,
    `APP_URL="http://localhost:${PORT}"`,
    `PORT="${PORT}"`,
    "",
  ].join("\n");
  fs.writeFileSync(ENV_PATH, content, { encoding: "utf-8" });
  createdEnvFile = true;
  log(".env sementara dibuat dengan secret acak (dihapus saat teardown).");
}

/** Tunggu /health mengembalikan 200 (atau non-404) hingga timeoutMs. */
async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // belum siap — coba lagi
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function setup(): Promise<void> {
  ensureEnvFile();

  // FUNC-14/WAL: SQLite default journal=delete hanya mengizinkan satu penulis
  // eksklusif — server test dan server dev yang berjalan bersamaan akan saling
  // mengunci (session.create gagal "database is locked"). WAL mengizinkan
  // pembaca konkuren + satu penulis; pengaturan ini persisten di file DB dan
  // tidak berbahaya bila sudah aktif.
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000");
    await prisma.$disconnect();
    log("SQLite WAL mode + busy_timeout diaktifkan.");
  } catch (e: any) {
    log(`WAL pragma dilewati (${e?.message || e}) — server tetap dicoba.`);
  }

  log(`men-spawn server di port ${PORT} ...`);
  serverProcess = spawn("npx", ["tsx", "server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  serverProcess.stdout?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) log(`[server] ${line.slice(0, 160)}`);
  });
  serverProcess.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) log(`[server:err] ${line.slice(0, 160)}`);
  });
  serverProcess.on("exit", (code) => {
    log(`proses server keluar dengan kode ${code}`);
  });

  const healthy = await waitForHealth(60_000);
  if (!healthy) {
    // Bisa jadi server dev sudah berjalan di port yang sama (EADDRINUSE) dan
    // health-check-nya seharusnya tetap berhasil; kalau tidak, gagalkan.
    log("PERINGATAN: /health tidak siap dalam 60 detik. Test kemungkinan akan gagal.");
    if (serverProcess.exitCode === null) {
      // masih hidup tapi belum sehat — biarkan tetap berjalan, mungkin lambat.
    }
  } else {
    log(`server sehat di ${HEALTH_URL} — siap menjalankan test.`);
  }
}

export async function teardown(): Promise<void> {
  if (serverProcess && serverProcess.exitCode === null) {
    log("menghentikan server test (SIGTERM) ...");
    serverProcess.kill("SIGTERM");
    // beri kesempatan graceful shutdown (menutup WS + Prisma)
    await new Promise((r) => setTimeout(r, 2500));
    if (serverProcess.exitCode === null) {
      log("server belum berhenti — SIGKILL.");
      serverProcess.kill("SIGKILL");
    }
  }
  if (createdEnvFile && fs.existsSync(ENV_PATH)) {
    fs.rmSync(ENV_PATH);
    log(".env sementara dihapus.");
  }
  log("teardown selesai.");
}
