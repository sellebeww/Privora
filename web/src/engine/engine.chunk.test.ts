// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Chunked scanning keeps global offsets and gives the same findings as one pass.
import { describe, expect, it } from "vitest";
import { chunkBounds, scanChunked } from "./handler.ts";
import { REF, wasmApi } from "./testSupport.ts";

const opts = { referenceDate: REF };
const block = (i: number) =>
  `Nama: Budi ${i}\nNIK: 3174051509900001\nHP: 0812-3456-78${String(i % 100).padStart(2, "0")}\n\u{1F600} Email: user${i}@example.com\nAlamat: Jl. Mawar No. ${i}, RT 01/RW 02\n\n`;

describe("chunkBounds", () => {
  it("covers the text, increases, and never cuts a surrogate pair", () => {
    const text = "\u{1F600}".repeat(5000) + "a".repeat(7) + "\u{1F600}".repeat(5000);
    for (const target of [7, 100, 1001, 4999]) {
      const b = chunkBounds(text, target);
      expect(b[0]).toBe(0);
      expect(b.at(-1)).toBe(text.length);
      for (let i = 1; i < b.length; i++) {
        expect(b[i]).toBeGreaterThan(b[i - 1] as number);
        const c = text.charCodeAt(b[i] as number);
        const isMid = (b[i] as number) < text.length && c >= 0xdc00 && c < 0xe000;
        expect(isMid).toBe(false);
      }
    }
  });

  it("prefers blank lines, then line breaks", () => {
    const text = ("x".repeat(40) + "\n").repeat(10) + "\n" + ("y".repeat(40) + "\n").repeat(10);
    const b = chunkBounds(text, 450);
    expect(text.slice(0, b[1])).toMatch(/\n\n$/);
  });

  it("returns one chunk for short text and for empty text", () => {
    expect(chunkBounds("", 10)).toEqual([0, 0]);
    expect(chunkBounds("abc", 10)).toEqual([0, 3]);
  });
});

describe("scanChunked", () => {
  const text = Array.from({ length: 60 }, (_, i) => block(i)).join("");
  const whole = JSON.parse(wasmApi.scan(text, JSON.stringify(opts)));

  it("matches a single pass for several chunk sizes, with global UTF-16 offsets", () => {
    expect(whole.length).toBeGreaterThan(200);
    for (const target of [300, 1000, 5000, 100000]) {
      const steps: number[] = [];
      const got = scanChunked(wasmApi, text, opts, (d, t) => steps.push(d / t), target);
      expect(got).toEqual(whole);
      expect(steps.at(-1)).toBe(1);
      expect(steps).toEqual([...steps].sort((a, b) => a - b));
      for (const f of got) if (f.kind === "NIK") expect(text.slice(f.start, f.end)).toBe("3174051509900001");
    }
  });

  it("reports one progress step per chunk", () => {
    let n = 0;
    const total = chunkBounds(text, 1000).length - 1;
    scanChunked(wasmApi, text, opts, () => n++, 1000);
    expect(n).toBe(total);
    expect(total).toBeGreaterThan(5);
  });

  it("a keyword on the previous line still counts across a chunk cut", () => {
    // Cut forced between "NIK:" and the number by using single newlines and a tiny target.
    const doc = "x".repeat(30) + "\nNIK:\n3174051509900001\n" + "y".repeat(30);
    const single = JSON.parse(wasmApi.scan(doc, JSON.stringify(opts)));
    for (let target = 20; target < 60; target++) {
      expect(scanChunked(wasmApi, doc, opts, () => {}, target)).toEqual(single);
    }
  });

  it("empty text is one empty chunk", () => {
    expect(scanChunked(wasmApi, "", opts, () => {})).toEqual([]);
  });
});
