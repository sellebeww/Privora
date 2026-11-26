// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Typed messages between the engine client (main thread) and the worker. Every request carries
// an id; every response echoes it.
import type {
  EngineErrorCode,
  EngineVersion,
  Finding,
  Range,
  RedactStyle,
  Restored,
  RestoreMode,
  ScanOptions,
  Span,
  TokenEntry,
  Tokenized,
} from "./types.ts";

export interface Ops {
  scan: { args: { text: string; options: ScanOptions }; result: Finding[] };
  redact: { args: { text: string; spans: Span[]; style: RedactStyle }; result: string };
  tokenize: { args: { text: string; spans: Span[] }; result: Tokenized };
  restore: { args: { text: string; map: TokenEntry[]; mode: RestoreMode }; result: Restored };
  findOccurrences: { args: { text: string; needle: string }; result: Range[] };
  version: { args: Record<never, never>; result: EngineVersion };
}
export type OpName = keyof Ops;

export type Request = { [K in OpName]: { id: number; op: K } & Ops[K]["args"] }[OpName];

export type Response =
  | { id: number; type: "progress"; done: number; total: number }
  | { id: number; type: "ok"; result: unknown }
  | { id: number; type: "error"; code: EngineErrorCode };
