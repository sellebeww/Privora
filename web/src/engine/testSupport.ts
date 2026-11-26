// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Test helpers only (not imported by the app): the real wasm build loaded in Node, and an
// in-process stand-in for the worker so the client protocol can be tested without a browser.
import { readFileSync } from "node:fs";
import { initSync, find_occurrences, redact, restore, scan, tokenize, version } from "../wasm/pkg/privora.js";
import { EngineError, type EngineErrorCode } from "./types.ts";
import { handle, type WasmApi } from "./handler.ts";
import type { Request, Response } from "./protocol.ts";
import type { WorkerLike } from "./engine.ts";

initSync({ module: readFileSync(new URL("../wasm/pkg/privora_bg.wasm", import.meta.url)) });

export const wasmApi: WasmApi = { scan, redact, tokenize, restore, find_occurrences, version };

export const REF = { year: 2026, month: 11, day: 25 };

export type Behaviour = "ok" | "load-fails" | "crashes" | "hangs";

/** Runs requests through the real handler on a macrotask, like a worker would, minus threads. */
export class InProcessWorker implements WorkerLike {
  onmessage: WorkerLike["onmessage"] = null;
  onerror: WorkerLike["onerror"] = null;
  onmessageerror: WorkerLike["onmessageerror"] = null;
  terminated = false;
  constructor(private readonly behaviour: Behaviour = "ok") {}

  postMessage(req: Request): void {
    setTimeout(() => {
      if (this.terminated || this.behaviour === "hangs") return;
      const reply = (r: Response) => !this.terminated && this.onmessage?.({ data: r });
      if (this.behaviour === "load-fails") return reply({ id: req.id, type: "error", code: "LOAD_FAILED" });
      if (this.behaviour === "crashes") return reply({ id: req.id, type: "error", code: "INTERNAL" });
      try {
        const result = handle(wasmApi, req as never, (done, total) => reply({ id: req.id, type: "progress", done, total }));
        reply({ id: req.id, type: "ok", result });
      } catch (e) {
        reply({ id: req.id, type: "error", code: (e as EngineError).code as EngineErrorCode });
      }
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}
