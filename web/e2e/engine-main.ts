// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Page driven by e2e/engine.spec.ts. Synthetic text only.
import { createEngine } from "../src/engine/engine.ts";
import { EngineError, todayRefDate, type Finding } from "../src/engine/types.ts";

const violations: string[] = [];
document.addEventListener("securitypolicyviolation", (e) => violations.push(`${e.violatedDirective}`));

/** Text of at least `bytes` characters. "dense": five findings per 150 characters. "sparse": one per 2 KB. */
function makeText(chars: number, density: "dense" | "sparse"): string {
  const dense = "Nama: Budi Santoso\nNIK: 3174051509900001\nHP: 0812-3456-7890\n\u{1F600} Email: budi@example.com\nAlamat: Jl. Mawar No. 5, RT 01/RW 02\n\n";
  const filler = "Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod tempor. ".repeat(25) + "\n\n";
  const unit = density === "dense" ? dense : filler + "NIK: 3174051509900001\n\n";
  return unit.repeat(Math.ceil(chars / unit.length));
}

const opts = { referenceDate: todayRefDate() };

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof EngineError ? e.code : "other:" + String(e);
  }
}

interface Timing {
  density: string;
  chars: number;
  ms: number;
  findings: number;
  progressSteps: number;
}

const api = {
  async basic() {
    const engine = createEngine();
    const t0 = performance.now();
    const v = await engine.version();
    const loadMs = performance.now() - t0;
    const text = "\u{1F600} NIK: 3174051509900001 telp 081234567890";
    const found: Finding[] = await engine.scan(text, opts);
    const spans = found.map((f) => ({ start: f.start, end: f.end, kind: f.kind }));
    const tok = await engine.tokenize(text, spans);
    const back = await engine.restore(tok.text, tok.map, "STRICT");
    const slices = found.map((f) => text.slice(f.start, f.end));
    engine.dispose();
    return { engine: v.engine, loadMs, slices, roundTrip: back.text === text, violations: [...violations] };
  },
  async timings(): Promise<Timing[]> {
    const engine = createEngine();
    await engine.version(); // exclude load time
    const out: Timing[] = [];
    for (const [density, chars] of [["dense", 1e6], ["dense", 1e7], ["sparse", 1e6], ["sparse", 1e7]] as const) {
      const text = makeText(chars, density);
      let steps = 0;
      const t0 = performance.now();
      const found = await engine.scan(text, opts, { onProgress: () => steps++ });
      out.push({ density, chars: text.length, ms: performance.now() - t0, findings: found.length, progressSteps: steps });
    }
    engine.dispose();
    return out;
  },
  async cancel() {
    const engine = createEngine();
    await engine.version();
    const text = makeText(1e7, "dense");
    const p = code(engine.scan(text, opts));
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    engine.cancel();
    const cancelled = await p;
    const cancelMs = performance.now() - t0;
    const after = (await engine.version()).engine; // a new worker starts
    engine.dispose();
    return { cancelled, cancelMs, after };
  },
  async loadFailure() {
    const engine = createEngine(() => new Worker("/does-not-exist.js", { type: "module" }) as never);
    const c = await code(engine.version());
    engine.dispose();
    return { code: c };
  },
  async uiStaysResponsive() {
    // The main thread keeps ticking while a 10 MB scan runs in the worker.
    const engine = createEngine();
    await engine.version();
    const text = makeText(1e7, "sparse");
    let ticks = 0;
    let maxGap = 0;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
      ticks++;
    }, 10);
    const t0 = performance.now();
    await engine.scan(text, opts);
    const ms = performance.now() - t0;
    clearInterval(timer);
    engine.dispose();
    return { ms, ticks, maxGap };
  },
};

(window as unknown as { __ENGINE__: typeof api }).__ENGINE__ = api;
document.body.dataset["ready"] = "1";
