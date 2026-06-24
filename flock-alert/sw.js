/* FlockAlert service worker — caches the app shell so it loads offline.
 * Live camera data (Overpass/OSM) and map tiles are always fetched online
 * and are NOT cached aggressively, so data stays fresh.
 */
const CACHE = "flockalert-v8";
const SHELL = [
  "./",
  "./index.html",
  "./home.css",
  "./app.html",
  "./styles.css",
  "./config.js",
  "./app.js",
  "./routes.js",
  "./inventory.js",
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache the camera database or map tiles — always go to network.
  if (
    url.hostname.includes("overpass") ||
    url.hostname.includes("basemaps") ||
    url.hostname.includes("tile")
  ) {
    return; // default network behavior
  }

  // App shell: cache-first, fall back to network.
  if (event.request.method === "GET" && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
