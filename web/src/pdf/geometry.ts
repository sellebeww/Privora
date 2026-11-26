// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Boxes live in "page space": points at scale 1 with the origin at the top left of the page as it is
// shown (page /Rotate and CropBox already applied by the pdf.js viewport). Preview and export multiply
// by their own scale, so one set of boxes serves both.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A box together with the review keys (findings) that produced it. Manual boxes have no sources. */
export interface TaggedBox {
  box: Box;
  sources: string[];
}

export type Matrix = readonly [number, number, number, number, number, number];

export const right = (b: Box) => b.x + b.w;
export const bottom = (b: Box) => b.y + b.h;

export function applyPoint(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Axis aligned box around points. Rotated or skewed text therefore gets a larger, never a smaller, box. */
export function boundingBox(points: readonly (readonly [number, number])[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Pixel rectangle for a box at a scale. Always rounds outwards, so the pixels can only cover more. */
export function pixelRect(b: Box, scale: number, maxW: number, maxH: number) {
  const x0 = Math.max(0, Math.floor(b.x * scale));
  const y0 = Math.max(0, Math.floor(b.y * scale));
  const x1 = Math.min(maxW, Math.ceil((b.x + b.w) * scale));
  const y1 = Math.min(maxH, Math.ceil((b.y + b.h) * scale));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(right(a), right(b)) - x, h: Math.max(bottom(a), bottom(b)) - y };
};

/** Same text line (vertical overlap of at least 60 percent of the smaller box) and close or overlapping horizontally. */
function adjacent(a: Box, b: Box): boolean {
  const small = Math.min(a.h, b.h);
  const overlapY = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  if (overlapY < 0.6 * small) return false;
  const gap = Math.max(a.x, b.x) - Math.min(right(a), right(b));
  return gap <= 0.5 * small;
}

/**
 * Merge boxes that sit next to each other on one line. The union only ever covers more than its
 * members, and keeps every source key so that removing the merged box switches all of them off.
 */
export function mergeBoxes(input: readonly TaggedBox[]): TaggedBox[] {
  const list = input.map((t) => ({ box: { ...t.box }, sources: [...t.sources] }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < list.length && !changed; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (!a || !b || !adjacent(a.box, b.box)) continue;
        a.box = union(a.box, b.box);
        a.sources = [...new Set([...a.sources, ...b.sources])];
        list.splice(j, 1);
        changed = true;
        break;
      }
    }
  }
  return list;
}
