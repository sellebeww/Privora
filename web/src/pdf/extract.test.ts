// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Text per page with positions, finding to box mapping (both modes), page /Rotate,
// CropBox, scale, fonts, many pages, line joining and its limits. All PDFs are made here (SINTETIS).
import { describe, expect, it } from "vitest";
import { boxesForRanges } from "./boxes.ts";
import { right, bottom, type Box } from "./geometry.ts";
import { buildPageText } from "./pageText.ts";
import { engine, openNode, pagesOf, scanPage } from "./nodeSupport.ts";
import { courierInk as courierInkOf, makeTestPdf, type TestPage, type TestPiece } from "./testPdf.ts";
const courierInk = courierInkOf;
import { pageHasImagesNode } from "./nodeSupport2.ts";

const NIK = "3171011505900001";
const PHONE = "0812-5550-0101";
const MAIL = "budi.contoh@example.test";

const covers = (outer: Box, inner: Box, eps = 1e-6) =>
  outer.x <= inner.x + eps && outer.y <= inner.y + eps && right(outer) >= right(inner) - eps && bottom(outer) >= bottom(inner) - eps;

const SAMPLE = (rotate: 0 | 90 | 180 | 270, extra: Partial<TestPage> = {}): TestPage => ({
  width: 612,
  height: 792,
  rotate,
  pieces: [
    { text: `NIK: ${NIK}`, x: 72, y: 700, font: "Courier" },
    { text: `Telp: ${PHONE}`, x: 72, y: 660, font: "Courier", size: 14 },
    { text: `Email: ${MAIL}`, x: 100, y: 300, font: "Courier", size: 10 },
  ],
  ...extra,
});

describe("extraction and box mapping, per item and precise (Courier, known geometry)", () => {
  const cases: [string, TestPage][] = [
    ["rotate 0", SAMPLE(0)],
    ["rotate 90", SAMPLE(90)],
    ["rotate 180", SAMPLE(180)],
    ["rotate 270", SAMPLE(270)],
    ["rotate 90 with CropBox", SAMPLE(90, { cropBox: [50, 100, 450, 700] })],
    ["rotate 270 with CropBox", SAMPLE(270, { cropBox: [30, 40, 500, 760] })],
    ["scale 0.5 (small page, content scaled)", { ...SAMPLE(0, { scale: 0.5, width: 300, height: 400 }) }],
    ["scale 2, rotate 180", SAMPLE(180, { scale: 2, width: 1224, height: 1584 })],
    ["A5 page", { ...SAMPLE(0), width: 420, height: 595, pieces: SAMPLE(0).pieces.map((p) => ({ ...p, x: p.x / 2, y: p.y / 2 })) }],
  ];
  for (const [name, page] of cases) {
    it(`${name}: viewport size, findings, both modes cover the true ink`, async () => {
      const [pd] = await pagesOf(makeTestPdf({ pages: [page] }));
      expect(pd).toBeDefined();
      if (!pd) return;
      const [x0, y0, x1, y1] = page.cropBox ?? [0, 0, page.width, page.height];
      const swap = page.rotate === 90 || page.rotate === 270;
      expect(pd.width).toBeCloseTo(swap ? y1 - y0 : x1 - x0, 3);
      expect(pd.height).toBeCloseTo(swap ? x1 - x0 : y1 - y0, 3);

      const found = await scanPage(pd.text);
      const byKind = (k: string) => found.filter((f) => f.kind === k);
      expect(byKind("NIK")).toHaveLength(1);
      expect(byKind("TELEPON")).toHaveLength(1);
      expect(byKind("EMAIL")).toHaveLength(1);

      const targets: [string, number, TestPiece][] = [
        ["NIK", 5, page.pieces[0] as TestPiece],
        ["TELEPON", 6, page.pieces[1] as TestPiece],
        ["EMAIL", 7, page.pieces[2] as TestPiece],
      ];
      for (const [kind, prefix, piece] of targets) {
        const f = byKind(kind)[0];
        if (!f) throw new Error("finding missing");
        const len = f.end - f.start;
        const ink = courierInk(page, piece, prefix, prefix + len);
        const ranges = [{ key: "a0", start: f.start, end: f.end }];
        const item = boxesForRanges(pd, ranges, "ITEM");
        expect(item).toHaveLength(1);
        // Per item: every item the finding touches is covered whole (the item may be larger than the finding).
        expect(covers(item[0]?.box as Box, ink)).toBe(true);
        for (const it of pd.items.filter((x) => x.start < f.end && x.end > f.start)) expect(covers(item[0]?.box as Box, it.box)).toBe(true);
        const precise = boxesForRanges(pd, ranges, "PRECISE");
        expect(precise).toHaveLength(1);
        expect(covers(precise[0]?.box as Box, ink)).toBe(true);
      }
    });
  }
});

describe("proportional fonts: precise mode estimate and its drift (recorded)", () => {
  // Helvetica advance widths, 1/1000 em (Adobe AFM), for the characters of the line below.
  const W: Record<string, number> = { N: 722, I: 278, K: 667, ":": 278, " ": 278, o: 556, m: 833, r: 333, T: 611, P: 667, e: 556, h: 556, n: 556, i: 222, k: 500, l: 222, a: 556, b: 556, u: 556, d: 556, s: 500, t: 278, "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556 };
  it("per item always covers; precise covers with the margin, drift is bounded and reported", async () => {
    const lines = ["NIK: " + NIK, "Nomor KTP pemohon: " + NIK, "Nomor induk kependudukan atas nama Budi: " + NIK, "mmmmmmmmmm mmmmmmmmmm " + NIK];
    const report: string[] = [];
    for (const [i, line] of lines.entries()) {
      const size = 12;
      const page: TestPage = { width: 612, height: 792, pieces: [{ text: line, x: 72, y: 700 - i * 30, size, font: "Helvetica" }] };
      const [pd] = await pagesOf(makeTestPdf({ pages: [page] }));
      if (!pd) throw new Error("no page");
      const f = (await scanPage(pd.text)).find((x) => x.kind === "NIK");
      if (!f) throw new Error("no NIK");
      const off = f.start;
      const trueX0 = 72 + [...line.slice(0, off)].reduce((s, c) => s + (W[c] ?? 556), 0) * size / 1000;
      const trueX1 = 72 + [...line.slice(0, f.end)].reduce((s, c) => s + (W[c] ?? 556), 0) * size / 1000;
      const ranges = [{ key: "a0", start: f.start, end: f.end }];
      const item = boxesForRanges(pd, ranges, "ITEM")[0]?.box as Box;
      const precise = boxesForRanges(pd, ranges, "PRECISE")[0]?.box as Box;
      expect(precise.w).toBeLessThan(item.w); // partial finding: precise is the smaller box
      expect(item.x).toBeLessThanOrEqual(trueX0);
      expect(right(item)).toBeGreaterThanOrEqual(trueX1);
      // Estimate drift: how far the (padded) box edges are from the true ink edges. Negative = the box misses ink.
      const missLeft = trueX0 - precise.x;
      const missRight = right(precise) - trueX1;
      report.push(`${line.length} chars: left margin ${missLeft.toFixed(1)} pt, right margin ${missRight.toFixed(1)} pt`);
      expect(missLeft).toBeGreaterThanOrEqual(0);
      expect(missRight).toBeGreaterThanOrEqual(0);
    }
    process.stderr.write(`\n[precise drift, Helvetica 12 pt, margin = positive means covered]\n${report.join("\n")}\n`);
  });
});

describe("line joining", () => {
  const pieces = (gap: number): TestPiece[] => {
    // "3171" in Helvetica (4 digits * 556 * 12 / 1000 = 26.688 pt), then the rest in Courier so pdf.js keeps two items.
    const w = 4 * 0.556 * 12;
    return [
      { text: "NIK: ", x: 72, y: 700, font: "Courier" },
      { text: "3171", x: 72 + 5 * 7.2, y: 700, font: "Helvetica" },
      { text: "011505900001", x: 72 + 5 * 7.2 + w + gap, y: 700, font: "Courier" },
    ];
  };
  it("glues items with a tiny gap, so a NIK split between items is still one finding", async () => {
    const [pd] = await pagesOf(makeTestPdf({ pages: [{ width: 612, height: 792, pieces: pieces(0.3) }] }));
    expect(pd?.items.length).toBeGreaterThanOrEqual(3);
    expect(pd?.text).toBe(`NIK: ${NIK}`);
    const f = await scanPage(pd?.text ?? "");
    expect(f.map((x) => x.kind)).toContain("NIK");
    const finding = f.find((x) => x.kind === "NIK");
    const boxes = boxesForRanges(pd as never, [{ key: "a0", start: finding?.start ?? 0, end: finding?.end ?? 0 }], "ITEM");
    // Two items touched, adjacent on one line, merged into one box.
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.sources).toEqual(["a0"]);
  });
  it("a wide gap is a space, and a space inside a NIK is not a NIK (documented limit)", async () => {
    const [pd] = await pagesOf(makeTestPdf({ pages: [{ width: 612, height: 792, pieces: pieces(8) }] }));
    expect(pd?.text).toBe("NIK: 3171 011505900001");
    expect((await scanPage(pd?.text ?? "")).some((x) => x.kind === "NIK" && x.end - x.start === 16)).toBe(false);
  });
  it("a number broken across two lines is not joined (documented limit)", async () => {
    const page: TestPage = { width: 612, height: 792, pieces: [{ text: "NIK: 3171011505", x: 72, y: 700 }, { text: "900001", x: 72, y: 686 }] };
    const [pd] = await pagesOf(makeTestPdf({ pages: [page] }));
    expect(pd?.text).toBe("NIK: 3171011505\n900001");
    expect((await scanPage(pd?.text ?? "")).filter((x) => x.kind === "NIK")).toHaveLength(0);
  });
});

describe("files pdf.js cannot open", () => {
  it("a password protected PDF raises PasswordException (the app shows 'not supported' and sends nothing)", async () => {
    const data = makeTestPdf({ pages: [{ width: 200, height: 200, pieces: [{ text: "x", x: 10, y: 10 }] }], encrypted: true });
    await expect(openNode(data)).rejects.toMatchObject({ name: "PasswordException" });
  });
  it("garbage and truncated files raise InvalidPDFException", async () => {
    await expect(openNode(new TextEncoder().encode("this is not a pdf at all"))).rejects.toMatchObject({ name: "InvalidPDFException" });
    const good = makeTestPdf({ pages: [{ width: 200, height: 200, pieces: [{ text: "x", x: 10, y: 10 }] }] });
    await expect(openNode(good.slice(0, 120))).rejects.toBeDefined();
  });
});

describe("pages, scanned look and annotations", () => {
  it("20 pages with different sizes keep their own size and text", async () => {
    const pages: TestPage[] = Array.from({ length: 20 }, (_, i) => ({
      width: 400 + i * 10,
      height: 600 + i * 5,
      rotate: ([0, 90, 180, 270] as const)[i % 4],
      pieces: [{ text: `Halaman ${i + 1} NIK: ${NIK}`, x: 50, y: 500, font: "Courier" }],
    }));
    const out = await pagesOf(makeTestPdf({ pages }));
    expect(out).toHaveLength(20);
    out.forEach((p, i) => {
      expect(p.text).toBe(`Halaman ${i + 1} NIK: ${NIK}`);
      const swap = i % 2 === 1;
      expect(p.width).toBeCloseTo(swap ? 600 + i * 5 : 400 + i * 10, 3);
    });
  });
  it("an image-only page has no text and paints an image, a text page does not", async () => {
    const data = makeTestPdf({
      pages: [
        { width: 300, height: 300, pieces: [], imageOnly: true },
        { width: 300, height: 300, pieces: [{ text: "teks biasa", x: 20, y: 200 }] },
      ],
    });
    const out = await pagesOf(data);
    expect(out.map((p) => p.chars)).toEqual([0, 9]);
    expect(await pageHasImagesNode(data, 1)).toBe(true);
    expect(await pageHasImagesNode(data, 2)).toBe(false);
  });
  it("annotations are visible to the page (they are not scanned, so the UI warns)", async () => {
    const data = makeTestPdf({ pages: [{ width: 300, height: 300, pieces: [{ text: "x", x: 20, y: 200 }], extras: true }] });
    const { doc } = await openNode(data);
    const page = await doc.getPage(1);
    expect((await page.getAnnotations()).length).toBe(2);
    // Their text is not in the page text: this is why preview is mandatory.
    expect((await extractFirst(data)).text).not.toContain("3171");
  });
  it("buildPageText survives hostile items (NaN, empty, zero size) without throwing", () => {
    const vp = [1, 0, 0, -1, 0, 800] as const;
    const t = buildPageText(
      [
        { str: "a", transform: [Number.NaN, 0, 0, 12, 0, 0], width: 5, height: 12 },
        { str: "", transform: [12, 0, 0, 12, 0, 0], width: 0, height: 0, hasEOL: true },
        { str: "b", transform: [0, 0, 0, 0, 5, 5], width: 0, height: 0 },
        { str: "c", transform: [12, 0, 0, 12, 1e308, 1e308], width: 1e308, height: 12 },
      ],
      vp,
    );
    expect(t.text.includes("b")).toBe(true);
    expect(engine).toBeDefined();
  });
});

async function extractFirst(data: Uint8Array) {
  const [p] = await pagesOf(data);
  if (!p) throw new Error("no page");
  return p;
}
