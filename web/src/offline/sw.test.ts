// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// The real service worker file, built by the real manifest step, run against an in-memory Cache Storage.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { writeOfflineFiles } from "../../offline-build.ts";

const ORIGIN = "https://privora.example.test";
const template = readFileSync(join(import.meta.dirname, "sw.js"), "utf8");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function build(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "privora-sw-"));
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  writeOfflineFiles(dir, template);
  return dir;
}
const FILES = { "index.html": "<p>app</p>", "verify.html": "<p>verify</p>", "assets/a.js": "a", "pdfjs/cmaps/x.bcmap": "m", _headers: "/*" };

describe("offline build", () => {
  it("writes a sorted SHA-256 manifest of every file but itself", () => {
    const dir = build(FILES);
    const m = JSON.parse(readFileSync(join(dir, "hashes.json"), "utf8")) as { files: { path: string; sha256: string; bytes: number; served: boolean }[] };
    expect(m.files.map((f) => f.path)).toEqual(["_headers", "assets/a.js", "index.html", "pdfjs/cmaps/x.bcmap", "sw.js", "verify.html"]);
    for (const f of m.files) {
      const bytes = readFileSync(join(dir, f.path));
      expect(f.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(f.bytes).toBe(bytes.length);
      expect(f.served).toBe(f.path !== "_headers");
    }
  });
  it("is deterministic, and the version changes with any file", () => {
    const sw = (d: string) => readFileSync(join(d, "sw.js"), "utf8");
    expect(sw(build(FILES))).toBe(sw(build(FILES)));
    expect(sw(build(FILES))).not.toBe(sw(build({ ...FILES, "assets/a.js": "b" })));
    expect(sw(build(FILES))).not.toContain("__PRIVORA");
  });
  it("refuses a template without its placeholders", () => {
    const dir = build(FILES);
    expect(() => writeOfflineFiles(dir, "// nothing to fill")).toThrow();
  });
});

/** Just enough of the service worker globals, backed by maps. */
function world(dir: string, store = new Map<string, Map<string, Response>>()) {
  const listeners = new Map<string, (e: unknown) => void>();
  const network: string[] = [];
  const state = { skipped: 0, claimed: 0, clients: 1, fail: "", redirect: false, broken: false };
  const cacheOf = (name: string) => {
    const m = store.get(name) ?? new Map<string, Response>();
    store.set(name, m);
    return {
      put: async (k: string, r: Response) => void m.set(String(k), r),
      match: async (k: string) => m.get(String(k))?.clone(),
    };
  };
  const caches = {
    open: async (n: string) => {
      if (state.broken) throw new Error("storage unavailable");
      return cacheOf(n);
    },
    keys: async () => [...store.keys()],
    has: async (n: string) => store.has(n),
    delete: async (n: string) => store.delete(n),
  };
  const fetchFake = async (input: string | { url: string }) => {
    const url = typeof input === "string" ? input : input.url;
    network.push(url);
    const path = url.slice(ORIGIN.length + 1);
    if (state.fail && path === state.fail) return new Response("no", { status: 404 });
    let body: Buffer;
    try {
      body = readFileSync(join(dir, path));
    } catch {
      return new Response("net", { status: 200 });
    }
    const res = new Response(new Uint8Array(body));
    if (state.redirect && path === "verify.html") Object.defineProperty(res, "redirected", { value: true });
    return res;
  };
  const self = {
    addEventListener: (t: string, f: (e: unknown) => void) => void listeners.set(t, f),
    registration: { scope: `${ORIGIN}/` },
    location: new URL(`${ORIGIN}/sw.js`),
    skipWaiting: async () => void (state.skipped += 1),
    clients: { claim: async () => void (state.claimed += 1), matchAll: async () => Array.from({ length: state.clients }, () => ({})) },
  };
  vm.runInNewContext(readFileSync(join(dir, "sw.js"), "utf8"), { self, caches, fetch: fetchFake, URL, Response });
  const fire = async (type: string, extra: object = {}) => {
    let waited: Promise<unknown> | undefined;
    listeners.get(type)?.({ waitUntil: (p: Promise<unknown>) => (waited = p), ...extra });
    await waited;
  };
  const get = async (url: string, mode = "cors", method = "GET") => {
    let answered: Promise<Response> | undefined;
    listeners.get("fetch")?.({ request: { url, mode, method }, respondWith: (p: Promise<Response>) => (answered = p) });
    return answered ? await (await answered).text() : null;
  };
  return { state, store, network, fire, get };
}

describe("service worker", () => {
  it("precaches every served file of the build, only same-origin, and never skips waiting by itself", async () => {
    const sw = world(build(FILES));
    await sw.fire("install");
    const [name] = [...sw.store.keys()];
    expect(name).toMatch(/^privora-[0-9a-f]{16}$/);
    expect([...sw.store.get(name!)!.keys()].sort()).toEqual(
      ["assets/a.js", "hashes.json", "index.html", "pdfjs/cmaps/x.bcmap", "sw.js", "verify.html"].map((p) => `${ORIGIN}/${p}`),
    );
    expect(sw.network.every((u) => u.startsWith(`${ORIGIN}/`))).toBe(true);
    expect(sw.state.skipped).toBe(0);
  });
  it("a failed precache fails the install and leaves no half filled cache", async () => {
    const sw = world(build(FILES));
    sw.state.fail = "assets/a.js";
    await expect(sw.fire("install")).rejects.toThrow();
    expect(sw.store.size).toBe(0);
  });
  it("stores a redirected page as a plain response", async () => {
    const sw = world(build(FILES));
    sw.state.redirect = true;
    await sw.fire("install");
    const cache = [...sw.store.values()][0]!;
    expect(cache.get(`${ORIGIN}/verify.html`)!.redirected).toBe(false);
  });
  it("answers from the cache without the network, mapping page navigations", async () => {
    const sw = world(build(FILES));
    await sw.fire("install");
    sw.network.length = 0;
    expect(await sw.get(`${ORIGIN}/`, "navigate")).toBe("<p>app</p>");
    expect(await sw.get(`${ORIGIN}/?x=1`, "navigate")).toBe("<p>app</p>");
    expect(await sw.get(`${ORIGIN}/verify.html`, "navigate")).toBe("<p>verify</p>");
    expect(await sw.get(`${ORIGIN}/verify`, "navigate")).toBe("<p>verify</p>");
    expect(await sw.get(`${ORIGIN}/assets/a.js`)).toBe("a");
    expect(await sw.get(`${ORIGIN}/pdfjs/cmaps/x.bcmap`)).toBe("m");
    // verify.html hashes the worker script too, also with no network.
    expect(await sw.get(`${ORIGIN}/sw.js`)).toContain("SKIP_WAITING");
    expect(sw.network).toEqual([]);
  });
  it("never caches at run time and ignores other origins and non-GET requests", async () => {
    const sw = world(build(FILES));
    await sw.fire("install");
    const before = [...sw.store.values()][0]!.size;
    expect(await sw.get(`${ORIGIN}/unknown.txt`)).toBe("net");
    expect([...sw.store.values()][0]!.size).toBe(before);
    expect(await sw.get("https://other.example.test/x.js")).toBeNull();
    expect(await sw.get(`${ORIGIN}/assets/a.js`, "cors", "POST")).toBeNull();
  });
  it("falls back to the network when Cache Storage fails, so a broken cache never breaks the app online", async () => {
    const sw = world(build(FILES));
    await sw.fire("install");
    sw.state.broken = true;
    expect(await sw.get(`${ORIGIN}/assets/a.js`)).toBe("a");
  });
  it("skips waiting only when the page says the user accepted", async () => {
    const sw = world(build(FILES));
    await sw.fire("message", { data: { type: "OTHER" } });
    await sw.fire("message", { data: null });
    expect(sw.state.skipped).toBe(0);
    await sw.fire("message", { data: { type: "SKIP_WAITING" } });
    expect(sw.state.skipped).toBe(1);
  });
  it("activate removes old caches when at most one tab is open, and leaves foreign caches", async () => {
    const store = new Map([["privora-old", new Map<string, Response>()], ["someone-else", new Map<string, Response>()]]);
    const sw = world(build(FILES), store);
    await sw.fire("install");
    await sw.fire("activate");
    expect(store.has("privora-old")).toBe(false);
    expect(store.has("someone-else")).toBe(true);
    expect(store.size).toBe(2);
    expect(sw.state.claimed).toBe(1);
  });
  it("activate keeps old caches while other tabs run the old version, and can still serve them", async () => {
    const old = new Map([[`${ORIGIN}/assets/old-chunk.js`, new Response("old chunk")]]);
    const sw = world(build(FILES), new Map([["privora-old", old]]));
    sw.state.clients = 2;
    await sw.fire("install");
    await sw.fire("activate");
    expect(sw.store.has("privora-old")).toBe(true);
    expect(await sw.get(`${ORIGIN}/assets/old-chunk.js`)).toBe("old chunk");
  });
});
