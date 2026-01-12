/* eslint-disable no-restricted-globals */
const CACHE_NAME = "yt-playlists-pwa-v1";
const CORE_ASSETS = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/maskable.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE_ASSETS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

function isCacheableResponse(resp) {
  if (!resp) return false;
  if (resp.status !== 200) return false;
  if (resp.type === "opaque") return false;
  return true;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // SPA navigation fallback
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match("/");
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (isCacheableResponse(fresh)) cache.put("/", fresh.clone());
          return fresh;
        } catch {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Only cache same-origin assets (built JS/CSS, icons, etc.)
  if (!sameOrigin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;

      const resp = await fetch(req);
      if (isCacheableResponse(resp)) cache.put(req, resp.clone());
      return resp;
    })()
  );
});

