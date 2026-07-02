// Centralized Prisma client singleton for the ZAYTRIX backend.
// Importing from here guarantees we reuse a single PrismaClient instance
// (and a single underlying SQLite connection pool) across all server modules
// — security middleware, auth routes, audit logger, API key endpoints.
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __zaytrixPrisma: PrismaClient | undefined;
}

// Reuse the existing client on hot-reload in dev to avoid leaking handles.
export const prisma =
  globalThis.__zaytrixPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__zaytrixPrisma = prisma;
}
