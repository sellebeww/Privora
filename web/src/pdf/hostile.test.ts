// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Boxes on a hostile PDF with an embedded font, a shifted and rotated
// page, vertical writing and hidden content. The export of the same file is checked in
// e2e/audit-pdf.spec.ts. All values are invented (SINTETIS).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADV, makeAdversarialPdf, VERTICAL } from "./adversarialPdf.ts";
import { boxesForRanges } from "./boxes.ts";
import { bottom, right, type Box } from "./geometry.ts";
import { pagesOf, scanPage } from "./nodeSupport.ts";
import { buildPageText } from "./pageText.ts";

const TTF = new URL("../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf", import.meta.url);
const bytes = makeAdversarialPdf(new Uint8Array(readFileSync(TTF)));

const covers = (outer: Box, inner: Box) => outer.x <= inner.x && outer.y <= inner.y && right(outer) >= right(inner) && bottom(outer) >= bottom(inner);

/** Where the 16 digits of the vertical NIK are painted (page space): one em per glyph, going down. */
function verticalInk(): Box {
  const top = VERTICAL.pageHeight - VERTICAL.y;
  const from = VERTICAL.prefix.length;
  return { x: VERTICAL.x - VERTICAL.size / 4, y: top + from * VERTICAL.size + 2, w: VERTICAL.size / 2, h: ADV.nikVertical.length * VERTICAL.size - 4 };
}

describe("hostile PDF: text is found and boxed", () => {
  for (const mode of ["ITEM", "PRECISE"] as const) {
    it(`vertical writing: the ${mode} box covers every digit of the NIK`, async () => {
      const page = (await pagesOf(bytes))[1]!;
      const nik = (await scanPage(page.text)).filter((f) => f.kind === "NIK");
      expect(nik).toHaveLength(1);
      const boxes = boxesForRanges(page, [{ key: "a0", start: nik[0]!.start, end: nik[0]!.end }], mode);
      expect(boxes.some((b) => covers(b.box, verticalInk()))).toBe(true);
      // And it stays a column, not a page wide slab.
      for (const b of boxes) expect(b.box.w).toBeLessThan(VERTICAL.size * 3);
    });
  }

  it("rotated, cropped page with an embedded font: NIK and e-mail are read", async () => {
    const page = (await pagesOf(bytes))[0]!;
    const kinds = (await scanPage(page.text)).map((f) => f.kind);
    expect(kinds).toContain("NIK");
    expect(kinds).toContain("EMAIL");
  });

  it("right to left text: precise mode cannot place characters, so it boxes the whole item", () => {
    const item = { str: "אב 3171011505900001 ג", dir: "rtl", transform: [12, 0, 0, 12, 100, 500], width: 200, height: 12 };
    const page = buildPageText([item], [1, 0, 0, -1, 0, 792]);
    const range = [{ key: "a0", start: 3, end: 19 }];
    expect(boxesForRanges(page, range, "PRECISE")).toEqual(boxesForRanges(page, range, "ITEM"));
  });
});
