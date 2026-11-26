// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// scripts/check-no-network.mjs must actually fail on planted network code.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "../../../scripts/check-no-network.mjs");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function run(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "privora-nonet-"));
  dirs.push(root);
  for (const [path, text] of Object.entries({ "web/dist/index.html": "<html></html>", ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const r = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe("check-no-network", () => {
  it("passes a clean tree", () => {
    const r = run({ "web/src/a.ts": "export const a = 1;\n" });
    expect(r.out).toContain("ok");
    expect(r.code).toBe(0);
  });
  it.each([
    ["source", "web/src/planted.ts", "fetch('https://x')"],
    ["dist chunk", "web/dist/assets/main-abc.js", "fetch('https://x')"],
    ["optional call", "web/src/planted.ts", "fetch?.('/x')"],
    ["page html", "web/index.html", "<script>fetch('https://x')</script>"],
    ["XMLHttpRequest", "web/src/a.ts", "new XMLHttpRequest()"],
    ["WebSocket", "web/src/a.ts", "new WebSocket(u)"],
    ["EventSource", "web/src/a.ts", "new EventSource(u)"],
    ["sendBeacon", "web/src/a.ts", "navigator.sendBeacon(u)"],
    ["RTCPeerConnection", "web/src/a.ts", "new RTCPeerConnection()"],
    ["WebTransport", "web/src/a.ts", "new WebTransport(u)"],
  ])("fails on planted network code: %s", (_name, path, text) => {
    const r = run({ [path]: text });
    expect(r.code).toBe(1);
    expect(r.out).toContain(path);
  });
  // F-19: CSP does not stop a page from navigating, so the sources may not do it at all.
  it.each([
    ["assigning location", "location = u"],
    ["assigning href", "window.location.href = u"],
    ["location.assign", "location.assign(u)"],
    ["location.replace", "location.replace(u)"],
    ["window.open", "window.open(u)"],
    ["image beacon", "new Image().src = u"],
  ])("fails on navigation that could carry data out: %s", (_name, text) => {
    const r = run({ "web/src/planted.ts": text });
    expect(r.code, r.out).toBe(1);
  });
  it("in-page routes and a reload are not navigation", () => {
    expect(run({ "web/src/a.ts": 'location.hash = "#/";\nlocation.reload();\nif (location.href === u) a.href = url;\n' }).code).toBe(0);
  });
  it("fails on an absolute URL in dist, in html, js and svg", () => {
    for (const path of ["web/dist/a.html", "web/dist/assets/a.js", "web/dist/a.svg"]) {
      const r = run({ [path]: '"https://tracker.example.test/p"' });
      expect(r.code, path).toBe(1);
      expect(r.out).toContain("absolute URL");
    }
  });
  it("allows the recorded exceptions only up to their recorded count", () => {
    const one = "await fetch(url)";
    for (const path of ["web/dist/assets/worker-Ab1_-x.js", "web/src/wasm/pkg/privora.js"]) {
      expect(run({ [path]: one }).code, path).toBe(0);
      expect(run({ [path]: `${one};\nfetch('/second')` }).code, path).toBe(1);
    }
    for (const path of ["web/dist/sw.js", "web/src/offline/sw.js", "web/dist/assets/verify-Ab1.js", "web/src/verify/net.ts"]) {
      expect(run({ [path]: `${one};${one}` }).code, path).toBe(0);
      expect(run({ [path]: `${one};${one};${one}` }).code, path).toBe(1);
    }
  });
  it("an exception covers one API in one file, nothing else", () => {
    expect(run({ "web/dist/sw.js": "new WebSocket(u)" }).code).toBe(1);
    expect(run({ "web/dist/assets/main-abc.js": "instantiateStreaming(fetch(x)) // a.wasm" }).code).toBe(1);
    expect(run({ "web/dist/assets/main-abc.js": '"https://privora-probe.invalid/"' }).code).toBe(1);
    expect(run({ "web/dist/assets/verify-abc.js": '"https://privora-probe.invalid/"' }).code).toBe(0);
  });
  it("fails when dist is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "privora-nonet-"));
    dirs.push(root);
    expect(spawnSync(process.execPath, [script, "--root", root]).status).toBe(1);
  });
});
