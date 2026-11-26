// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { pageHasImages, type PdfjsModule } from "./loader.ts";
import { openNode } from "./nodeSupport.ts";

/** `pageHasImages` against the Node build of pdf.js. */
export async function pageHasImagesNode(data: Uint8Array, pageNumber: number): Promise<boolean> {
  const { pdfjs, doc } = await openNode(data);
  const page = await doc.getPage(pageNumber);
  return pageHasImages(pdfjs as unknown as PdfjsModule, page as never);
}
