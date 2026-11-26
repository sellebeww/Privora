// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Findings (text offsets) to boxes on the page, in the two modes.
import { mergeBoxes, type TaggedBox } from "./geometry.ts";
import { itemSpanBox, type PageText } from "./pageText.ts";

/** ITEM: the whole text item (default, safer). PRECISE: the estimated part of the item, with a margin. */
export type BoxMode = "ITEM" | "PRECISE";

export interface KeyedRange {
  key: string;
  start: number;
  end: number;
}

/** One box per item touched by the range (an item touched by two ranges gets one tagged box per range, merged later). */
export function boxesForRanges(page: PageText, ranges: readonly KeyedRange[], mode: BoxMode): TaggedBox[] {
  const out: TaggedBox[] = [];
  for (const r of ranges) {
    for (const it of page.items) {
      if (it.start >= r.end || it.end <= r.start) continue;
      const box = mode === "ITEM" ? it.box : itemSpanBox(it, r.start, r.end);
      out.push({ box, sources: [r.key] });
    }
  }
  return mergeBoxes(out);
}
