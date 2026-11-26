// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// In-memory session: document, findings, selection, token map. Nothing here is ever written to
// any browser storage; flow.test.ts checks this.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { createEngine, type Engine } from "../engine/engine.ts";
import {
  EngineError,
  todayRefDate,
  type Finding,
  type RedactStyle,
  type Sensitivity,
  type TokenEntry,
} from "../engine/types.ts";
import type { Row } from "./marks.ts";

export type Mode = "mask" | "tokenize";
export type ScanPhase = "idle" | "scanning" | "done" | "error";
/** Engine readiness: the wasm module is fetched and compiled on first use. */
export type EngineState = "loading" | "ready" | "error";

/** More occurrences than this is refused: it would be a flood of manual ranges, not a review. */
export const MAX_OCCURRENCES = 5000;

export interface ManualSpan {
  key: string;
  start: number;
  end: number;
}

export interface SessionState {
  mode: Mode;
  text: string;
  fileName: string | null;
  sensitivity: Sensitivity;
  style: RedactStyle;
  phase: ScanPhase;
  /** Sensitivity of the scan whose findings are shown; null before the first finished scan. */
  scannedWith: Sensitivity | null;
  progress: { done: number; total: number };
  error: string | null;
  findings: Finding[];
  manual: ManualSpan[];
  /** Keys: `a<i>` for finding i, `m<n>` for manual ranges. */
  selected: ReadonlySet<string>;
  /** The map made by the last tokenisation, if any. Personal data: memory only. */
  tokenMap: TokenEntry[] | null;
  nextManual: number;
}

export const initialState: SessionState = {
  mode: "mask",
  text: "",
  fileName: null,
  sensitivity: "SEIMBANG",
  style: "LABEL",
  phase: "idle",
  scannedWith: null,
  progress: { done: 0, total: 0 },
  error: null,
  findings: [],
  manual: [],
  selected: new Set(),
  tokenMap: null,
  nextManual: 1,
};

type Action =
  | { type: "mode"; mode: Mode }
  | { type: "text"; text: string; fileName: string | null }
  | { type: "sensitivity"; value: Sensitivity }
  | { type: "style"; value: RedactStyle }
  | { type: "scan-start" }
  | { type: "scan-progress"; done: number; total: number }
  | { type: "scan-done"; findings: Finding[]; sensitivity: Sensitivity }
  | { type: "scan-fail"; error: string }
  | { type: "toggle"; keys: string[]; on?: boolean }
  | { type: "set-all"; keys: string[]; on: boolean }
  | { type: "add-manual"; ranges: { start: number; end: number }[] }
  | { type: "token-map"; map: TokenEntry[] | null };

const autoKey = (i: number) => `a${i}`;

export function reducer(s: SessionState, a: Action): SessionState {
  switch (a.type) {
    case "mode":
      return { ...s, mode: a.mode };
    case "text":
      // A different document: everything derived from the old one is dropped.
      return { ...initialState, mode: s.mode, sensitivity: s.sensitivity, style: s.style, text: a.text, fileName: a.fileName };
    case "sensitivity":
      return { ...s, sensitivity: a.value };
    case "style":
      return { ...s, style: a.value };
    case "scan-start":
      return { ...s, phase: "scanning", progress: { done: 0, total: 0 }, error: null };
    case "scan-progress":
      return s.phase === "scanning" ? { ...s, progress: { done: a.done, total: a.total } } : s;
    case "scan-done": {
      // A rescan keeps the user's manual ranges and every finding they switched off (same range).
      const off = new Set(s.findings.filter((_, i) => !s.selected.has(autoKey(i))).map((f) => `${f.start}:${f.end}`));
      const sel = new Set(s.manual.map((m) => m.key).filter((k) => s.selected.has(k)));
      a.findings.forEach((f, i) => {
        if (!off.has(`${f.start}:${f.end}`)) sel.add(autoKey(i));
      });
      return { ...s, phase: "done", scannedWith: a.sensitivity, findings: a.findings, selected: sel, tokenMap: null };
    }
    case "scan-fail":
      return { ...s, phase: a.error === "CANCELLED" ? "idle" : "error", error: a.error };
    case "toggle": {
      const sel = new Set(s.selected);
      const turnOn = a.on ?? !a.keys.every((k) => sel.has(k));
      for (const k of a.keys) {
        if (turnOn) sel.add(k);
        else sel.delete(k);
      }
      return { ...s, selected: sel };
    }
    case "set-all": {
      const sel = new Set(s.selected);
      for (const k of a.keys) {
        if (a.on) sel.add(k);
        else sel.delete(k);
      }
      return { ...s, selected: sel };
    }
    case "add-manual": {
      const have = new Map(s.manual.map((m) => [`${m.start}:${m.end}`, m.key]));
      const manual = [...s.manual];
      const sel = new Set(s.selected);
      let n = s.nextManual;
      for (const r of a.ranges) {
        const old = have.get(`${r.start}:${r.end}`);
        if (old) {
          sel.add(old);
          continue;
        }
        const key = `m${n++}`;
        manual.push({ key, start: r.start, end: r.end });
        have.set(`${r.start}:${r.end}`, key);
        sel.add(key);
      }
      return { ...s, manual, selected: sel, nextManual: n };
    }
    case "token-map":
      return { ...s, tokenMap: a.map };
  }
}

/** Rows for the review list: findings first (engine order), then manual ranges. */
export function rowsOf(s: Pick<SessionState, "findings" | "manual" | "selected">): Row[] {
  const rows: Row[] = s.findings.map((f, i) => ({ key: autoKey(i), start: f.start, end: f.end, kind: f.kind, selected: s.selected.has(autoKey(i)) }));
  for (const m of s.manual) rows.push({ key: m.key, start: m.start, end: m.end, kind: null, selected: s.selected.has(m.key) });
  return rows;
}

export interface SessionApi {
  state: SessionState;
  rows: Row[];
  engine: Engine;
  engineState: EngineState;
  setMode(mode: Mode): void;
  setText(text: string, fileName: string | null): void;
  setSensitivity(v: Sensitivity): void;
  setStyle(v: RedactStyle): void;
  /** Resolves true when the scan finished, false when cancelled or failed (see `state.error`). */
  scan(): Promise<boolean>;
  cancelScan(): void;
  toggle(keys: string[], on?: boolean): void;
  setAll(keys: string[], on: boolean): void;
  addManual(start: number, end: number): void;
  /** Add every exact occurrence of the text in the range. Returns how many ranges, or -1 when over the limit. */
  addAllOccurrences(start: number, end: number): Promise<number>;
  setTokenMap(map: TokenEntry[] | null): void;
}

/** Route of the home page after "Bersihkan sesi". */
export const CLEARED_ROUTE = "bersih";

/**
 * "Bersihkan sesi": drop document, findings and map from memory. Only a fresh page holds nothing
 * for certain (React keeps earlier state, strings cannot be wiped, the workers have memory of
 * their own), so the page is loaded again. Checked against a heap snapshot in e2e.
 */
export function wipeSession(): void {
  history.replaceState(null, "", `#/${CLEARED_ROUTE}`);
  location.reload();
}

const Ctx = createContext<SessionApi | null>(null);

export function useSession(): SessionApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession needs <SessionProvider>");
  return c;
}

export function SessionProvider({ children, engine: injected }: { children: ReactNode; engine?: Engine }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [engineState, setEngineState] = useState<EngineState>("loading");
  const own = useRef<Engine | null>(null);
  const engine = useMemo(() => injected ?? (own.current ??= createEngine()), [injected]);
  const abort = useRef<AbortController | null>(null);
  const live = useRef(state);
  useEffect(() => {
    live.current = state;
  });

  // Warm up: fetch and compile the wasm before the first scan so "loading" is visible on its own.
  useEffect(() => {
    let off = false;
    engine
      .version()
      .then(() => !off && setEngineState("ready"))
      .catch(() => !off && setEngineState("error"));
    return () => {
      off = true;
    };
  }, [engine]);
  useEffect(() => () => own.current?.dispose(), []);

  const scan = useCallback(async () => {
    const s = live.current;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    dispatch({ type: "scan-start" });
    try {
      const findings = await engine.scan(
        s.text,
        { sensitivity: s.sensitivity, referenceDate: todayRefDate() },
        { signal: ac.signal, onProgress: (p) => dispatch({ type: "scan-progress", done: p.done, total: p.total }) },
      );
      if (abort.current !== ac) return false;
      dispatch({ type: "scan-done", findings, sensitivity: s.sensitivity });
      setEngineState("ready");
      return true;
    } catch (e) {
      // A newer scan or a cleared session owns the state now: this one is stale.
      if (abort.current !== ac) return false;
      const code = e instanceof EngineError ? e.code : "INTERNAL";
      dispatch({ type: "scan-fail", error: code });
      if (code === "LOAD_FAILED") setEngineState("error");
      return false;
    } finally {
      if (abort.current === ac) abort.current = null;
    }
  }, [engine]);

  // Stable while only unrelated state (phase, progress, map) changes.
  const rows = useMemo(() => rowsOf({ findings: state.findings, manual: state.manual, selected: state.selected }), [state.findings, state.manual, state.selected]);
  const api = useMemo<SessionApi>(
    () => ({
      state,
      rows,
      engine,
      engineState,
      setMode: (mode) => dispatch({ type: "mode", mode }),
      setText: (text, fileName) => dispatch({ type: "text", text, fileName }),
      setSensitivity: (value) => dispatch({ type: "sensitivity", value }),
      setStyle: (value) => dispatch({ type: "style", value }),
      scan,
      cancelScan: () => abort.current?.abort(),
      toggle: (keys, on) => dispatch({ type: "toggle", keys, on }),
      setAll: (keys, on) => dispatch({ type: "set-all", keys, on }),
      addManual: (start, end) => dispatch({ type: "add-manual", ranges: [{ start, end }] }),
      addAllOccurrences: async (start, end) => {
        const s = live.current;
        const needle = s.text.slice(start, end);
        const found = needle ? await engine.findOccurrences(s.text, needle) : [];
        if (live.current.text !== s.text) return 0; // another document by now: these offsets are not its
        if (found.length > MAX_OCCURRENCES) return -1;
        dispatch({ type: "add-manual", ranges: found });
        return found.length;
      },
      setTokenMap: (map) => dispatch({ type: "token-map", map }),
    }),
    [state, rows, engine, engineState, scan],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
