// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Text of one PDF page from pdf.js, as `PageText` plus the page size. Structural types only, so the
// same code runs with the app build and with the Node (legacy) build of pdf.js in tests.
import { buildPageText, type PageText, type RawItem } from "./pageText.ts";
import type { Matrix } from "./geometry.ts";

export interface PageLike {
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] };
  getTextContent(): Promise<{ items: unknown[]; styles?: Record<string, { vertical?: boolean }> }>;
}

export interface PageData extends PageText {
  /** Page size in points as shown (rotation and CropBox applied). */
  width: number;
  height: number;
  /** Characters that are not white space: the measure for "this page has (almost) no text". */
  chars: number;
}

const isTextItem = (x: unknown): x is RawItem =>
  typeof x === "object" && x !== null && typeof (x as RawItem).str === "string" && Array.isArray((x as RawItem).transform);

export async function extractPage(page: PageLike): Promise<PageData> {
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const raw = content.items
    .filter(isTextItem)
    .map((it) => ({ ...it, vertical: content.styles?.[it.fontName ?? ""]?.vertical === true }));
  const t = buildPageText(raw, vp.transform as unknown as Matrix);
  return { ...t, width: vp.width, height: vp.height, chars: t.text.replace(/\s/g, "").length };
}

/** Fewer characters than this on a page that has an image: shown as "looks scanned". */
export const SCAN_LOOK_CHARS = 20;
