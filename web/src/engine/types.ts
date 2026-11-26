// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Types of the engine API. The Rust side (crates/privora-wasm/src/api.rs) is the source of truth:
// `version()` returns the word lists below, and engine.contract.test.ts fails if they drift.
// Offsets are UTF-16 code units (JavaScript string indices), `end` exclusive.

export const SCHEMA_VERSION = 1;

export const KINDS = ["NIK", "KK", "NPWP", "TELEPON", "EMAIL", "KARTU", "NAMA", "ALAMAT", "TGL_LAHIR"] as const;
export type Kind = (typeof KINDS)[number];

export const CONFIDENCES = ["TINGGI", "SEDANG", "RENDAH"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** Codes thrown by the wasm wrapper. */
export const WASM_ERROR_CODES = ["INVALID_INPUT", "INVALID_SPAN", "TOKEN_COLLISION", "TOO_LARGE"] as const;
/** Codes produced by the worker client. */
export const CLIENT_ERROR_CODES = ["CANCELLED", "LOAD_FAILED", "INTERNAL"] as const;
export type EngineErrorCode = (typeof WASM_ERROR_CODES)[number] | (typeof CLIENT_ERROR_CODES)[number];

/** The message is the code itself: errors never carry user text. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;
  constructor(code: EngineErrorCode) {
    super(code);
    this.name = "EngineError";
    this.code = code;
  }
}

export type Sensitivity = "SEIMBANG" | "HATI_HATI";
export interface RefDate {
  year: number;
  month: number;
  day: number;
}
export interface ScanOptions {
  /** Default `SEIMBANG`. */
  sensitivity?: Sensitivity;
  /** "Today" for the NIK date rules; the core never reads the clock. */
  referenceDate: RefDate;
}

/** A range to hide. `kind` is null for a manual selection. */
export interface Span {
  start: number;
  end: number;
  kind: Kind | null;
}

export const NIK_ERRORS = ["MALFORMED", "UNKNOWN_PROVINCE", "ZERO_REGENCY", "INVALID_DATE", "ZERO_SERIAL"] as const;
export type NikErrorCode = (typeof NIK_ERRORS)[number];

export type Validation =
  | { type: "NIK_OK"; province: number; gender: "L" | "P"; birthCandidates: RefDate[]; centuryAmbiguous: boolean }
  | { type: "NIK_ERROR"; error: NikErrorCode }
  | { type: "LUHN" }
  | { type: "PROVINCE"; province: number };

export interface Finding {
  kind: Kind;
  start: number;
  end: number;
  confidence: Confidence;
  /** Stable code for the UI. Never contains the value. */
  reason: string;
  validation: Validation | null;
}

export type RedactStyle = "LABEL" | "BLOK";
export type RestoreMode = "STRICT" | "TOLERANT";

/** Token and its original value. The value is personal data. */
export interface TokenEntry {
  token: string;
  value: string;
}
export interface Tokenized {
  text: string;
  map: TokenEntry[];
}
export interface RestoreFlag {
  start: number;
  end: number;
  found: string;
}
export interface RestoreReport {
  restored: number;
  flagged: RestoreFlag[];
  unused: string[];
  unknown: string[];
}
export interface Restored {
  text: string;
  report: RestoreReport;
}
export interface Range {
  start: number;
  end: number;
}
export interface EngineVersion {
  engine: string;
  version: string;
  schema: number;
  kinds: string[];
  confidences: string[];
  errors: string[];
}

export interface Progress {
  done: number;
  total: number;
}

/** Per call options. Cancelling terminates the worker, so it affects every call in flight. */
export interface CallOptions {
  signal?: AbortSignal;
  /** Only `scan` reports progress (one step per chunk). */
  onProgress?: (p: Progress) => void;
}

/** Today in the local calendar, for `ScanOptions.referenceDate`. */
export function todayRefDate(now: Date = new Date()): RefDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}
