// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// PDF session provider: opens a file, extracts the text of every page, runs the SAME engine on each
// page, and keeps the review state. The document and its bytes stay in memory only.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { EngineError, todayRefDate, type Finding, type Sensitivity } from "../engine/types.ts";
import { useSession } from "../flow/session.tsx";
import type { BoxMode } from "./boxes.ts";
import type { OutputFormat } from "./encode.ts";
import { extractPage, SCAN_LOOK_CHARS } from "./extract.ts";
import type { Box } from "./geometry.ts";
import { annotationCount, loadPdfjs, openPdf, pageHasImages, PdfError } from "./loader.ts";
import { initialPdf, pdfReducer, type PdfPageInfo, type PdfState } from "./state.ts";

/** Pages beyond this are accepted with a warning: text and boxes for all of them are held in memory. */
export const PDF_WARN_PAGES = 300;

export interface PdfApi {
  state: PdfState;
  doc: PDFDocumentProxy | null;
  /** Resolves true when the file was read and scanned. */
  open(file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }): Promise<boolean>;
  cancel(): void;
  rescan(sensitivity: Sensitivity): Promise<boolean>;
  setMode(m: BoxMode): void;
  setDpi(n: number): void;
  setFormat(f: OutputFormat): void;
  toggle(keys: string[], on?: boolean): void;
  setAll(keys: string[], on: boolean): void;
  addManual(page: number, box: Box): void;
  updateManual(page: number, id: number, box: Box): void;
  removeManual(page: number, id: number): void;
  markViewed(page: number): void;
  confirm(value: boolean): void;
  clear(): void;
}

const Ctx = createContext<PdfApi | null>(null);
export function usePdf(): PdfApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePdf needs <PdfProvider>");
  return c;
}

export function PdfProvider({ children }: { children: ReactNode }) {
  const { engine, state: text } = useSession();
  const [state, dispatch] = useReducer(pdfReducer, initialPdf);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const abort = useRef<AbortController | null>(null);
  const holder = useRef<{ doc: PDFDocumentProxy; destroy: () => void } | null>(null);
  const live = useRef(state);
  useEffect(() => {
    live.current = state;
  });

  const release = useCallback(() => {
    holder.current?.destroy();
    holder.current = null;
    setDoc(null);
  }, []);
  useEffect(() => release, [release]);

  const scanPages = useCallback(
    async (pages: PdfPageInfo[], sensitivity: Sensitivity, signal: AbortSignal) => {
      dispatch({ type: "stage", stage: "scan", total: pages.length });
      const out: Finding[][] = [];
      for (let i = 0; i < pages.length; i += 1) {
        const t = pages[i]?.data.text ?? "";
        out.push(t.trim() ? await engine.scan(t, { sensitivity, referenceDate: todayRefDate() }, { signal }) : []);
        dispatch({ type: "progress", done: i + 1 });
      }
      return out;
    },
    [engine],
  );

  const open = useCallback<PdfApi["open"]>(
    async (file) => {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      release();
      dispatch({ type: "begin", fileName: file.name, fileBytes: file.size });
      try {
        dispatch({ type: "stage", stage: "read", total: 0 });
        const buf = await file.arrayBuffer();
        if (ac.signal.aborted) throw new PdfError("CANCELLED");
        const pdfjs = await loadPdfjs();
        const opened = await openPdf(buf);
        const d = opened.doc;
        if (ac.signal.aborted) {
          opened.destroy();
          throw new PdfError("CANCELLED");
        }
        holder.current = opened;
        // A page tree without pages would end in an empty review screen: say the file is broken.
        if (d.numPages < 1) throw new PdfError("INVALID");
        setDoc(d);
        dispatch({ type: "stage", stage: "extract", total: d.numPages });
        const pages: PdfPageInfo[] = [];
        for (let i = 1; i <= d.numPages; i += 1) {
          if (ac.signal.aborted) throw new PdfError("CANCELLED");
          const page = await d.getPage(i);
          const data = await extractPage(page);
          const scannedLook = data.chars < SCAN_LOOK_CHARS && (await pageHasImages(pdfjs, page));
          pages.push({ data, findings: [], scannedLook, annotations: await annotationCount(page) });
          page.cleanup();
          dispatch({ type: "progress", done: i });
        }
        dispatch({ type: "extracted", pages });
        const sensitivity = live.current.scannedWith ?? text.sensitivity;
        const findings = await scanPages(pages, sensitivity, ac.signal);
        if (ac.signal.aborted) throw new PdfError("CANCELLED");
        dispatch({ type: "scanned", findings, sensitivity });
        return true;
      } catch (e) {
        if (abort.current !== ac) return false; // superseded by another open or by clear
        const code = e instanceof PdfError ? e.code : e instanceof EngineError ? e.code : "FAILED";
        if (code !== "CANCELLED") release();
        dispatch({ type: "fail", error: code });
        return false;
      } finally {
        if (abort.current === ac) abort.current = null;
      }
    },
    [release, scanPages, text.sensitivity],
  );

  const rescan = useCallback<PdfApi["rescan"]>(
    async (sensitivity) => {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      try {
        const findings = await scanPages(live.current.pages, sensitivity, ac.signal);
        if (abort.current !== ac) return false;
        dispatch({ type: "scanned", findings, sensitivity });
        return true;
      } catch (e) {
        if (abort.current !== ac) return false;
        dispatch({ type: "fail", error: e instanceof EngineError ? e.code : "FAILED" });
        return false;
      } finally {
        if (abort.current === ac) abort.current = null;
      }
    },
    [scanPages],
  );

  const api = useMemo<PdfApi>(
    () => ({
      state,
      doc,
      open,
      cancel: () => abort.current?.abort(),
      rescan,
      setMode: (mode) => dispatch({ type: "mode", mode }),
      setDpi: (dpi) => dispatch({ type: "dpi", dpi }),
      setFormat: (format) => dispatch({ type: "format", format }),
      toggle: (keys, on) => dispatch({ type: "toggle", keys, on }),
      setAll: (keys, on) => dispatch({ type: "set-all", keys, on }),
      addManual: (page, box) => dispatch({ type: "add-manual", page, box }),
      updateManual: (page, id, box) => dispatch({ type: "update-manual", page, id, box }),
      removeManual: (page, id) => dispatch({ type: "remove-manual", page, id }),
      markViewed: (page) => dispatch({ type: "viewed", page }),
      confirm: (value) => dispatch({ type: "confirm", value }),
      clear: () => {
        const a = abort.current;
        abort.current = null;
        a?.abort();
        release();
        dispatch({ type: "clear" });
      },
    }),
    [state, doc, open, rescan, release],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
