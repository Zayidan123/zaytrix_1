#!/usr/bin/env node
// ============================================================================
// ZAYTRIX — Admin CLI: ubah paket langganan user (Direksi F · QA11-F)
// ----------------------------------------------------------------------------
// Integrasi pembayaran sengaja BELUM ada (keputusan bisnis operator) —
// perubahan paket dilakukan eksplisit lewat CLI ini dari server/VPS:
//
//   node scripts/set-plan.mjs <email> <free|pro|team>
//   DATABASE_URL="file:../db/custom.db" node scripts/set-plan.mjs user@mail.id pro
//
// Idempoten (jalankan ulang dengan plan sama = no-op jujur). Menulis AuditLog
// manual tidak dilakukan di sini — operator CLI berjalan dengan akses DB penuh
// (sama seperti prisma studio); jejak ada di riwayat shell + updatedAt user.
// ============================================================================
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const VALID = ["free", "pro", "team"];

const [,, emailArg, planArg] = process.argv;

if (!emailArg || !planArg) {
  console.error("Pemakaian: node scripts/set-plan.mjs <email> <free|pro|team>");
  console.error("Contoh : node scripts/set-plan.mjs user@mail.id pro");
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const plan = planArg.trim().toLowerCase();

if (!VALID.includes(plan)) {
  console.error(`Plan tidak valid: "${planArg}" — harus salah satu dari: ${VALID.join(", ")}`);
  process.exit(1);
}

try {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, plan: true, displayName: true } });
  if (!user) {
    console.error(`User dengan email "${email}" tidak ditemukan.`);
    process.exit(1);
  }
  if (user.plan === plan) {
    console.log(`No-op: user ${email} sudah berada di paket "${plan}".`);
    process.exit(0);
  }
  await prisma.user.update({ where: { id: user.id }, data: { plan } });
  console.log(`OK: ${email} (${user.displayName || "tanpa nama"}) → paket "${plan}".`);
  console.log("Kuota AI baru berlaku SEGERA (dibaca per-request, tanpa restart).");
} catch (e) {
  console.error("Gagal mengubah paket:", e?.message || e);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
