// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Lazy pdf.js: nothing of pdf.js is loaded until a PDF is opened. The worker,
// cMaps, standard fonts and image decoders are same-origin files (scripts/prepare-pdfjs-assets.mjs,
// D-9; pdf.js 6.x has no eval path left, see D-38). Documents never leave memory: `data` is an ArrayBuffer, no URL is ever fetched for a document.
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type PdfjsModule = typeof import("pdfjs-dist");

let loading: Promise<PdfjsModule> | null = null;

export function loadPdfjs(): Promise<PdfjsModule> {
  loading ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    return m;
  });
  loading.catch(() => (loading = null));
  return loading;
}

const assetUrl = (dir: string) => new URL(`${import.meta.env.BASE_URL}pdfjs/${dir}/`, document.baseURI).href;

export type PdfErrorCode = "PASSWORD" | "INVALID" | "FAILED" | "CANCELLED";
export class PdfError extends Error {
  readonly code: PdfErrorCode;
  constructor(code: PdfErrorCode) {
    super(code);
    this.name = "PdfError";
    this.code = code;
  }
}

/**
 * Open a PDF from bytes. Password protected files are refused (not supported): pdf.js is not given a password and nothing is sent anywhere.
 */
export interface OpenDoc {
  doc: PDFDocumentProxy;
  /** Release the worker side document. */
  destroy(): void;
}

export async function openPdf(data: ArrayBuffer): Promise<OpenDoc> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    cMapUrl: assetUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: assetUrl("standard_fonts"),
    wasmUrl: assetUrl("wasm"),
    useSystemFonts: false,
    enableXfa: false,
  });
  try {
    return { doc: await task.promise, destroy: () => void task.destroy().catch(() => undefined) };
  } catch (e) {
    void task.destroy().catch(() => undefined);
    const name = e instanceof Error ? e.name : "";
    if (name === "PasswordException") throw new PdfError("PASSWORD");
    if (name === "InvalidPDFException" || name === "FormatError" || name === "MissingPDFException") throw new PdfError("INVALID");
    throw new PdfError("FAILED");
  }
}

/** True when the page paints at least one image: a page with almost no text and an image looks scanned. */
export async function pageHasImages(pdfjs: PdfjsModule, page: PDFPageProxy): Promise<boolean> {
  const list = await page.getOperatorList();
  const { paintImageXObject, paintInlineImageXObject, paintImageMaskXObject, paintJpegXObject } = pdfjs.OPS as Record<string, number>;
  const image = new Set([paintImageXObject, paintInlineImageXObject, paintImageMaskXObject, paintJpegXObject].filter((x) => x !== undefined));
  return list.fnArray.some((f) => image.has(f));
}

export async function annotationCount(page: PDFPageProxy): Promise<number> {
  const a = await page.getAnnotations();
  return a.length;
}
