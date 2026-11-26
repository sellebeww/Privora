// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Export: every page is rendered to a canvas, the boxes are painted solid black, the pixels are encoded,
// and a new PDF is assembled that contains only those images (writer.ts). One page at a time, so memory
// stays about one page; a macrotask yield between pages keeps the interface alive; the abort signal is
// honoured between and inside pages. Browser only.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { encodeJpeg, encodeLossless, JPEG_QUALITY, type OutputFormat } from "./encode.ts";
import type { Box } from "./geometry.ts";
import { drawBoxes, rectsAreBlack, renderPage, scaleFor } from "./render.ts";
import { PdfWriter } from "./writer.ts";

export interface ExportOptions {
  dpi: number;
  format: OutputFormat;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}
export interface ExportResult {
  blob: Blob;
  pages: number;
  bytes: number;
  /** Lowest effective dpi used (lower than requested when a page was too large for a canvas). */
  minDpi: number;
  ms: number;
}

export class ExportError extends Error {
  readonly code: "CANCELLED" | "VERIFY_FAILED" | "FAILED";
  constructor(code: ExportError["code"]) {
    super(code);
    this.name = "ExportError";
    this.code = code;
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function exportRedacted(doc: PDFDocumentProxy, boxesByPage: readonly (readonly Box[])[], opts: ExportOptions): Promise<ExportResult> {
  const t0 = performance.now();
  const total = doc.numPages;
  if (boxesByPage.length !== total) throw new ExportError("FAILED");
  const writer = new PdfWriter();
  const canvas = document.createElement("canvas");
  let minDpi = opts.dpi;
  try {
    for (let i = 0; i < total; i += 1) {
      if (opts.signal?.aborted) throw new ExportError("CANCELLED");
      const page = await doc.getPage(i + 1);
      const one = page.getViewport({ scale: 1 });
      const scale = scaleFor(one.width, one.height, opts.dpi);
      minDpi = Math.min(minDpi, Math.round(scale * 72));
      await renderPage(page, canvas, scale, opts.signal);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new ExportError("FAILED");
      const rects = drawBoxes(ctx, boxesByPage[i] ?? [], scale);
      // Checked on the canvas, before encoding, for both formats.
      if (!rectsAreBlack(ctx, rects)) throw new ExportError("VERIFY_FAILED");
      const w = canvas.width;
      const h = canvas.height;
      const enc =
        opts.format === "LOSSLESS"
          ? await encodeLossless((y, n) => ctx.getImageData(0, y, w, n).data, w, h, opts.signal)
          : encodeJpeg(await toJpeg(canvas), w, h);
      writer.addPage({ widthPt: one.width, heightPt: one.height, widthPx: w, heightPx: h, ...enc });
      page.cleanup();
      opts.onProgress?.(i + 1, total);
      await tick();
    }
  } catch (e) {
    if (e instanceof ExportError) throw e;
    if (opts.signal?.aborted || (e instanceof DOMException && e.name === "AbortError") || (e instanceof Error && /cancel/i.test(e.name + e.message))) {
      throw new ExportError("CANCELLED");
    }
    throw new ExportError("FAILED");
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
  const parts = writer.finish();
  const blob = new Blob(parts as BlobPart[], { type: "application/pdf" });
  return { blob, pages: total, bytes: blob.size, minDpi, ms: Math.round(performance.now() - t0) };
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? void b.arrayBuffer().then((x) => resolve(new Uint8Array(x)), reject) : reject(new Error("JPEG_FAILED"))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
