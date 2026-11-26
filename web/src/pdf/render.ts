// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// One way to draw a page, used by BOTH the preview and the export, so what the user checks is what is
// written. Annotations are drawn too (their look is part of the page; their text is not scanned,
// which the UI says). Browser only.
import type { PDFPageProxy } from "pdfjs-dist";
import { pixelRect, type Box } from "./geometry.ts";

/** pdf.js AnnotationMode.ENABLE: draw annotation appearances, no form widgets (this is not a form editor). */
const ANNOTATION_ENABLE = 1;
/** Browsers refuse or crash on huge canvases; stay well inside what they all support. */
export const MAX_SIDE_PX = 8192;
export const MAX_PIXELS = 50_000_000;

/** Render scale for a dpi (72 points per inch), reduced if the page would not fit in a canvas. */
export function scaleFor(widthPt: number, heightPt: number, dpi: number): number {
  const want = dpi / 72;
  const bySide = MAX_SIDE_PX / Math.max(widthPt, heightPt, 1);
  const byArea = Math.sqrt(MAX_PIXELS / Math.max(widthPt * heightPt, 1));
  return Math.min(want, bySide, byArea);
}

export async function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement, scale: number, signal?: AbortSignal): Promise<void> {
  const viewport = page.getViewport({ scale });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: false });
  if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const task = page.render({ canvasContext: ctx, canvas, viewport, annotationMode: ANNOTATION_ENABLE, background: "#ffffff" });
  const onAbort = () => task.cancel();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await task.promise;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Solid black over every box. Rounds outwards (see `pixelRect`). Returns the rectangles it filled. */
export function drawBoxes(ctx: CanvasRenderingContext2D, boxes: readonly Box[], scale: number) {
  const rects = boxes.map((b) => pixelRect(b, scale, ctx.canvas.width, ctx.canvas.height));
  // Nothing the page drawing may have left behind can move, fade or blend the boxes.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.fillStyle = "#000000";
  for (const r of rects) ctx.fillRect(r.x, r.y, r.w, r.h);
  return rects;
}

/** Read the filled rectangles back and check they are pure black. A browser that scrambles canvas reads fails here, loudly. */
export function rectsAreBlack(ctx: CanvasRenderingContext2D, rects: readonly { x: number; y: number; w: number; h: number }[]): boolean {
  for (const r of rects) {
    if (r.w === 0 || r.h === 0) continue;
    const d = ctx.getImageData(r.x, r.y, r.w, r.h).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] !== 0 || d[i + 1] !== 0 || d[i + 2] !== 0) return false;
  }
  return true;
}
