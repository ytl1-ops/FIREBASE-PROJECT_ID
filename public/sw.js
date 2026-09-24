// Service worker MonMeeting : application utilisable hors ligne une fois installée.
// - pages : réseau d'abord (mises à jour immédiates), cache en secours ;
// - fichiers versionnés (assets/) : cache d'abord.
// Les appels /api/ et les ressources externes ne sont jamais mis en cache.
// Les chemins sont relatifs à l'emplacement du service worker (racine ou sous-dossier).
const CACHE = "monmeeting-v2";
const scope = new URL("./", self.location.href);
const at = (path) => new URL(path, scope).href;
const INDEX = at("index.html");
const SHELL = [at(""), INDEX, at("icon.svg"), at("manifest.webmanifest")];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(INDEX, copy));
          return response;
        })
        .catch(() => caches.match(INDEX)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && (url.href.startsWith(at("assets/")) || SHELL.includes(url.href))) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
