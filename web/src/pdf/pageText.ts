// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Page text from pdf.js text items, plus the map from text offsets (UTF-16, like every offset in
// Privora) back to the items. Pure functions: no pdf.js import, so Node tests feed plain data.
import { applyPoint, boundingBox, type Box, type Matrix } from "./geometry.ts";

/** The fields of a pdf.js text item that are used. `transform` is in PDF user space. */
export interface RawItem {
  str: string;
  transform: readonly number[];
  width: number;
  height: number;
  hasEOL?: boolean;
  /** pdf.js direction of the run: "ltr", "rtl" or "ttb". */
  dir?: string;
  fontName?: string;
  /** The font writes top to bottom (taken from the pdf.js text styles). */
  vertical?: boolean;
}

// Glyph extent relative to the font size (item height). A little more than real ascenders and
// descenders, so a box over an item never leaves a tail of the glyphs visible.
export const DESCENT = 0.3;
export const ASCENT = 1.0;
export const SIDE_PAD = 0.1;
// Vertical writing: glyphs are centred on the origin and stack downwards, one after the other.
const VERTICAL_SIDE = 0.8;
const VERTICAL_PAD = 0.3;
/** Right to left characters: their order on screen is not their order in the string. */
const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;
/** Gaps up to this fraction of the font size are treated as no gap: the text is one run (split digits). */
export const JOIN_GAP = 0.1;

export interface PageItem {
  /** Offsets of `str` inside the page text; `end` exclusive. */
  start: number;
  end: number;
  /** Box over the whole item (mode "per item"). */
  box: Box;
  /** Page-space geometry for the precise mode: baseline origin, unit vectors along the text and "up". */
  origin: readonly [number, number];
  dir: readonly [number, number];
  up: readonly [number, number];
  /** Advance width and font size, in points. */
  width: number;
  size: number;
  /** Extent across the text, as multiples of the size along `up`. */
  lo: number;
  hi: number;
  /** Characters cannot be placed inside this item (vertical or right to left): always box it whole. */
  whole: boolean;
}

export interface PageText {
  text: string;
  items: PageItem[];
}

const unit = (x: number, y: number, fallback: [number, number]): [number, number] => {
  const n = Math.hypot(x, y);
  return n > 1e-9 ? [x / n, y / n] : fallback;
};

/** Corners of the item for the extent `t0..t1` (points along the text) and `s0..s1` (multiples of the size up). */
function cornersOf(p: Pick<PageItem, "origin" | "dir" | "up" | "size">, t0: number, t1: number, s0: number, s1: number) {
  const pts: [number, number][] = [];
  for (const t of [t0, t1]) {
    for (const s of [s0, s1]) {
      pts.push([p.origin[0] + p.dir[0] * t + p.up[0] * s * p.size, p.origin[1] + p.dir[1] * t + p.up[1] * s * p.size]);
    }
  }
  return pts;
}

export function itemBox(p: Pick<PageItem, "origin" | "dir" | "up" | "size" | "width" | "lo" | "hi">, pad = SIDE_PAD * p.size): Box {
  return boundingBox(cornersOf(p, -pad, p.width + pad, p.lo, p.hi));
}

/**
 * Text and item map of one page. `viewport` is the pdf.js viewport transform at scale 1, which
 * carries the page /Rotate and the CropBox. Items on one line whose gap is small are glued without a
 * space, so a NIK or phone number that the producer split across items stays one run. Items on
 * different lines are separated by a newline: a number broken across lines is NOT joined (limit).
 */
export function buildPageText(raw: readonly RawItem[], viewport: Matrix): PageText {
  let text = "";
  const items: PageItem[] = [];
  // Previous item in user space, for the line and gap decision.
  let prev: { o: [number, number]; u: [number, number]; w: number; h: number } | null = null;
  let pendingBreak = false;

  for (const it of raw) {
    const [a, b, c, d, e, f] = it.transform as [number, number, number, number, number, number];
    if (![a, b, c, d, e, f, it.width, it.height].every(Number.isFinite)) continue;
    if (it.str.length === 0) {
      if (it.hasEOL) pendingBreak = true;
      continue;
    }
    const base = unit(a, b, [1, 0]);
    const rise = unit(c, d, [-base[1], base[0]]);
    // In vertical writing the text runs down the page and pdf.js reports the advance as the height.
    const down = it.vertical === true;
    const u: [number, number] = down ? [-rise[0], -rise[1]] : base;
    const vUser = down ? base : rise;
    const advance = down ? it.height : it.width;
    const size = down ? Math.max(it.width, Math.hypot(a, b), 1e-3) : Math.max(it.height, Math.hypot(c, d), 1e-3);
    const o: [number, number] = [e, f];

    let sep = "";
    if (prev) {
      const dx = o[0] - prev.o[0];
      const dy = o[1] - prev.o[1];
      const along = dx * prev.u[0] + dy * prev.u[1];
      const across = -dx * prev.u[1] + dy * prev.u[0];
      const sameDir = u[0] * prev.u[0] + u[1] * prev.u[1] > 0.9;
      const sameLine = sameDir && Math.abs(across) < 0.5 * Math.max(prev.h, size);
      if (pendingBreak || !sameLine) sep = "\n";
      else if (along - prev.w > JOIN_GAP * size) sep = " ";
    }
    const startsWithSpace = /^\s/.test(it.str);
    const endsWithSpace = text.length > 0 && /\s$/.test(text);
    if (sep === " " && (startsWithSpace || endsWithSpace)) sep = "";
    text += sep;
    const start = text.length;
    text += it.str;

    // Map to page space: positions through the viewport, directions through its linear part.
    const [ox, oy] = applyPoint(viewport, o[0], o[1]);
    const lin = (x: number, y: number): [number, number] => [viewport[0] * x + viewport[2] * y, viewport[1] * x + viewport[3] * y];
    const dir = unit(...lin(u[0], u[1]), [1, 0]);
    const up = unit(...lin(vUser[0], vUser[1]), [0, -1]);
    const geo = {
      origin: [ox, oy] as const,
      dir,
      up,
      size,
      width: advance,
      lo: down ? -VERTICAL_SIDE : -DESCENT - SIDE_PAD,
      hi: down ? VERTICAL_SIDE : ASCENT + SIDE_PAD,
    };
    const whole = down || it.dir === "rtl" || RTL.test(it.str);
    items.push({ start, end: text.length, box: itemBox(geo, down ? VERTICAL_PAD * size : undefined), whole, ...geo });

    prev = { o, u, w: advance, h: size };
    pendingBreak = Boolean(it.hasEOL);
  }
  return { text, items };
}

/** Box over characters `from..to` of one item, assuming equal advance for every character (an estimate). */
export function itemSpanBox(p: PageItem, from: number, to: number): Box {
  if (p.whole || (from <= p.start && to >= p.end)) return p.box; // nothing to estimate
  const len = Math.max(1, p.end - p.start);
  const f0 = Math.min(len, Math.max(0, from - p.start)) / len;
  const f1 = Math.min(len, Math.max(0, to - p.start)) / len;
  // Safety margin: the estimate drifts with proportional fonts, so pad by a fixed part of the size
  // and a part of the whole advance. Wider than the span on purpose.
  const pad = 0.15 * p.size + 0.05 * p.width;
  return boundingBox(cornersOf(p, f0 * p.width - pad, f1 * p.width + pad, p.lo, p.hi));
}
