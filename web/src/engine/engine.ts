// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Main thread client of the engine worker. Typed calls, request ids, progress, cancellation
// (terminate and respawn), and clear failures. Rejections are always `EngineError`.
import type { OpName, Ops, Request, Response } from "./protocol.ts";
import {
  EngineError,
  type CallOptions,
  type EngineVersion,
  type Finding,
  type Range,
  type RedactStyle,
  type Restored,
  type RestoreMode,
  type ScanOptions,
  type Span,
  type TokenEntry,
  type Tokenized,
} from "./types.ts";

/** The part of `Worker` the client uses; tests supply an in-process stand-in. */
export interface WorkerLike {
  postMessage(message: Request): void;
  terminate(): void;
  onmessage: ((e: { data: Response }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror: ((e: unknown) => void) | null;
}

export interface Engine {
  scan(text: string, options: ScanOptions, call?: CallOptions): Promise<Finding[]>;
  redact(text: string, spans: Span[], style: RedactStyle, call?: CallOptions): Promise<string>;
  tokenize(text: string, spans: Span[], call?: CallOptions): Promise<Tokenized>;
  restore(text: string, map: TokenEntry[], mode: RestoreMode, call?: CallOptions): Promise<Restored>;
  findOccurrences(text: string, needle: string, call?: CallOptions): Promise<Range[]>;
  version(call?: CallOptions): Promise<EngineVersion>;
  /** Stop everything in flight. Pending calls reject with `CANCELLED`; the next call starts a fresh worker. */
  cancel(): void;
  /** Terminate the worker. The engine can still be used afterwards (a new worker starts). */
  dispose(): void;
}

const defaultSpawn = (): WorkerLike =>
  new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;

interface Pending {
  resolve(v: unknown): void;
  reject(e: EngineError): void;
  onProgress: CallOptions["onProgress"];
}

export function createEngine(spawn: () => WorkerLike = defaultSpawn): Engine {
  let worker: WorkerLike | null = null;
  let responded = false; // has this worker answered anything? tells a load failure from a crash
  let nextId = 1;
  const pending = new Map<number, Pending>();

  function recycle(code: "CANCELLED" | "LOAD_FAILED" | "INTERNAL"): void {
    const w = worker;
    worker = null;
    w?.terminate();
    const all = [...pending.values()];
    pending.clear();
    for (const p of all) p.reject(new EngineError(code));
  }

  function onMessage(msg: Response): void {
    responded = true;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === "progress") {
      p.onProgress?.({ done: msg.done, total: msg.total });
      return;
    }
    pending.delete(msg.id);
    if (msg.type === "ok") {
      p.resolve(msg.result);
    } else if (msg.code === "LOAD_FAILED" || msg.code === "INTERNAL") {
      // The wasm instance may be corrupt (a trap) or missing: nothing else on it can be trusted.
      p.reject(new EngineError(msg.code));
      recycle(msg.code);
    } else {
      p.reject(new EngineError(msg.code));
    }
  }

  function ensure(): WorkerLike {
    if (worker) return worker;
    const w = spawn();
    responded = false;
    w.onmessage = (e) => {
      if (w === worker) onMessage(e.data);
    };
    w.onerror = () => {
      if (w === worker) recycle(responded ? "INTERNAL" : "LOAD_FAILED");
    };
    w.onmessageerror = () => {
      if (w === worker) recycle("INTERNAL");
    };
    worker = w;
    return w;
  }

  function call<K extends OpName>(op: K, args: Ops[K]["args"], opts: CallOptions = {}): Promise<Ops[K]["result"]> {
    const { signal, onProgress } = opts;
    if (signal?.aborted) return Promise.reject(new EngineError("CANCELLED"));
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const onAbort = () => recycle("CANCELLED");
      const done = () => signal?.removeEventListener("abort", onAbort);
      pending.set(id, {
        resolve: (v) => (done(), resolve(v as Ops[K]["result"])),
        reject: (e) => (done(), reject(e)),
        onProgress,
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        ensure().postMessage({ id, op, ...args } as Request);
      } catch {
        // Worker construction failed (unsupported, blocked) or the message could not be cloned.
        const wasSpawn = worker === null;
        pending.delete(id);
        done();
        reject(new EngineError(wasSpawn ? "LOAD_FAILED" : "INTERNAL"));
      }
    });
  }

  return {
    scan: (text, options, c) => call("scan", { text, options }, c),
    redact: (text, spans, style, c) => call("redact", { text, spans, style }, c),
    tokenize: (text, spans, c) => call("tokenize", { text, spans }, c),
    restore: (text, map, mode, c) => call("restore", { text, map, mode }, c),
    findOccurrences: (text, needle, c) => call("findOccurrences", { text, needle }, c),
    version: (c) => call("version", {}, c),
    cancel: () => recycle("CANCELLED"),
    dispose: () => recycle("CANCELLED"),
  };
}
