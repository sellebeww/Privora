// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// State of a PDF review as plain data and a pure reducer (tested in state.test.ts). The pdf.js
// document handle lives in the provider, never here. Nothing in this state is stored anywhere.
import type { Finding, Sensitivity } from "../engine/types.ts";
import { boxesForRanges, type BoxMode } from "./boxes.ts";
import type { OutputFormat } from "./encode.ts";
import type { PageData } from "./extract.ts";
import type { Box, TaggedBox } from "./geometry.ts";

export interface PdfPageInfo {
  data: PageData;
  findings: Finding[];
  /** Almost no text and at least one image: probably a scan. */
  scannedLook: boolean;
  /** Annotations on the page. Their text is not scanned. */
  annotations: number;
}

export interface ManualBox {
  id: number;
  box: Box;
}

export type PdfPhase = "idle" | "loading" | "ready" | "error";
export type PdfStage = "read" | "extract" | "scan";

export interface PdfState {
  phase: PdfPhase;
  stage: PdfStage;
  progress: { done: number; total: number };
  /** `PdfErrorCode`, an engine error code, or "EMPTY". */
  error: string | null;
  fileName: string | null;
  fileBytes: number;
  pages: PdfPageInfo[];
  scannedWith: Sensitivity | null;
  mode: BoxMode;
  dpi: number;
  format: OutputFormat;
  /** Findings the user switched off: `fkey(page, finding)`. Everything else is hidden. */
  off: ReadonlySet<string>;
  manual: Readonly<Record<number, readonly ManualBox[]>>;
  nextId: number;
  /** Pages seen in the final preview since the boxes last changed. */
  viewed: ReadonlySet<number>;
  /** The user said they checked the final preview. Reset by every change to the boxes. */
  confirmed: boolean;
}

export const DPI_CHOICES = [100, 150, 200, 300] as const;

export const initialPdf: PdfState = {
  phase: "idle",
  stage: "read",
  progress: { done: 0, total: 0 },
  error: null,
  fileName: null,
  fileBytes: 0,
  pages: [],
  scannedWith: null,
  mode: "ITEM",
  dpi: 150,
  format: "LOSSLESS",
  off: new Set(),
  manual: {},
  nextId: 1,
  viewed: new Set(),
  confirmed: false,
};

export const fkey = (page: number, f: Pick<Finding, "start" | "end">) => `p${page}:${f.start}:${f.end}`;
export const pageOfKey = (key: string) => Number(/^p(\d+):/.exec(key)?.[1] ?? -1);

export type PdfAction =
  | { type: "begin"; fileName: string; fileBytes: number }
  | { type: "stage"; stage: PdfStage; total: number }
  | { type: "progress"; done: number }
  | { type: "extracted"; pages: PdfPageInfo[] }
  | { type: "scanned"; findings: Finding[][]; sensitivity: Sensitivity }
  | { type: "fail"; error: string }
  | { type: "mode"; mode: BoxMode }
  | { type: "dpi"; dpi: number }
  | { type: "format"; format: OutputFormat }
  | { type: "toggle"; keys: string[]; on?: boolean }
  | { type: "set-all"; keys: string[]; on: boolean }
  | { type: "add-manual"; page: number; box: Box }
  | { type: "update-manual"; page: number; id: number; box: Box }
  | { type: "remove-manual"; page: number; id: number }
  | { type: "viewed"; page: number }
  | { type: "confirm"; value: boolean }
  | { type: "clear" };

/** Any change to what will be blacked out: the preview must be seen again. */
const edited = (s: PdfState, patch: Partial<PdfState>): PdfState => ({ ...s, ...patch, viewed: new Set(), confirmed: false });

const MIN_BOX = 2; // points; smaller drawn boxes are accidental clicks

export function pdfReducer(s: PdfState, a: PdfAction): PdfState {
  switch (a.type) {
    case "begin":
      return { ...initialPdf, mode: s.mode, dpi: s.dpi, format: s.format, phase: "loading", fileName: a.fileName, fileBytes: a.fileBytes };
    case "stage":
      return { ...s, stage: a.stage, progress: { done: 0, total: a.total } };
    case "progress":
      return s.phase === "loading" ? { ...s, progress: { ...s.progress, done: a.done } } : s;
    case "extracted":
      return { ...s, pages: a.pages };
    case "scanned": {
      // A rescan keeps manual boxes and every finding the user switched off (same page and range).
      const pages = s.pages.map((p, i) => ({ ...p, findings: a.findings[i] ?? [] }));
      return edited(s, { phase: "ready", pages, scannedWith: a.sensitivity });
    }
    case "fail":
      return { ...s, phase: a.error === "CANCELLED" ? "idle" : "error", error: a.error };
    case "mode":
      return edited(s, { mode: a.mode });
    case "dpi":
      return { ...s, dpi: a.dpi };
    case "format":
      return { ...s, format: a.format };
    case "toggle": {
      const off = new Set(s.off);
      const turnOn = a.on ?? !a.keys.every((k) => !off.has(k));
      for (const k of a.keys) {
        if (turnOn) off.delete(k);
        else off.add(k);
      }
      return edited(s, { off });
    }
    case "set-all": {
      const off = new Set(s.off);
      for (const k of a.keys) {
        if (a.on) off.delete(k);
        else off.add(k);
      }
      return edited(s, { off });
    }
    case "add-manual": {
      if (a.box.w < MIN_BOX || a.box.h < MIN_BOX) return s;
      const list = [...(s.manual[a.page] ?? []), { id: s.nextId, box: a.box }];
      return edited(s, { manual: { ...s.manual, [a.page]: list }, nextId: s.nextId + 1 });
    }
    case "update-manual": {
      const list = (s.manual[a.page] ?? []).map((m) => (m.id === a.id ? { id: m.id, box: a.box } : m));
      return edited(s, { manual: { ...s.manual, [a.page]: list } });
    }
    case "remove-manual": {
      const list = (s.manual[a.page] ?? []).filter((m) => m.id !== a.id);
      return edited(s, { manual: { ...s.manual, [a.page]: list } });
    }
    case "viewed": {
      if (s.viewed.has(a.page)) return s;
      return { ...s, viewed: new Set(s.viewed).add(a.page) };
    }
    case "confirm":
      return { ...s, confirmed: a.value && s.viewed.size === s.pages.length };
    case "clear":
      return { ...initialPdf, mode: s.mode, dpi: s.dpi, format: s.format };
  }
}

/** What the boxes depend on. */
export type BoxInputs = Pick<PdfState, "pages" | "off" | "manual" | "mode">;

/** Findings of one page that are switched on. */
export function selectedFindings(s: Pick<PdfState, "pages" | "off">, page: number) {
  const info = s.pages[page];
  if (!info) return [];
  return info.findings.map((f) => ({ key: fkey(page, f), start: f.start, end: f.end })).filter((r) => !s.off.has(r.key));
}

export interface PageBox extends TaggedBox {
  /** Present for a manual box. */
  manualId?: number;
}

/** Every box that will be painted on a page: from selected findings (merged) and manual ones. */
export function pageBoxes(s: BoxInputs, page: number): PageBox[] {
  const info = s.pages[page];
  if (!info) return [];
  const auto: PageBox[] = boxesForRanges(info.data, selectedFindings(s, page), s.mode);
  const hand: PageBox[] = (s.manual[page] ?? []).map((m) => ({ box: m.box, sources: [], manualId: m.id }));
  return [...auto, ...hand];
}

export function allPageBoxes(s: BoxInputs): PageBox[][] {
  return s.pages.map((_, i) => pageBoxes(s, i));
}

export function allBoxes(s: BoxInputs): Box[][] {
  return allPageBoxes(s).map((l) => l.map((b) => b.box));
}

/** Total boxes and total selected findings, for the summary. */
export function counts(s: BoxInputs) {
  let boxes = 0;
  let findings = 0;
  s.pages.forEach((_, i) => {
    boxes += pageBoxes(s, i).length;
    findings += selectedFindings(s, i).length;
  });
  return { boxes, findings };
}
