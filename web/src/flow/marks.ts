// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Pure helpers for the review view: display marks, document blocks, selection to spans.
import type { Span } from "../engine/types.ts";

export interface Row {
  key: string;
  start: number;
  end: number;
  /** Null for a manual selection. */
  kind: string | null;
  selected: boolean;
}

/** One highlighted stretch of the document: either all hidden (selected) or all left visible. */
export interface Mark {
  start: number;
  end: number;
  /** True when at least one selected row covers the whole stretch. */
  selected: boolean;
  /** Keys of the rows that cover the stretch; the first one is the one the mark focuses. */
  keys: string[];
}

/** Elementary pieces of one cluster of overlapping rows, then adjacent pieces with the same state merged. */
function splitCluster(c: readonly Row[]): Mark[] {
  const cuts = [...new Set(c.flatMap((r) => [r.start, r.end]))].sort((x, y) => x - y);
  const out: Mark[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i]!;
    const b = cuts[i + 1]!;
    const cover = c.filter((r) => r.start <= a && r.end >= b);
    if (cover.length === 0) continue;
    const selected = cover.some((r) => r.selected);
    const last = out[out.length - 1];
    if (last && last.end === a && last.selected === selected) {
      last.end = b;
      for (const r of cover) if (!last.keys.includes(r.key)) last.keys.push(r.key);
    } else {
      out.push({ start: a, end: b, selected, keys: cover.map((r) => r.key) });
    }
  }
  return out;
}

/**
 * Disjoint, sorted marks for display. Rows may overlap (a manual range over a finding). Where they do,
 * the stretch is shown as selected only where a selected row really covers it, so a leftover visible
 * part of a deselected finding is never drawn as hidden.
 */
export function buildMarks(rows: readonly Row[]): Mark[] {
  const sorted = [...rows].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Mark[] = [];
  let cluster: Row[] = [];
  let reach = -1;
  const flush = () => {
    if (cluster.length === 1) {
      const r = cluster[0]!;
      out.push({ start: r.start, end: r.end, selected: r.selected, keys: [r.key] });
    } else if (cluster.length > 1) out.push(...splitCluster(cluster));
    cluster = [];
  };
  for (const r of sorted) {
    if (cluster.length > 0 && r.start >= reach) flush();
    cluster.push(r);
    reach = cluster.length === 1 ? r.end : Math.max(reach, r.end);
  }
  flush();
  return out;
}

/** The selected rows as spans for redact and tokenize (the engine merges overlaps itself). */
export function spansOf(rows: readonly Row[]): Span[] {
  return rows.filter((r) => r.selected).map((r) => ({ start: r.start, end: r.end, kind: r.kind as Span["kind"] }));
}

export interface Block {
  start: number;
  end: number;
}

const isHigh = (u: number) => u >= 0xd800 && u < 0xdc00;

/** Cut the text into blocks of about `target` units, at line ends when possible, never inside a surrogate pair. */
export function splitBlocks(text: string, target = 4000): Block[] {
  const out: Block[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + target);
    if (end < text.length) {
      const nl = text.indexOf("\n", end);
      // A line that is far longer than the target is cut instead of making a huge block.
      end = nl >= 0 && nl - end < target ? nl + 1 : end;
      if (end < text.length && isHigh(text.charCodeAt(end - 1))) end += 1;
    }
    out.push({ start: at, end });
    at = end;
  }
  return out;
}

export interface Piece {
  start: number;
  end: number;
  mark: Mark | null;
}

/** Pieces of one block: plain stretches and marks clipped to the block. `marks` must come from `buildMarks`. */
export function piecesOf(block: Block, marks: readonly Mark[], from: number): { pieces: Piece[]; next: number } {
  let i = from;
  while (i > 0 && marks[i - 1]!.end > block.start) i -= 1;
  while (i < marks.length && marks[i]!.end <= block.start) i += 1;
  const pieces: Piece[] = [];
  let at = block.start;
  let j = i;
  while (j < marks.length && marks[j]!.start < block.end) {
    const m = marks[j]!;
    const s = Math.max(m.start, block.start);
    const e = Math.min(m.end, block.end);
    if (s > at) pieces.push({ start: at, end: s, mark: null });
    pieces.push({ start: s, end: e, mark: m });
    at = e;
    j += 1;
  }
  if (at < block.end) pieces.push({ start: at, end: block.end, mark: null });
  return { pieces, next: i };
}

/** Trim whitespace at the edges of a selection. Null when nothing is left. */
export function trimRange(text: string, start: number, end: number): { start: number; end: number } | null {
  let s = Math.max(0, Math.min(start, end));
  let e = Math.min(text.length, Math.max(start, end));
  while (s < e && /\s/.test(text[s]!)) s += 1;
  while (e > s && /\s/.test(text[e - 1]!)) e -= 1;
  // Do not start or end inside a surrogate pair.
  if (s < e && text.charCodeAt(s) >= 0xdc00 && text.charCodeAt(s) < 0xe000) s -= 1;
  if (s < e && isHigh(text.charCodeAt(e - 1))) e += 1;
  return s < e ? { start: s, end: e } : null;
}

/** Estimated block height in px for a monospace layout: lines times line height. */
export function estimateHeight(text: string, b: Block, charsPerLine: number, lineHeight: number): number {
  const cpl = Math.max(8, charsPerLine);
  let lines = 0;
  let at = b.start;
  while (at < b.end) {
    const nl = text.indexOf("\n", at);
    const stop = nl < 0 || nl >= b.end ? b.end : nl + 1;
    const len = Math.max(1, stop - at - (stop > at && text[stop - 1] === "\n" ? 1 : 0));
    lines += Math.ceil(len / cpl);
    at = stop;
  }
  return Math.max(1, lines) * lineHeight;
}
