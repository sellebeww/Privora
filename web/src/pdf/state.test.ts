// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// The review state of a PDF: boxes derive from selected findings, every edit resets the final check.
import { describe, expect, it } from "vitest";
import { engine, pagesOf, scanPage } from "./nodeSupport.ts";
import { allBoxes, counts, fkey, initialPdf, pageBoxes, pdfReducer, type PdfState } from "./state.ts";
import { makeTestPdf } from "./testPdf.ts";

async function loaded(): Promise<PdfState> {
  const data = makeTestPdf({
    pages: [0, 1, 2].map((i) => ({
      width: 612,
      height: 792,
      pieces: [
        { text: "NIK: 3171011505900001", x: 72, y: 700, font: "Courier" as const },
        { text: "Email: budi.contoh@example.test", x: 72, y: 600 - i * 10, font: "Courier" as const },
      ],
    })),
  });
  const pages = (await pagesOf(data)).map((d) => ({ data: d, findings: [], scannedLook: false, annotations: 0 }));
  let s = pdfReducer(initialPdf, { type: "begin", fileName: "x.pdf", fileBytes: 1 });
  s = pdfReducer(s, { type: "extracted", pages });
  const findings = await Promise.all(pages.map((p) => scanPage(p.data.text)));
  return pdfReducer(s, { type: "scanned", findings, sensitivity: "SEIMBANG" });
}

describe("PDF review state", () => {
  it("boxes come from selected findings; switching a finding off removes its box", async () => {
    const s = await loaded();
    expect(s.phase).toBe("ready");
    expect(counts(s)).toEqual({ boxes: 6, findings: 6 });
    const f = s.pages[0]?.findings[0];
    if (!f) throw new Error("no finding");
    const off = pdfReducer(s, { type: "toggle", keys: [fkey(0, f)], on: false });
    expect(counts(off)).toEqual({ boxes: 5, findings: 5 });
    expect(allBoxes(off)[0]).toHaveLength(1);
  });

  it("removing a box switches off all the findings behind it, and manual boxes are separate", async () => {
    let s = await loaded();
    const box = pageBoxes(s, 1)[0];
    s = pdfReducer(s, { type: "toggle", keys: box?.sources ?? [], on: false });
    expect(pageBoxes(s, 1)).toHaveLength(1);
    s = pdfReducer(s, { type: "add-manual", page: 1, box: { x: 10, y: 10, w: 50, h: 20 } });
    expect(pageBoxes(s, 1).map((b) => b.manualId !== undefined)).toEqual([false, true]);
    const id = pageBoxes(s, 1)[1]?.manualId ?? -1;
    s = pdfReducer(s, { type: "update-manual", page: 1, id, box: { x: 20, y: 20, w: 60, h: 25 } });
    expect(pageBoxes(s, 1)[1]?.box).toEqual({ x: 20, y: 20, w: 60, h: 25 });
    s = pdfReducer(s, { type: "remove-manual", page: 1, id });
    expect(pageBoxes(s, 1)).toHaveLength(1);
    // a tiny drag is an accident, not a box
    expect(pdfReducer(s, { type: "add-manual", page: 1, box: { x: 1, y: 1, w: 1, h: 1 } })).toBe(s);
  });

  it("export is confirmable only after every page was seen, and any edit asks for it again", async () => {
    let s = await loaded();
    s = pdfReducer(s, { type: "viewed", page: 0 });
    expect(pdfReducer(s, { type: "confirm", value: true }).confirmed).toBe(false);
    s = pdfReducer(pdfReducer(s, { type: "viewed", page: 1 }), { type: "viewed", page: 2 });
    s = pdfReducer(s, { type: "confirm", value: true });
    expect(s.confirmed).toBe(true);
    for (const edit of [
      pdfReducer(s, { type: "mode", mode: "PRECISE" }),
      pdfReducer(s, { type: "toggle", keys: ["p0:0:1"], on: false }),
      pdfReducer(s, { type: "add-manual", page: 0, box: { x: 1, y: 1, w: 30, h: 30 } }),
      pdfReducer(s, { type: "set-all", keys: [], on: true }),
    ]) {
      expect(edit.confirmed).toBe(false);
      expect(edit.viewed.size).toBe(0);
    }
    // dpi and format do not move any box, so they keep the confirmation
    expect(pdfReducer(s, { type: "dpi", dpi: 300 }).confirmed).toBe(true);
  });

  it("a rescan keeps manual boxes and the findings the user switched off", async () => {
    let s = await loaded();
    const f = s.pages[2]?.findings[0];
    if (!f) throw new Error("no finding");
    s = pdfReducer(s, { type: "toggle", keys: [fkey(2, f)], on: false });
    s = pdfReducer(s, { type: "add-manual", page: 2, box: { x: 5, y: 5, w: 40, h: 40 } });
    const findings = await Promise.all(s.pages.map((p) => engine.scan(p.data.text, { sensitivity: "HATI_HATI", referenceDate: { year: 2026, month: 11, day: 25 } })));
    const again = pdfReducer(s, { type: "scanned", findings, sensitivity: "HATI_HATI" });
    expect(again.off.has(fkey(2, f))).toBe(true);
    expect(again.manual[2]).toHaveLength(1);
    expect(again.confirmed).toBe(false);
  });

  it("clear drops the document data but keeps the user's output choices", async () => {
    let s = await loaded();
    s = pdfReducer(s, { type: "dpi", dpi: 300 });
    const c = pdfReducer(s, { type: "clear" });
    expect(c.pages).toEqual([]);
    expect(c.fileName).toBeNull();
    expect(c.dpi).toBe(300);
  });
});
