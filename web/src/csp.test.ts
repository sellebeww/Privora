// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { describe, expect, it } from "vitest";
import { buildCsp, securityHeaders } from "../csp";

describe("buildCsp", () => {
  it("matches the locked policy and never allows inline code or external origins", () => {
    const csp = buildCsp({ blob: true });
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toMatch(/https?:/);
  });

  it("drops blob: everywhere when asked", () => {
    expect(buildCsp({ blob: false })).not.toContain("blob:");
  });

  it("allows no data: images either (D-44)", () => {
    expect(buildCsp({ blob: false })).not.toContain("data:");
  });

  it("the verify page policy drops wasm compilation", () => {
    const csp = buildCsp({ blob: false, wasm: false });
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain("wasm-unsafe-eval");
    expect(csp).toContain("connect-src 'self'");
  });
});

describe("securityHeaders", () => {
  const h = securityHeaders({ blob: false });
  it("carries the page policy plus frame-ancestors, which only a header can set", () => {
    expect(h["Content-Security-Policy"]).toBe(`${buildCsp({ blob: false })}; frame-ancestors 'none'`);
  });
  it("sends nosniff and no referrer, and switches unused browser features off", () => {
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
    for (const f of ["camera", "microphone", "geolocation", "payment", "usb", "display-capture"]) {
      expect(h["Permissions-Policy"]).toContain(`${f}=()`);
    }
    expect(h["Permissions-Policy"]).not.toContain("clipboard-write");
  });
});
