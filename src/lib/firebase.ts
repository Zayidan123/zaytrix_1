// OPT-7: Firebase removed — server-side JWT+Prisma is the single auth/storage source.
// This stub exists for backward compat with any remaining imports.
// `auth` and `db` are intentionally `null`. Code paths that previously called
// `auth.currentUser` / `auth.onAuthStateChanged` / `doc(db, ...)` must be
// migrated to server-side API calls or localStorage (see worklog OPT-7).
export const auth = null;
export const db = null;
