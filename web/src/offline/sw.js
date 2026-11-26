// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Service worker. Precaches every file of this build at install; caches nothing at run
// time and never touches other origins. A new version waits until the page reports that the user accepted.
// web/offline-build.ts fills the two placeholders after the build.
const VERSION = "__PRIVORA_VERSION__";
const PRECACHE = ["__PRIVORA_PRECACHE__"];
const PREFIX = "privora-";
const CACHE = PREFIX + VERSION;

const urlOf = (path) => new URL(path, self.registration.scope).href;

async function precache() {
  const existed = await caches.has(CACHE);
  try {
    const cache = await caches.open(CACHE);
    await Promise.all(
      PRECACHE.map(async (path) => {
        const res = await fetch(urlOf(path), { cache: "reload" });
        if (!res.ok) throw new Error("precache failed");
        // A host may redirect (pretty URLs), and a redirected response cannot answer a navigation.
        const plain = res.redirected ? new Response(res.body, { status: res.status, headers: res.headers }) : res;
        await cache.put(urlOf(path), plain);
      }),
    );
  } catch (e) {
    if (!existed) await caches.delete(CACHE);
    throw e;
  }
}

async function activate() {
  // Other open tabs still run the previous build and may lazy load its files: keep old caches until
  // an activation finds at most one tab.
  const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (tabs.length <= 1) {
    const old = (await caches.keys()).filter((n) => n.startsWith(PREFIX) && n !== CACHE);
    await Promise.all(old.map((n) => caches.delete(n)));
  }
  // Take over the page that installed us, so lazy parts (PDF) work offline after the first visit.
  await self.clients.claim();
}

/** The cache key of a page navigation. Anything else goes to the network. */
function pageUrl(url) {
  const name = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (name === "" || name === "index.html") return urlOf("index.html");
  if (name === "verify" || name === "verify.html") return urlOf("verify.html");
  return url.href;
}

async function answer(request, url) {
  const key = request.mode === "navigate" ? pageUrl(url) : request.url;
  try {
    const names = [CACHE, ...(await caches.keys()).filter((n) => n.startsWith(PREFIX) && n !== CACHE)];
    for (const name of names) {
      // ignoreVary: module requests send Origin, the precache requests did not.
      const hit = await (await caches.open(name)).match(key, { ignoreVary: true });
      if (hit) return hit;
    }
  } catch {
    // Cache Storage unavailable: behave as if there were no service worker.
  }
  return fetch(request);
}

self.addEventListener("install", (event) => event.waitUntil(precache()));
self.addEventListener("activate", (event) => event.waitUntil(activate()));
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(answer(event.request, url));
});
