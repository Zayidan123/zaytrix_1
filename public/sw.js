/* ==========================================================================
   ZAYTRIX Service Worker — QA10-D (Direksi E Roadmap: PWA)
   --------------------------------------------------------------------------
   Service worker KLASIK (pola self.addEventListener, plain JS statis —
   bukan module bundler). Strategi cache per kategori request:

     (a) Navigasi halaman (request.mode "navigate") → NETWORK-FIRST:
         sukses disimpan ke PAGES_CACHE (hanya status 200 + type "basic"),
         gagal/reject → salinan halaman di PAGES_CACHE → fallback offline.html.
     (b) /api/* (termasuk SSE data pasar real-time) → PASSTHROUGH PENUH:
         TIDAK pernah di-intercept & TIDAK pernah di-cache. Integritas data
         aplikasi: harga/whale/AI harus selalu network — API gagal = UI jujur
         offline, bukan cache basi. (WebSocket tidak melewati fetch handler
         sama sekali; passthrough /api/* menjamin jalur data real-time tidak
         pernah tersentuh SW.)
     (c) Aset statis same-origin (/assets/*, /icons/*, /logo*, manifest,
         robots.txt, offline.html) → STALE-WHILE-REVALIDATE.
     (d) Respons SSE (Content-Type "text/event-stream") → TIDAK PERNAH
         di-cache (guard dipakai di SEMUA branch yang menulis cache).
     (e) Cross-origin → passthrough default browser.
   ========================================================================== */

const VERSION = "zaytrix-static-v1";
const STATIC_CACHE = "zx-static-" + VERSION;
const PAGES_CACHE = "zx-pages-" + VERSION;

/* Aset yang di-precache saat install — cukup untuk halaman offline mandiri.
   Aset build Vite yang di-hash (/assets/*) SENGAJA tidak di-precache karena
   namanya berubah tiap build (precache akan cepat basi); aset tersebut
   di-handle lewat stale-while-revalidate saat runtime. */
const PRECACHE_URLS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
];

/* Guard (d): deteksi respons SSE — tidak boleh PERNAH masuk cache. */
function isEventStream(response) {
  try {
    const ct = (response.headers && response.headers.get("content-type")) || "";
    return ct.toLowerCase().indexOf("text/event-stream") !== -1;
  } catch (err) {
    return false;
  }
}

/* Respons yang layak cache: status 200 + type "basic" (same-origin, non
   opaque) + bukan SSE. Dipakai di semua branch penulisan cache. */
function isCacheable(response) {
  return (
    response &&
    response.status === 200 &&
    response.type === "basic" &&
    !isEventStream(response)
  );
}

/* ── INSTALL: precache dengan fault-isolation per aset ────────────────────
   cache.addAll bersifat all-or-nothing: SATU aset gagal diunduh =
   seluruh install gagal dan SW lama tetap aktif. Solusi: setiap aset
   di-cache dengan cache.add TERPISAH di dalam Promise.all, masing-masing
   dibungkus .catch — kegagalan satu aset hanya menjadi warning, tidak
   merusak install. */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn("[SW] Precache gagal (aset dilewati):", url, err);
          })
        )
      );
    })
  );
  // Aktivasi SW baru segera, tanpa menunggu tab lama ditutup.
  self.skipWaiting();
});

/* ── ACTIVATE: bersihkan cache lama + klaim klien ──────────────────────────
   Hapus semua cache milik ZAYTRIX (prefix "zx-") yang bukan versi sekarang
   (STATIC_CACHE maupun PAGES_CACHE) agar storage tidak menumpuk antar rilis. */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter(
              (key) =>
                key.indexOf("zx-") === 0 &&
                key !== STATIC_CACHE &&
                key !== PAGES_CACHE
            )
            .map((key) => caches.delete(key))
        );
      })
      .then(() => self.clients.claim())
  );
});

/* ── (a) Navigasi halaman: NETWORK-FIRST + fallback bertingkat ─────────────
   Sederhana & andal: fetch biasa + .catch fallback (tanpa race timeout).
   - Sukses → respons dikembalikan & salinan (clone) disimpan ke PAGES_CACHE
     untuk fallback kunjungan offline berikutnya.
   - Gagal/reject (offline / koneksi diputus) → salinan halaman dari
     PAGES_CACHE → offline.html dari STATIC_CACHE → dokumen HTML darurat. */
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      try {
        const cache = await caches.open(PAGES_CACHE);
        // clone() WAJIB dipanggil sebelum body dipakai pemanggil.
        await cache.put(request, response.clone());
      } catch (err) {
        // Gagal menyimpan ke cache tidak boleh merusak respons asli.
        console.warn("[SW] Gagal menyimpan halaman ke cache:", err);
      }
    }
    return response;
  } catch (err) {
    // Network gagal — cari fallback dari cache, jangan lempar error ke UI.
    const cached = await caches.match(request, { cacheName: PAGES_CACHE });
    if (cached) return cached;
    const offline = await caches.match("/offline.html", {
      cacheName: STATIC_CACHE,
    });
    if (offline) return offline;
    // Precache offline.html gagal total → dokumen darurat minimal.
    return new Response(
      '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>ZAYTRIX — Offline</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#020617;color:#d4d4d8;font-family:system-ui,sans-serif;text-align:center;padding:1.5rem"><p>ZAYTRIX — koneksi terputus dan halaman offline tidak tersedia di cache.</p></body></html>',
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

/* ── (c) Aset statis same-origin: STALE-WHILE-REVALIDATE ───────────────────
   - Ada salinan cache → kembalikan SEKARANG (stale) sambil fetch background
     memperbarui cache untuk kunjungan berikutnya.
   - Tidak ada salinan → fetch network; respons 200 basic masuk cache.
   - Network gagal dan cache kosong → respons 504 netral. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  // Pembaruan background: kegagalan diabaikan — cache lama tetap valid dipakai.
  const networkFetch = fetch(request)
    .then((response) => {
      if (isCacheable(response)) {
        // .catch terpisah: gagal cache.put tidak membatalkan respons network.
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const fresh = await networkFetch;
  if (fresh) return fresh;
  return new Response("", { status: 504, statusText: "Offline (ZAYTRIX SW)" });
}

/* ── FETCH: routing per kategori request ─────────────────────────────────── */
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Hanya GET yang di-handle. Non-GET (login, order trading, sync portfolio,
  // logout, dsb.) → default network browser: mutasi tidak boleh pernah
  // disajikan dari cache.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return; // URL tidak terparse → passthrough default.
  }

  // (b) Semua path /api* same-origin (REST + SSE data pasar) → JANGAN
  // intercept sama sekali: return = passthrough network murni.
  if (url.origin === self.location.origin && url.pathname.indexOf("/api") === 0) {
    return;
  }

  // (e) Cross-origin → passthrough penuh (browser default, tanpa cache SW).
  if (url.origin !== self.location.origin) {
    return;
  }

  // (a) Navigasi halaman (HTML) → network-first + fallback offline.
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  // (c) Aset statis same-origin → stale-while-revalidate.
  if (
    url.pathname.indexOf("/assets/") === 0 ||
    url.pathname.indexOf("/icons/") === 0 ||
    url.pathname.indexOf("/logo") === 0 ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/robots.txt" ||
    url.pathname === "/offline.html"
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Path same-origin lain di luar kategori di atas → passthrough network.
});
