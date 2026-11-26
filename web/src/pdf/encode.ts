// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Pixel encoding for the output PDF. Two formats:
// LOSSLESS (default): RGB samples, PNG "Up" predictor, zlib through CompressionStream. A black box
// stays exactly black, so "every pixel inside the box is black" can be tested to the bit.
// JPEG: smaller for photographs, lossy: near the box edges the codec can leak a few grey levels.
import type { PagePicture } from "./writer.ts";
import { stripJpeg } from "./writer.ts";

export type OutputFormat = "LOSSLESS" | "JPEG";
export const JPEG_QUALITY = 0.92;
const STRIP_ROWS = 64;

/** `rows(y, n)` returns RGBA samples of n rows starting at row y (what `getImageData` gives). */
export type RowSource = (y: number, n: number) => Uint8ClampedArray;

export async function encodeLossless(
  rows: RowSource,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<Pick<PagePicture, "data" | "filter" | "colors" | "predictor">> {
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  const drain = (async () => {
    for (;;) {
      const r = await reader.read();
      if (r.done) return;
      chunks.push(r.value);
    }
  })();
  try {
    const stride = width * 3;
    let prev = new Uint8Array(stride); // row above: zeros for the first row
    for (let y = 0; y < height; y += STRIP_ROWS) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const n = Math.min(STRIP_ROWS, height - y);
      const rgba = rows(y, n);
      const out = new Uint8Array(n * (stride + 1));
      for (let r = 0; r < n; r += 1) {
        const o = r * (stride + 1);
        out[o] = 2; // PNG filter type Up
        const cur = new Uint8Array(stride);
        for (let x = 0, s = r * width * 4; x < width; x += 1, s += 4) {
          cur[x * 3] = rgba[s] ?? 0;
          cur[x * 3 + 1] = rgba[s + 1] ?? 0;
          cur[x * 3 + 2] = rgba[s + 2] ?? 0;
        }
        for (let i = 0; i < stride; i += 1) out[o + 1 + i] = ((cur[i] ?? 0) - (prev[i] ?? 0)) & 0xff;
        prev = cur;
      }
      await writer.write(out);
    }
    await writer.close();
  } catch (e) {
    await writer.abort(e).catch(() => undefined);
    await reader.cancel().catch(() => undefined);
    await drain.catch(() => undefined);
    throw e;
  }
  await drain;
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const data = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    data.set(c, at);
    at += c.length;
  }
  return { data, filter: "FLATE", colors: 3, predictor: true };
}

export function encodeJpeg(jpeg: Uint8Array, width: number, height: number): Pick<PagePicture, "data" | "filter" | "colors"> {
  const info = stripJpeg(jpeg);
  if (info.width !== width || info.height !== height) throw new RangeError("JPEG size differs from the canvas");
  return { data: info.bytes, filter: "DCT", colors: info.components === 1 ? 1 : 3 };
}
