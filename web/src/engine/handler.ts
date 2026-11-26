// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Request handling on top of the wasm functions. No worker or DOM API here, so the same code
// runs in the worker and in Node tests.
import type { OpName, Ops, Request } from "./protocol.ts";
import {
  EngineError,
  WASM_ERROR_CODES,
  type EngineErrorCode,
  type Finding,
  type ScanOptions,
  type Span,
} from "./types.ts";

/** The functions exported by the wasm package (`web/src/wasm/pkg/privora.js`). */
export interface WasmApi {
  scan(text: string, optionsJson: string): string;
  redact(text: string, spansJson: string, style: string): string;
  tokenize(text: string, spansJson: string): string;
  restore(text: string, mapJson: string, mode: string): string;
  find_occurrences(text: string, needle: string): string;
  version(): string;
}

/** Same cap as the Rust side (64 MiB of UTF-8), applied early in UTF-16 units so a huge string is never copied into wasm memory. */
export const MAX_TEXT_UNITS = 64 * 1024 * 1024;

/** Texts longer than this (UTF-16 units) are scanned in chunks of about this size. */
export const CHUNK_UNITS = 1 << 20;
/** Text read on both sides of a chunk: longer than any real value (an address is at most two lines of 160). */
const MARGIN_UNITS = 1024;

/** Characters that can sit inside a NIK, phone number, e-mail or card number. */
const TOKEN_CHAR = /[0-9A-Za-z._%+@-]/;

const isHigh = (c: number) => c >= 0xd800 && c < 0xdc00;
const isLow = (c: number) => c >= 0xdc00 && c < 0xe000;

/** Move a cut forward so it never falls between the two halves of a surrogate pair. */
function safeCut(text: string, i: number): number {
  return i > 0 && i < text.length && isHigh(text.charCodeAt(i - 1)) && isLow(text.charCodeAt(i)) ? i + 1 : i;
}

/**
 * Chunk boundaries `[0, ..., text.length]`. A cut prefers a blank line, then a line break, then
 * a space, then the raw position (the margins of `scanChunked` make any cut safe, D-51).
 */
export function chunkBounds(text: string, target: number = CHUNK_UNITS): number[] {
  const bounds = [0];
  let start = 0;
  while (text.length - start > Math.max(target, 1)) {
    const want = start + Math.max(target, 1);
    const floor = start + (target >> 1);
    let cut = text.lastIndexOf("\n\n", want);
    cut = cut >= floor ? cut + 2 : -1;
    if (cut < 0) {
      cut = text.lastIndexOf("\n", want);
      cut = cut >= floor ? cut + 1 : -1;
    }
    if (cut < 0) {
      cut = text.lastIndexOf(" ", want);
      cut = cut >= floor ? cut + 1 : -1;
    }
    // No natural break in the preferred window: any character that cannot be part of a number,
    // e-mail or phone (so a NIK is not cut in half). Only a window made entirely of such
    // characters is cut raw (D-24).
    for (let i = want; cut < 0 && i > start; i--) if (!TOKEN_CHAR.test(text.charAt(i))) cut = i + 1;
    if (cut < 0) cut = want;
    cut = Math.min(text.length, Math.max(start + 1, safeCut(text, cut)));
    bounds.push(cut);
    start = cut;
  }
  if (bounds[bounds.length - 1] !== text.length || text.length === 0) bounds.push(text.length);
  return bounds;
}

/**
 * Scan in chunks and return findings with global offsets. A chunk is scanned together with a
 * margin before it (keyword context) and after it (so a value that crosses the cut is read
 * whole), and keeps only the findings that start inside it.
 */
export function scanChunked(
  api: Pick<WasmApi, "scan">,
  text: string,
  options: ScanOptions,
  onProgress: (done: number, total: number) => void,
  target: number = CHUNK_UNITS,
): Finding[] {
  const optionsJson = JSON.stringify(options);
  const bounds = chunkBounds(text, target);
  const total = bounds.length - 1;
  const out: Finding[] = [];
  for (let i = 0; i < total; i++) {
    const start = bounds[i] ?? 0;
    const end = bounds[i + 1] ?? text.length;
    const from = safeCut(text, Math.max(0, start - MARGIN_UNITS));
    const to = safeCut(text, Math.min(text.length, end + MARGIN_UNITS));
    const found = JSON.parse(api.scan(from === 0 && to === text.length ? text : text.slice(from, to), optionsJson)) as Finding[];
    for (const f of found) {
      if (f.start < start - from || f.start >= end - from) continue;
      f.start += from;
      f.end += from;
      out.push(f);
    }
    onProgress(i + 1, total);
  }
  return out;
}

/** Explicit field copy: the wire format is strict, extra fields (e.g. a whole Finding) are refused. */
const spansJson = (spans: Span[]) =>
  JSON.stringify(spans.map((s) => ({ start: s.start, end: s.end, kind: s.kind ?? null })));

function toEngineError(e: unknown): EngineError {
  if (e instanceof EngineError) return e;
  const known = (WASM_ERROR_CODES as readonly string[]).includes(e as string);
  // Anything else (a wasm trap, an unexpected throw) says nothing reliable about the instance.
  return new EngineError(known ? (e as EngineErrorCode) : "INTERNAL");
}

/** Run one request. Throws `EngineError` only; its message never contains user text. */
export function handle<K extends OpName>(
  api: WasmApi,
  req: Extract<Request, { op: K }>,
  onProgress: (done: number, total: number) => void = () => {},
): Ops[K]["result"] {
  try {
    const r = req as Request;
    if ("text" in r && r.text.length > MAX_TEXT_UNITS) throw new EngineError("TOO_LARGE");
    switch (r.op) {
      case "scan":
        return scanChunked(api, r.text, r.options, onProgress) as Ops[K]["result"];
      case "redact":
        return api.redact(r.text, spansJson(r.spans), r.style) as Ops[K]["result"];
      case "tokenize":
        return JSON.parse(api.tokenize(r.text, spansJson(r.spans))) as Ops[K]["result"];
      case "restore":
        return JSON.parse(
          api.restore(r.text, JSON.stringify(r.map.map((e) => ({ token: e.token, value: e.value }))), r.mode),
        ) as Ops[K]["result"];
      case "findOccurrences":
        return JSON.parse(api.find_occurrences(r.text, r.needle)) as Ops[K]["result"];
      case "version":
        return JSON.parse(api.version()) as Ops[K]["result"];
    }
  } catch (e) {
    throw toEngineError(e);
  }
}
