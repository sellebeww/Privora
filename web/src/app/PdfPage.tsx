// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// One PDF page as a canvas. Two uses: "edit" (review: overlay boxes you can remove, draw and move) and
// "final" (read only: the boxes are painted INTO the canvas in solid black, like the export does, and
// the page counts as seen once it is on screen). Rendering uses the same code as the export.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { id } from "../i18n/id";
import type { Box } from "../pdf/geometry";
import { drawBoxes, renderPage } from "../pdf/render";
import type { PageBox } from "../pdf/state";
import { cx } from "../ui/cx";

export interface PdfPageViewProps {
  doc: PDFDocumentProxy;
  index: number;
  /** Page size in points (rotation applied). */
  size: { w: number; h: number };
  boxes: readonly PageBox[];
  /** Width of the page on screen, in CSS pixels. */
  width: number;
  mode: "edit" | "final";
  /** Final mode: called once the page is rendered and mostly on screen. */
  onSeen?: (index: number) => void;
  onRemove?: (box: PageBox) => void;
  onDraw?: (box: Box) => void;
  onMove?: (id: number, box: Box) => void;
}

const pct = (v: number, total: number) => `${(v / total) * 100}%`;
const STEP = 4; // points per arrow key press
const HIT = 32; // minimum touch target in CSS pixels

export function PdfPageView(p: PdfPageViewProps) {
  const { doc, index, size, boxes, width, mode } = p;
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const bottomEdge = useRef<HTMLDivElement>(null);
  // Result of the last render, tagged with what it was rendered for: anything else counts as "loading".
  const [done, setDone] = useState<{ key: string; ok: boolean } | null>(null);
  const [near, setNear] = useState(mode === "edit");
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const height = (width * size.h) / size.w;
  const bakedKey = mode === "final" ? boxes.map((b) => `${b.box.x},${b.box.y},${b.box.w},${b.box.h}`).join("|") : "";

  const renderKey = `${doc.fingerprints?.[0] ?? ""}|${index}|${width}|${mode}|${bakedKey}`;
  const state = !near ? "idle" : done?.key !== renderKey ? "loading" : done.ok ? "ready" : "failed";

  // Final mode renders only pages that are close to the viewport, and frees the pixels of far ones.
  useEffect(() => {
    if (mode !== "final" || !frame.current) return;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => setNear(e.isIntersecting)), { rootMargin: "800px 0px" });
    io.observe(frame.current);
    return () => io.disconnect();
  }, [mode]);
  const seenRef = useRef(p.onSeen);
  useEffect(() => {
    seenRef.current = p.onSeen;
  });
  const rendered = state === "ready";
  useEffect(() => {
    const end = bottomEdge.current;
    if (mode !== "final" || !frame.current || !end || !rendered) return;
    // A page more than two screens tall can never be 40 percent visible: for it, reaching its bottom counts.
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.some((e) => e.isIntersecting && (e.target === end ? height > window.innerHeight * 2 : e.intersectionRatio >= 0.4));
        if (seen) seenRef.current?.(index);
      },
      { threshold: [0.4] },
    );
    io.observe(frame.current);
    io.observe(end);
    return () => io.disconnect();
  }, [mode, rendered, index, height]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (!near) {
      // Far from the viewport: free the pixels. The state is derived below (`shown`), not set here.
      c.width = 0;
      c.height = 0;
      return;
    }
    if (width < 10) return;
    const ac = new AbortController();
    const scale = Math.min((width / size.w) * Math.min(window.devicePixelRatio || 1, 2), 4);
    void (async () => {
      try {
        const page = await doc.getPage(index + 1);
        await renderPage(page, c, scale, ac.signal);
        if (mode === "final") {
          const ctx = c.getContext("2d");
          if (ctx) drawBoxes(ctx, boxes.map((b) => b.box), scale);
        }
        page.cleanup();
        if (!ac.signal.aborted) setDone({ key: renderKey, ok: true });
      } catch {
        if (!ac.signal.aborted) setDone({ key: renderKey, ok: false });
      }
    })();
    return () => ac.abort();
    // `boxes` is a new array on every render; in final mode bakedKey carries its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, index, width, near, mode, size.w, size.h, bakedKey, renderKey]);

  const toPage = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * size.w, y: ((e.clientY - r.top) / r.height) * size.h };
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const q = toPage(e);
    setDrag({ x0: q.x, y0: q.y, x1: q.x, y1: q.y });
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const q = toPage(e);
    setDrag({ ...drag, x1: q.x, y1: q.y });
  };
  const up = () => {
    if (!drag) return;
    const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
    const x0 = clamp(Math.min(drag.x0, drag.x1), size.w);
    const x1 = clamp(Math.max(drag.x0, drag.x1), size.w);
    const y0 = clamp(Math.min(drag.y0, drag.y1), size.h);
    const y1 = clamp(Math.max(drag.y0, drag.y1), size.h);
    setDrag(null);
    p.onDraw?.({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  };
  const keys = (e: KeyboardEvent, b: PageBox) => {
    if (e.key === "Enter" || e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      p.onRemove?.(b);
      return;
    }
    if (b.manualId === undefined || !e.key.startsWith("Arrow")) return;
    e.preventDefault();
    const dx = e.key === "ArrowLeft" ? -STEP : e.key === "ArrowRight" ? STEP : 0;
    const dy = e.key === "ArrowUp" ? -STEP : e.key === "ArrowDown" ? STEP : 0;
    const next = e.shiftKey ? { ...b.box, w: Math.max(4, b.box.w + dx), h: Math.max(4, b.box.h + dy) } : { ...b.box, x: b.box.x + dx, y: b.box.y + dy };
    p.onMove?.(b.manualId, next);
  };

  return (
    <div ref={frame} className="relative max-w-full overflow-hidden rounded-control border border-border-strong bg-surface" style={{ width, height }}>
      <canvas ref={canvas} role="img" aria-label={id.pdf.review.canvas(index + 1)} className="block" style={{ width, height }} />
      {mode === "final" && <div ref={bottomEdge} aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px" />}
      {state === "loading" && <p role="status" className="absolute inset-0 grid place-items-center text-small text-fg-muted">{id.pdf.review.loadingPage}</p>}
      {state === "failed" && (
        <p role="alert" className="absolute inset-0 grid place-items-center p-4 text-center text-small text-danger">
          <span aria-hidden="true">! </span>
          {id.pdf.review.renderFailed}
        </p>
      )}
      {mode === "edit" && (
        <div className="absolute inset-0 cursor-crosshair touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
          {boxes.map((b) => {
            const manual = b.manualId !== undefined;
            // The visible box keeps its true size; the button around it is at least 32 px (touch target).
            const k = width / size.w;
            const bw = b.box.w * k;
            const bh = b.box.h * k;
            const hw = Math.max(bw, HIT);
            const hh = Math.max(bh, HIT);
            return (
              <button
                key={manual ? `m${b.manualId}` : b.sources.join("+")}
                type="button"
                onClick={() => p.onRemove?.(b)}
                onKeyDown={(e) => keys(e, b)}
                aria-label={manual ? id.pdf.review.manualBox : id.pdf.review.removeBoxFrom(b.sources.length)}
                title={id.pdf.review.removeBox}
                className="group absolute cursor-pointer bg-transparent p-0"
                style={{ left: b.box.x * k + bw / 2 - hw / 2, top: b.box.y * k + bh / 2 - hh / 2, width: hw, height: hh }}
              >
                <span
                  aria-hidden="true"
                  className={cx("absolute border bg-bg group-hover:bg-surface-hover group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent", manual ? "border-accent" : "border-fg-subtle")}
                  style={{ left: (hw - bw) / 2, top: (hh - bh) / 2, width: bw, height: bh }}
                />
              </button>
            );
          })}
          {drag && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute border border-dashed border-accent bg-accent-subtle"
              style={{ left: pct(Math.min(drag.x0, drag.x1), size.w), top: pct(Math.min(drag.y0, drag.y1), size.h), width: pct(Math.abs(drag.x1 - drag.x0), size.w), height: pct(Math.abs(drag.y1 - drag.y0), size.h) }}
            />
          )}
        </div>
      )}
    </div>
  );
}
