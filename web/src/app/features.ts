// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Feature detection. Takes the environment as an argument so tests can fake it.
import PROBE_URL from "./probe.worker.ts?worker&url";

export interface Features {
  wasm: boolean;
  worker: boolean;
  crypto: boolean;
  blob: boolean;
}
export const FEATURE_KEYS = ["wasm", "worker", "crypto", "blob"] as const;

type Env = Record<string, unknown>;

/** Reading `type` while constructing a Worker proves the module option is understood. */
function moduleWorker(env: Env, probeUrl: string): boolean {
  const W = env["Worker"];
  if (typeof W !== "function") return false;
  let read = false;
  try {
    const w = new (W as new (u: string, o: object) => Worker)(probeUrl, {
      get type() {
        read = true;
        return "module";
      },
    });
    w.onerror = (e) => e.preventDefault();
    w.terminate();
  } catch {
    // An error thrown after the option was read still proves the option is understood.
  }
  return read;
}

/** probeUrl: tiny same-origin module worker, allowed by `worker-src 'self'`, so the probe causes no CSP violation. */

export function detectFeatures(env: Env = globalThis as unknown as Env, probeUrl: string = PROBE_URL): Features {
  const subtle = (env["crypto"] as { subtle?: unknown } | undefined)?.subtle;
  return {
    wasm: typeof env["WebAssembly"] === "object" && env["WebAssembly"] !== null,
    worker: moduleWorker(env, probeUrl),
    crypto: typeof subtle === "object" && subtle !== null,
    blob: typeof env["Blob"] === "function" && typeof (env["URL"] as { createObjectURL?: unknown } | undefined)?.createObjectURL === "function",
  };
}

export const isSupported = (f: Features): boolean => FEATURE_KEYS.every((k) => f[k]);
