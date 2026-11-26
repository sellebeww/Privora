// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Module worker: loads the wasm once, then serves requests one at a time. The wasm calls are
// synchronous, so a request cannot be interrupted; the client cancels by terminating this worker.
import init, * as wasm from "../wasm/pkg/privora.js";
import { handle } from "./handler.ts";
import type { Request, Response } from "./protocol.ts";
import { EngineError } from "./types.ts";

const ready = init();
// Mark a failed load as handled here; each request reports it.
ready.catch(() => undefined);

const post = (r: Response) => self.postMessage(r);

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  try {
    await ready;
  } catch {
    post({ id: req.id, type: "error", code: "LOAD_FAILED" });
    return;
  }
  try {
    const result = handle(wasm, req as Extract<Request, { op: typeof req.op }>, (done, total) =>
      post({ id: req.id, type: "progress", done, total }),
    );
    post({ id: req.id, type: "ok", result });
  } catch (err) {
    post({ id: req.id, type: "error", code: err instanceof EngineError ? err.code : "INTERNAL" });
  }
};
