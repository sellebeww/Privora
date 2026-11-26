// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Document with highlights. Texts over VIRTUAL_OVER units render only the blocks near the viewport
// (estimated heights, replaced by measured ones). Every rendered piece is a span with `data-s` (its
// start offset), so a DOM selection maps back to exact UTF-16 offsets of the text.
import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { cx } from "../ui/cx";
import { estimateHeight, piecesOf, splitBlocks, type Block, type Mark } from "./marks";

// shortcut: one scroll container with the full estimated height; browsers cap an element at 17 to 33 million px,
// so texts beyond roughly 35 MB would scroll wrongly. Upgrade to a scaled scrollbar if such sizes matter.
export const VIRTUAL_OVER = 200_000;
const LINE = 24; // px, leading-6
const CHAR_W = 7.8; // px, Geist Mono 13px advance
const PAD_X = 48; // px, horizontal padding of the scroller
const OVERSCAN = 1200; // px

export interface DocViewHandle {
  /** Scroll to an offset and, when `key` is given, focus the mark that holds that row. */
  jumpTo(offset: number, key?: string): void;
}

export interface DocViewProps {
  text: string;
  marks: readonly Mark[];
  label: string;
  /** Raw selection (not trimmed) as offsets, or null when nothing is selected inside the document. */
  onSelection?: (r: { start: number; end: number } | null) => void;
  /** A click on a mark (not a drag): the keys of the rows inside it. */
  onMarkClick?: (keys: string[]) => void;
  handle?: Ref<DocViewHandle>;
  className?: string;
}

interface BlockViewProps {
  text: string;
  block: Block;
  index: number;
  marks: readonly Mark[];
  from: number;
  setEl: (i: number, el: HTMLDivElement | null) => void;
}

const BlockView = memo(function BlockView({ text, block, index, marks, from, setEl }: BlockViewProps) {
  const { pieces } = piecesOf(block, marks, from);
  return (
    <div ref={(el) => setEl(index, el)} data-block={index} className="font-mono text-small leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]">
      {pieces.map((p) =>
        p.mark ? (
          <mark
            key={p.start}
            data-s={p.start}
            data-keys={p.mark.keys.join(" ")}
            tabIndex={-1}
            className={cx(
              "cursor-pointer px-0 text-fg",
              p.mark.selected ? "border-b-2 border-accent bg-accent-subtle" : "border-b border-dashed border-fg-muted bg-transparent",
            )}
          >
            {text.slice(p.start, p.end)}
          </mark>
        ) : (
          <span key={p.start} data-s={p.start}>
            {text.slice(p.start, p.end)}
          </span>
        ),
      )}
    </div>
  );
});

/** Offset in the text for a DOM point, or null when the point is outside the rendered text. */
export function pointToOffset(root: HTMLElement, node: Node, offset: number): number | null {
  if (!root.contains(node)) return null;
  const holder = (n: Node): HTMLElement | null => (n.nodeType === 1 ? (n as HTMLElement) : n.parentElement)?.closest<HTMLElement>("[data-s]") ?? null;
  if (node.nodeType === 3) {
    const h = holder(node);
    return h ? Number(h.dataset["s"]) + offset : null;
  }
  const el = node as HTMLElement;
  if (el.dataset["s"] !== undefined) return Number(el.dataset["s"]) + (offset > 0 ? (el.textContent ?? "").length : 0);
  const child = el.childNodes[offset];
  if (child) {
    const first = child.nodeType === 1 && (child as HTMLElement).dataset["s"] === undefined ? (child as HTMLElement).querySelector<HTMLElement>("[data-s]") : holder(child);
    return first ? Number(first.dataset["s"]) : null;
  }
  const all = el.querySelectorAll<HTMLElement>("[data-s]");
  const last = all[all.length - 1];
  return last ? Number(last.dataset["s"]) + (last.textContent ?? "").length : null;
}

export function DocView({ text, marks, label, onSelection, onMarkClick, handle, className }: DocViewProps) {
  const virtual = text.length > VIRTUAL_OVER;
  const blocks = useMemo(() => splitBlocks(text), [text]);
  const scroller = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<number, HTMLDivElement>());
  const measured = useRef(new Map<number, number>());
  const [width, setWidth] = useState(720);
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  const [, bump] = useState(0);

  // Mark index each block starts from, so `piecesOf` does not scan from the beginning every time.
  const startIdx = useMemo(() => {
    const out: number[] = [];
    let j = 0;
    for (const b of blocks) {
      while (j < marks.length && marks[j]!.end <= b.start) j += 1;
      out.push(j);
    }
    return out;
  }, [blocks, marks]);

  const cpl = Math.floor((width - PAD_X) / CHAR_W);
  const heights = useMemo(() => {
    measured.current.clear();
    return blocks.map((b) => estimateHeight(text, b, cpl, LINE));
    // measured heights are layered on top below; they are reset when the text or the width changes
  }, [blocks, text, cpl]);
  const heightOf = (i: number) => measured.current.get(i) ?? heights[i] ?? LINE;
  const offsets = (() => {
    const o = new Array<number>(blocks.length + 1);
    o[0] = 0;
    for (let i = 0; i < blocks.length; i++) o[i + 1] = o[i]! + heightOf(i);
    return o;
  })();
  const total = offsets[blocks.length] ?? 0;

  let first = 0;
  let last = blocks.length - 1;
  if (virtual) {
    const lo = scroll.top - OVERSCAN;
    const hi = scroll.top + scroll.height + OVERSCAN;
    while (first < last && offsets[first + 1]! <= lo) first += 1;
    last = first;
    while (last < blocks.length - 1 && offsets[last + 1]! < hi) last += 1;
  }

  const setEl = useCallback((i: number, el: HTMLDivElement | null) => {
    if (el) els.current.set(i, el);
    else els.current.delete(i);
  }, []);

  // Replace estimates by real heights of what is on screen.
  useLayoutEffect(() => {
    if (!virtual) return;
    let changed = false;
    for (const [i, el] of els.current) {
      const h = el.offsetHeight;
      if (h > 0 && Math.abs((measured.current.get(i) ?? heights[i] ?? 0) - h) > 0.5) {
        measured.current.set(i, h);
        changed = true;
      }
    }
    // Measuring then re-rendering with the real heights is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (changed) bump((n) => n + 1);
  }, [virtual, first, last, heights, width]);

  useEffect(() => {
    const s = scroller.current;
    if (!s) return;
    const read = () => {
      setWidth(s.clientWidth);
      setScroll((p) => (p.height === s.clientHeight ? p : { ...p, height: s.clientHeight }));
    };
    if (typeof ResizeObserver === "undefined") return;
    // Fires once when observation starts, so the first size is read here too.
    const ro = new ResizeObserver(read);
    ro.observe(s);
    return () => ro.disconnect();
  }, []);

  const raf = useRef(0);
  const onScroll = () => {
    if (!virtual || raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const s = scroller.current;
      if (s) setScroll({ top: s.scrollTop, height: s.clientHeight });
    });
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const pending = useRef<{ offset: number; key?: string } | null>(null);
  const settle = useCallback(() => {
    const p = pending.current;
    const s = scroller.current;
    if (!p || !s) return;
    const sel = p.key ? `mark[data-keys~="${CSS.escape(p.key)}"]` : `[data-s]`;
    const target = s.querySelector<HTMLElement>(sel);
    if (p.key && target) {
      pending.current = null;
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    } else if (!p.key) {
      pending.current = null;
    }
  }, []);
  useImperativeHandle(handle, () => ({
    jumpTo(offset, key) {
      const s = scroller.current;
      if (!s) return;
      let i = 0;
      let lo = 0;
      let hi = blocks.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (blocks[mid]!.end <= offset) {
          lo = mid + 1;
        } else {
          i = mid;
          hi = mid - 1;
        }
      }
      pending.current = { offset, key };
      if (virtual) {
        s.scrollTop = Math.max(0, offsets[i]! - 40);
        setScroll({ top: s.scrollTop, height: s.clientHeight });
      }
      // The block may mount on the next frames; try a few times, then give up.
      let tries = 0;
      const step = () => {
        settle();
        if (pending.current && tries++ < 6) requestAnimationFrame(step);
        else pending.current = null;
      };
      requestAnimationFrame(step);
    },
  }));

  // Selection inside the document, reported as offsets.
  useEffect(() => {
    if (!onSelection) return;
    const on = () => {
      const s = scroller.current;
      const sel = document.getSelection();
      if (!s || !sel || sel.rangeCount === 0 || sel.isCollapsed) return onSelection(null);
      const r = sel.getRangeAt(0);
      const a = pointToOffset(s, r.startContainer, r.startOffset);
      const b = pointToOffset(s, r.endContainer, r.endOffset);
      onSelection(a === null || b === null ? null : { start: Math.min(a, b), end: Math.max(a, b) });
    };
    document.addEventListener("selectionchange", on);
    return () => document.removeEventListener("selectionchange", on);
  }, [onSelection]);

  const onClick = (e: React.MouseEvent) => {
    const m = (e.target as HTMLElement).closest<HTMLElement>("mark[data-keys]");
    if (!m || !onMarkClick || !document.getSelection()?.isCollapsed) return;
    onMarkClick((m.dataset["keys"] ?? "").split(" ").filter(Boolean));
  };

  const rendered = [];
  for (let i = first; i <= last && i < blocks.length; i++) {
    rendered.push(<BlockView key={i} text={text} block={blocks[i]!} index={i} marks={marks} from={startIdx[i] ?? 0} setEl={setEl} />);
  }
  return (
    <div
      ref={scroller}
      role="region"
      aria-label={label}
      tabIndex={0}
      onScroll={onScroll}
      onClick={onClick}
      className={cx("min-h-0 overflow-auto rounded-panel border border-border bg-bg-elevated px-6 py-4", className)}
    >
      {virtual && <div style={{ height: offsets[first] }} aria-hidden="true" />}
      {rendered}
      {virtual && <div style={{ height: Math.max(0, total - (offsets[last + 1] ?? total)) }} aria-hidden="true" />}
    </div>
  );
}
