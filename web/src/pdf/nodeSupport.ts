// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Test support: the legacy (Node) build of pdf.js and the real engine, in process.
import { createEngine } from "../engine/engine.ts";
import { InProcessWorker, REF } from "../engine/testSupport.ts";
import type { Finding } from "../engine/types.ts";
import { extractPage, type PageData } from "./extract.ts";

const FONTS = new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;

export async function openNode(data: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: Uint8Array.from(data),
    useWorkerFetch: false,
    standardFontDataUrl: FONTS,
    verbosity: 0,
  });
  return { pdfjs, doc: await task.promise, close: () => task.destroy() };
}

export async function pagesOf(data: Uint8Array): Promise<PageData[]> {
  const { doc, close } = await openNode(data);
  const out: PageData[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) out.push(await extractPage(await doc.getPage(i)));
  await close();
  return out;
}

export const engine = createEngine(() => new InProcessWorker());
export const scanPage = (text: string): Promise<Finding[]> => engine.scan(text, { referenceDate: REF });
