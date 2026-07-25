const CACHE_NAME = "workflow-controller-v14";
const SHELL_ASSETS = [
  "/workflow/",
  "/workflow/index.html",
  "/workflow/manifest.json",
  "/workflow/icons/icon-192.png",
  "/workflow/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never intercept Firestore writes etc.

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let Firebase/Firestore requests pass straight through

  const isNavigation = req.mode === "navigate" || url.pathname.endsWith("index.html") || url.pathname === "/workflow/";
  const isHashedAsset = url.pathname.includes("/assets/");

  if (isNavigation) {
    // Always try to get the latest app shell; fall back to cache only when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req))
    );
  } else if (isHashedAsset) {
    // Vite's built JS/CSS filenames are content-hashed, so a given URL's
    // content never changes — safe (and fast) to cache aggressively.
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        return res;
      }))
    );
  } else {
    // Manifest, icons, anything else same-origin: cache-first with network fallback.
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});
