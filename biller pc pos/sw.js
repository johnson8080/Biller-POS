/* Till POS - offline shell cache */
const VERSION = "till-v1.0.0";
const SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./manifest.json",
  "./js/daraja.js",
  "./js/notify.js",
  "./js/core.js",
  "./js/cloud.js",
  "./js/mpesa.js",
  "./js/screens.js",
  "./js/sheets.js",
  "./js/scanner.js",
  "./js/auth.js",
  "./js/app.js",
  "./assets/vendor/zxing.min.js",
  "./assets/fonts/instrument-sans-latin.woff2",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // App shell navigations: prefer the network so updates land, fall back offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html").then((cached) => cached || caches.match("./")))
    );
    return;
  }

  // Static assets: cache first, then network, and keep the cache warm.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

