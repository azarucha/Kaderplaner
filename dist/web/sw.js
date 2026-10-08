// Service Worker: haelt die App-Huelle offline vor. Kickbase-Daten gehen immer
// direkt ans Netz und werden nie zwischengespeichert.
const CACHE = "kaderplaner-b894deeb29";
const SHELL = ["./", "index.html", "demo.html", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png",
  "fonts/geist.css", "fonts/geist-latin-400.woff2", "fonts/geist-latin-500.woff2", "fonts/geist-latin-600.woff2", "fonts/geist-latin-700.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Netz zuerst, damit Updates sofort ankommen; ohne Netz die gespeicherte Huelle.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
