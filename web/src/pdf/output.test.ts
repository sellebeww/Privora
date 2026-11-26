// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Security checks on the PDF that Privora writes, without a browser: the bytes are parsed
// by an independent auditor (audit.ts) that accepts only "pages that draw one image". The same
// checks run on a real exported file in web/e2e/pdf.spec.ts. Pixel level checks use the lossless format.
import { describe, expect, it } from "vitest";
import { auditPdf, decodeLossless, maxInside, secretsInBytes } from "./audit.ts";
import { encodeJpeg, encodeLossless } from "./encode.ts";
import { openNode } from "./nodeSupport.ts";
import { makeTestPdf } from "./testPdf.ts";
import { concat, PdfWriter, stripJpeg } from "./writer.ts";

const NIK = "3171011505900001";

/** RGBA page: white, with grey "ink" noise and black boxes. Deterministic. */
function page(width: number, height: number, boxes: { x: number; y: number; w: number; h: number }[]) {
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let i = 0; i < width * height; i += 1) {
    const x = i % width;
    const y = Math.floor(i / width);
    if ((x * 7 + y * 13) % 11 === 0) rgba.set([40 + (x % 50), 90, 200 - (y % 60), 255], i * 4); // text like specks
  }
  for (const b of boxes) {
    for (let y = b.y; y < b.y + b.h; y += 1) for (let x = b.x; x < b.x + b.w; x += 1) rgba.set([0, 0, 0, 255], (y * width + x) * 4);
  }
  return rgba;
}
const rows = (rgba: Uint8ClampedArray, width: number) => (y: number, n: number) => rgba.subarray(y * width * 4, (y + n) * width * 4);

async function writeLossless(specs: { w: number; h: number; boxes: { x: number; y: number; w: number; h: number }[] }[]) {
  const wr = new PdfWriter();
  const pixels: Uint8ClampedArray[] = [];
  for (const s of specs) {
    const rgba = page(s.w, s.h, s.boxes);
    pixels.push(rgba);
    const enc = await encodeLossless(rows(rgba, s.w), s.w, s.h);
    wr.addPage({ widthPt: s.w * 0.48, heightPt: s.h * 0.48, widthPx: s.w, heightPx: s.h, ...enc });
  }
  return { bytes: concat(wr.finish()), pixels };
}

describe("output file: only pixels", () => {
  const specs = [
    { w: 200, h: 150, boxes: [{ x: 10, y: 20, w: 50, h: 12 }, { x: 100, y: 100, w: 80, h: 30 }] },
    { w: 120, h: 220, boxes: [] },
    { w: 333, h: 111, boxes: [{ x: 0, y: 0, w: 333, h: 5 }] },
  ];

  it("lossless: decoded pixels equal the source exactly and every pixel in each box is black", async () => {
    const { bytes, pixels } = await writeLossless(specs);
    const report = auditPdf(bytes);
    expect(report.problems).toEqual([]);
    expect(report.pages).toHaveLength(3);
    report.pages.forEach((p, i) => {
      const spec = specs[i];
      const src = pixels[i];
      if (!spec || !src) throw new Error("spec");
      const rgb = decodeLossless(p.image);
      for (let k = 0; k < spec.w * spec.h; k += 1) {
        expect([rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2]]).toEqual([src[k * 4], src[k * 4 + 1], src[k * 4 + 2]]);
      }
      for (const b of spec.boxes) expect(maxInside(rgb, spec.w, b)).toBe(0);
    });
  });

  it("pdf.js opens it: right page count and size, no text items, no annotations, no metadata, no attachments, no outline", async () => {
    const { bytes } = await writeLossless(specs);
    const { doc, close } = await openNode(bytes);
    expect(doc.numPages).toBe(3);
    for (let i = 1; i <= 3; i += 1) {
      const p = await doc.getPage(i);
      const vp = p.getViewport({ scale: 1 });
      expect(vp.width).toBeCloseTo((specs[i - 1]?.w ?? 0) * 0.48, 1);
      expect(vp.height).toBeCloseTo((specs[i - 1]?.h ?? 0) * 0.48, 1);
      expect((await p.getTextContent()).items).toHaveLength(0);
      expect(await p.getAnnotations()).toHaveLength(0);
    }
    const meta = await doc.getMetadata();
    // pdf.js adds its own flags (Language null, IsLinearized false ...); no author, title, producer or other string may exist.
    expect(Object.entries(meta.info).filter(([k, v]) => k !== "PDFFormatVersion" && v !== null && typeof v !== "boolean")).toEqual([]);
    expect(meta.metadata).toBeNull();
    expect(await doc.getAttachments()).toBeNull();
    expect(await doc.getOutline()).toBeNull();
    expect(await doc.getJSActions()).toBeNull();
    expect(await doc.getOpenAction()).toBeNull();
    expect(await doc.getFieldObjects()).toBeNull();
    await close();
  });

  it("the auditor is not blind: it rejects a source-like PDF and tampered outputs", async () => {
    const source = makeTestPdf({ pages: [{ width: 300, height: 300, pieces: [{ text: `NIK ${NIK}`, x: 20, y: 200 }], extras: true }], info: { author: "Budi Contoh", title: "SINTETIS" } });
    expect(auditPdf(source).problems.length).toBeGreaterThan(0);
    const { bytes } = await writeLossless([specs[0] as (typeof specs)[number]]);
    const text = new TextDecoder("latin1").decode(bytes);
    const tamper = (from: string, to: string) => Uint8Array.from(text.replace(from, to), (c) => c.charCodeAt(0));
    expect(auditPdf(tamper("/Type /Catalog", "/Type /Catalog /Metadata 9 0 R")).problems.length).toBeGreaterThan(0);
    expect(auditPdf(tamper("trailer\n<< /Size", "trailer\n<< /Info 1 0 R /Size")).problems.length).toBeGreaterThan(0);
    expect(auditPdf(tamper("/Im0 Do Q", "/Im0 Do Q BT /F1 12 Tf (x) Tj ET")).problems.length).toBeGreaterThan(0);
    expect(auditPdf(tamper("/Resources <<", "/Annots [] /Resources <<")).problems.length).toBeGreaterThan(0);
    expect(auditPdf(bytes).problems).toEqual([]);
  });

  it("byte search finds a secret in a source PDF (positive control) and never in the output", async () => {
    const source = makeTestPdf({ pages: [{ width: 300, height: 300, pieces: [{ text: `NIK ${NIK}`, x: 20, y: 200 }], extras: true }], info: { author: "Budi Contoh", title: "SINTETIS" } });
    expect(secretsInBytes(source, [NIK, "Budi Contoh", "lampiran.txt"]).sort()).toEqual(["Budi Contoh", "lampiran.txt", NIK].sort());
    const { bytes } = await writeLossless(specs);
    expect(secretsInBytes(bytes, [NIK, "Budi Contoh", "lampiran.txt", "SINTETIS", "Courier", "Helvetica", "pdf.js", "Privora"])).toEqual([]);
  });

  it("a writer needs a page, and refuses non finite sizes", () => {
    expect(() => new PdfWriter().finish()).toThrow();
    const w = new PdfWriter();
    expect(() => w.addPage({ widthPt: Number.NaN, heightPt: 1, widthPx: 1, heightPx: 1, filter: "FLATE", colors: 3, data: new Uint8Array(1) })).toThrow();
  });

  it("lossless encoding of a letter size page at 150 dpi: time and size (recorded)", async () => {
    const w = 1275;
    const h = 1650;
    const rgba = page(w, h, [{ x: 100, y: 100, w: 400, h: 40 }]);
    const t0 = performance.now();
    const enc = await encodeLossless(rows(rgba, w), w, h);
    const ms = Math.round(performance.now() - t0);
    process.stderr.write(`\n[lossless 1275x1650 noisy synthetic page] ${enc.data.length} bytes in ${ms} ms (Node)\n`);
    expect(enc.data.length).toBeLessThan(w * h * 3);
  });

  it("encodeLossless stops when aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(encodeLossless(() => new Uint8ClampedArray(0), 10, 10, ac.signal)).rejects.toThrow();
  });
});

describe("JPEG: only the picture survives", () => {
  const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  const latin = (s: string) => [...s].map((c) => c.charCodeAt(0));
  // A structurally valid JPEG skeleton (tables are not decoded here): EXIF with a thumbnail text, ICC, XMP, a comment, then image data with stuffing and a restart marker.
  const jpeg = Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe0, latin("JFIF\0")),
    ...seg(0xe1, latin(`Exif\0\0 thumbnail NIK ${NIK}`)),
    ...seg(0xe2, latin("ICC_PROFILE\0")),
    ...seg(0xed, latin("Photoshop 3.0\0")),
    ...seg(0xfe, latin(`comment ${NIK}`)),
    ...seg(0xdb, [0, ...new Array(64).fill(1)]),
    ...seg(0xc0, [8, 0, 16, 0, 24, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ...seg(0xc4, [0, ...new Array(16).fill(0), 0]),
    ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]),
    0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78,
    0xff, 0xd9,
  ]);
  it("removes APPn and COM segments, keeps the frame and the scan data intact", () => {
    const info = stripJpeg(jpeg);
    expect(info).toMatchObject({ width: 24, height: 16, components: 3 });
    expect(secretsInBytes(info.bytes, [NIK, "Exif", "ICC_PROFILE", "JFIF", "Photoshop"])).toEqual([]);
    expect([...info.bytes.slice(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...info.bytes.slice(-2)]).toEqual([0xff, 0xd9]);
    // The entropy coded bytes, including the stuffed 0xFF00 and the restart marker, are unchanged.
    const tail = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78, 0xff, 0xd9];
    expect([...info.bytes.slice(-tail.length)]).toEqual(tail);
  });
  it("is used by encodeJpeg, which also checks the size matches the canvas", () => {
    expect(encodeJpeg(jpeg, 24, 16).filter).toBe("DCT");
    expect(() => encodeJpeg(jpeg, 25, 16)).toThrow();
  });
  it("rejects data that is not a JPEG, or is cut off", () => {
    expect(() => stripJpeg(new Uint8Array([1, 2, 3, 4, 5]))).toThrow();
    expect(() => stripJpeg(jpeg.slice(0, 40))).toThrow();
    expect(() => stripJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toThrow();
  });
  it("a PDF holding that JPEG passes the audit", () => {
    const info = stripJpeg(jpeg);
    const wr = new PdfWriter();
    wr.addPage({ widthPt: 24, heightPt: 16, widthPx: 24, heightPx: 16, filter: "DCT", colors: 3, data: info.bytes });
    const bytes = concat(wr.finish());
    expect(auditPdf(bytes).problems).toEqual([]);
    expect(secretsInBytes(bytes, [NIK])).toEqual([]);
  });
});
