/* Godown service worker.
 * - Static build files: cache-first (they are content-hashed).
 * - Pages: network-first, falling back to the last copy so the app opens offline.
 * - API calls are never cached here; the app's own outbox handles offline writes.
 * - Push: shows reminders; tapping one opens the page it points to.
 */
const VERSION = "v3";
const STATIC = `ob-static-${VERSION}`;
const PAGES = `ob-pages-${VERSION}`;
const SHARED = "ob-shared"; // not versioned: holds items shared from WhatsApp until the user opens them
const WARM = ["/", "/order/new", "/dispatch/new", "/pending", "/inbox"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(PAGES).then((cache) =>
      Promise.all(
        WARM.map((url) =>
          fetch(url, { credentials: "include" })
            .then((res) => (res.ok && !res.redirected ? cache.put(url, res) : undefined))
            .catch(() => undefined),
        ),
      ),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC, PAGES, SHARED]);
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url0 = new URL(req.url);

  // Share target: keep what WhatsApp shared, then open the app's share screen.
  if (req.method === "POST" && url0.pathname === "/share") {
    event.respondWith(
      (async () => {
        const form = await req.formData();
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const cache = await caches.open(SHARED);
        const files = form.getAll("files").filter((f) => f && typeof f !== "string");
        const text = [form.get("title"), form.get("text"), form.get("url")].filter(Boolean).join("\n");
        const meta = { id, text, files: files.map((f, i) => ({ i, name: f.name, type: f.type })) };
        for (const [i, f] of files.entries()) await cache.put(`/shared/${id}/${i}`, new Response(f, { headers: { "content-type": f.type || "application/octet-stream", "x-name": encodeURIComponent(f.name) } }));
        await cache.put(`/shared/${id}/meta`, new Response(JSON.stringify(meta), { headers: { "content-type": "application/json" } }));
        return Response.redirect(`/share?id=${id}`, 303);
      })(),
    );
    return;
  }

  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Keep a copy of real pages (not the login redirect) for offline use.
          if (res.ok && !res.redirected && !url.pathname.startsWith("/login")) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(url.pathname, { cacheName: PAGES })) || (await caches.match("/", { cacheName: PAGES })) || Response.error()),
    );
  }
});

self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || "Godown", {
      body: msg.body || "",
      tag: msg.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: msg.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if ("focus" in w) {
          await w.focus();
          if ("navigate" in w) await w.navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
