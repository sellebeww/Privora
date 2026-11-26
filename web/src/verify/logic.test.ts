// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Logic of verify.html: hashes, origin marking, the blocked request probe.
import { describe, expect, it } from "vitest";
import { buildCsp, securityHeaders } from "../../csp.ts";
import { checkFiles, classifyUrl, confinesConnections, metaCsp, parseManifest, PROBE_URL, runProbe, sha256Hex } from "./logic.ts";

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("sha256Hex", () => {
  it("matches the published test vectors", async () => {
    expect(await sha256Hex(bytes("abc"))).toBe(ABC);
    expect(await sha256Hex(bytes(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("parseManifest", () => {
  const ok = { path: "assets/a.js", sha256: ABC, bytes: 3, served: true };
  it("accepts the build's shape", () => {
    expect(parseManifest({ algorithm: "SHA-256", files: [ok] })).toEqual([ok]);
  });
  it.each([
    ["not an object", 1],
    ["null", null],
    ["no files", {}],
    ["empty files", { files: [] }],
    ["bad hash", { files: [{ ...ok, sha256: "x" }] }],
    ["absolute URL", { files: [{ ...ok, path: "https://x.example.test/a" }] }],
    ["protocol relative", { files: [{ ...ok, path: "//x.example.test/a" }] }],
    ["root path", { files: [{ ...ok, path: "/a" }] }],
    ["parent path", { files: [{ ...ok, path: "a/../../b" }] }],
    ["backslash", { files: [{ ...ok, path: "\\\\x\\a" }] }],
  ])("rejects %s", (_n, v) => expect(parseManifest(v)).toBeNull());
});

describe("checkFiles", () => {
  const f = (path: string, served = true) => ({ path, sha256: ABC, bytes: 3, served });
  it("marks equal, different, unreadable and unserved files, with progress", async () => {
    const seen: number[] = [];
    const read = async (p: string) => {
      if (p === "gone") throw new Error("404");
      return bytes(p === "same" ? "abc" : "abd");
    };
    const rows = await checkFiles([f("same"), f("changed"), f("gone"), f("_headers", false)], read, (d) => seen.push(d));
    expect(rows.map((r) => [r.path, r.status])).toEqual([
      ["same", "SAMA"],
      ["changed", "BEDA"],
      ["gone", "TIDAK_TERBACA"],
      ["_headers", "TIDAK_DISAJIKAN"],
    ]);
    expect(rows[1]!.actual).toMatch(/^[0-9a-f]{64}$/);
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});

describe("classifyUrl", () => {
  const o = "https://privora.example.test";
  it.each([
    [`${o}/assets/a.js`, "SAMA_ORIGIN"],
    [`blob:${o}/6f1a`, "LOKAL"],
    ["data:image/png;base64,AA==", "LOKAL"],
    ["https://cdn.example.test/a.js", "LUAR"],
    ["http://privora.example.test/a.js", "LUAR"],
    ["https://privora.example.test.evil.test/a", "LUAR"],
    ["https://privora.example.test:8443/a", "LUAR"],
    ["blob:https://other.example.test/1", "LUAR"],
    ["wss://privora.example.test/s", "LUAR"],
    ["chrome-extension://abc/x.js", "LUAR"],
    ["not a url", "LUAR"],
  ])("%s is %s", (url, kind) => expect(classifyUrl(url, o)).toBe(kind));
});

describe("metaCsp", () => {
  it("reads the policy of a built page, or null", () => {
    expect(metaCsp('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">')).toBe("default-src 'none'");
    expect(metaCsp("<meta charset=utf-8>")).toBeNull();
  });
});

describe("confinesConnections", () => {
  it("accepts the policy the build ships", () => {
    expect(confinesConnections(securityHeaders({ blob: false })["Content-Security-Policy"]!)).toBe(true);
    expect(confinesConnections(buildCsp({ blob: false }))).toBe(true);
  });
  it.each([
    ["connect-src 'self'", true],
    ["connect-src 'none'", true],
    ["default-src 'none'", true],
    ["default-src 'self'; script-src *", true],
    // Two header values are joined with a comma; the browser enforces both.
    ["frame-ancestors 'none', default-src 'none'", true],
    ["connect-src *", false],
    ["connect-src 'self' https://x.example.test", false],
    ["default-src 'none'; connect-src https:", false],
    ["connect-src", true],
    ["frame-ancestors 'none'", false],
    ["script-src 'self'", false],
    ["", false],
  ])("%s -> %s", (csp, ok) => expect(confinesConnections(csp)).toBe(ok));
});

describe("runProbe", () => {
  const violation = (target: EventTarget, blockedURI: string) => {
    const e = new Event("securitypolicyviolation");
    Object.assign(e, { blockedURI, effectiveDirective: "connect-src" });
    target.dispatchEvent(e);
  };
  it("targets a name that can never resolve", () => expect(new URL(PROBE_URL).hostname.endsWith(".invalid")).toBe(true));
  it("reports blocked only when the browser raised a CSP violation, even if it arrives late", async () => {
    const doc = new EventTarget();
    const r = await runProbe(doc, () => {
      setTimeout(() => violation(doc, PROBE_URL), 5);
      return Promise.reject(new TypeError("blocked"));
    }, 200);
    expect(r).toEqual({ blockedByCsp: true, directive: "connect-src", requestFailed: true });
  });
  it("a failed request without a violation is not proof of blocking", async () => {
    const r = await runProbe(new EventTarget(), () => Promise.reject(new TypeError("dns")), 20);
    expect(r).toEqual({ blockedByCsp: false, directive: null, requestFailed: true });
  });
  it("ignores violations for other addresses and reports a request that went through", async () => {
    const doc = new EventTarget();
    const r = await runProbe(doc, async () => violation(doc, "https://other.example.test/"), 20);
    expect(r).toEqual({ blockedByCsp: false, directive: null, requestFailed: false });
  });
});
