// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scanSource, scanSvg } from "../../scripts/lib/token-scan.mjs";
import { over, parseColor, parseTokens, ratio } from "../../scripts/lib/contrast.mjs";

const rules = (s: string, f = "x.tsx") => scanSource(s, f).map((v) => v.rule);

describe("token scanner", () => {
  it("flags colours that are not tokens", () => {
    expect(rules('const a = "#ff0000"')).toContain("hex colour");
    expect(rules("a { color: rgb(1,2,3) }", "a.css")).toContain("colour function");
    expect(rules("a { color: red }", "a.css")).toContain("named colour in CSS");
    expect(rules('<p className="bg-red-500 text-white">')).toEqual(["default palette class", "default palette class"]);
  });
  it("flags radii outside 6, 8, 12 and accepts the token names", () => {
    expect(rules('"rounded-lg"')).toContain("radius outside tokens");
    expect(rules('"rounded"')).toContain("radius outside tokens");
    expect(rules('"rounded-[10px]"')).toContain("radius outside tokens");
    expect(rules("a { border-radius: 10px }", "a.css")).toContain("border-radius literal");
    expect(rules('"rounded-control rounded-t-panel rounded-chip"')).toEqual([]);
  });
  it("flags shadows, gradients, off-scale spacing, free arbitrary values and font sizes", () => {
    expect(rules('"shadow-lg"')).toContain("shadow");
    expect(rules('"bg-gradient-to-r"')).toContain("gradient class");
    expect(rules('"p-5"')).toContain("spacing off the 4px scale");
    expect(rules('"-mt-5 gap-7"')).toHaveLength(2);
    expect(rules('"w-[123px]"')).toContain("arbitrary value without a token");
    expect(rules('"text-sm"')).toContain("font size off the type scale");
  });
  it("accepts token based classes", () => {
    expect(rules('"p-4 gap-3 -mb-px px-2 w-[var(--size-nav)] top-[calc(var(--size-topbar)+32px)] text-body bg-surface"')).toEqual([]);
  });
  it("ignores comments and fragment links", () => {
    expect(rules("/* no shadows, #fff */ a {}", "a.css")).toEqual([]);
    expect(rules('// rgb(1,2,3)\nconst x = 1;')).toEqual([]);
    expect(rules('<a href="#main">')).toEqual([]);
  });
  it("tokens.css itself may define colours", () => expect(rules("--a: #123456;", "web/src/styles/tokens.css")).toEqual([]));
  it("svg colours must be token values", () => {
    const t = new Set(["#0a0a0b"]);
    expect(scanSvg('<rect fill="#0a0a0b"/>', t)).toEqual([]);
    expect(scanSvg('<rect fill="#ff0000"/>', t)).toHaveLength(1);
  });
});

describe("contrast maths", () => {
  it("black on white is 21 and equal colours are 1", () => {
    const w = parseColor("#ffffff");
    const k = parseColor("#000000");
    expect(ratio(w, k)).toBeCloseTo(21, 5);
    expect(ratio(w, w)).toBeCloseTo(1, 5);
  });
  it("composites translucent colours over their base", () => {
    const c = over(parseColor("rgba(255,255,255,0.5)"), parseColor("#000000"));
    expect(Math.round(c.r)).toBe(128);
  });
  it("core text pairs of the real tokens are AA", () => {
    const t = parseTokens(readFileSync("src/styles/tokens.css", "utf8"));
    const c = (n: string) => parseColor(t[n] as string);
    expect(ratio(c("text"), c("bg"))).toBeGreaterThan(4.5);
    expect(ratio(c("text-muted"), c("surface"))).toBeGreaterThan(4.5);
    expect(ratio(c("accent-ink"), c("accent"))).toBeGreaterThan(4.5);
    expect(t["radius-chip"]).toBe("6px");
    expect(t["radius-control"]).toBe("8px");
    expect(t["radius-panel"]).toBe("12px");
  });
});
