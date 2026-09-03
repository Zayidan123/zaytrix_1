// =============================================================================
// httpUtils.ts — QA9-R3 (monolith refactor): shared outbound fetch helper
// with hard timeout. Extracted verbatim from server.ts (was lines 560-572).
// =============================================================================

export async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 3500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}
