const CACHE = "margin-shell-v8";
const FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./api.js",
  "./session.js",
  "./config.js",
  "./settings.js",
  "./auth.js",
  "./preparation.js",
  "./db.js",
  "./schema.js",
  "./demo.js",
  "./icon.svg",
  "./fonts/manrope.ttf",
  "./fonts/condensed.ttf",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(FILES))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("margin-shell-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const r = event.request,
    u = new URL(r.url);
  u.hash = "";
  if (
    r.method !== "GET" ||
    u.origin !== self.location.origin ||
    !u.href.startsWith(self.registration.scope)
  )
    return;
  const allowed = FILES.some(
    (f) => new URL(f, self.registration.scope).href === u.href,
  );
  if (!allowed) return;
  event.respondWith(
    fetch(r)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(u.href, copy));
        }
        return response;
      })
      .catch(() => caches.match(u.href).then((c) => c || Response.error())),
  );
});
