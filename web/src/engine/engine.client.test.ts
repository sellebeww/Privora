// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Client protocol: ids, progress, cancellation (terminate and respawn), load failure, crash.
// Runs against an in-process stand-in for the worker (testSupport.ts); the real worker in a
// browser is covered by web/e2e/engine.spec.ts.
import { describe, expect, it } from "vitest";
import { createEngine } from "./engine.ts";
import { InProcessWorker, REF, type Behaviour } from "./testSupport.ts";
import { EngineError } from "./types.ts";

const opts = { referenceDate: REF };
const rejects = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    return (e as EngineError).code;
  }
  return "resolved";
};

function engineWith(...behaviours: Behaviour[]) {
  const spawned: InProcessWorker[] = [];
  const engine = createEngine(() => {
    const w = new InProcessWorker(behaviours[spawned.length] ?? "ok");
    spawned.push(w);
    return w;
  });
  return { engine, spawned };
}

describe("engine client", () => {
  it("runs every operation and keeps concurrent calls apart by id", async () => {
    const { engine, spawned } = engineWith();
    const text = "NIK: 3174051509900001 \u{1F600} telp 081234567890";
    const [found, ver, occ] = await Promise.all([engine.scan(text, opts), engine.version(), engine.findOccurrences(text, "NIK")]);
    expect(found.map((f) => f.kind)).toEqual(["NIK", "TELEPON"]);
    expect(ver.engine).toBe("privora-core");
    expect(occ).toEqual([{ start: 0, end: 3 }]);
    const spans = found.map((f) => ({ start: f.start, end: f.end, kind: f.kind }));
    expect(await engine.redact(text, spans, "LABEL")).toBe("NIK: [NIK] \u{1F600} telp [TELEPON]");
    const t = await engine.tokenize(text, spans);
    expect((await engine.restore(t.text, t.map, "STRICT")).text).toBe(text);
    expect(spawned).toHaveLength(1); // one worker, reused
  });

  it("reports scan progress", async () => {
    const { engine } = engineWith();
    const text = ("NIK: 3174051509900001\n\n").repeat(50_000); // > 1M units: several chunks
    const steps: number[] = [];
    const found = await engine.scan(text, opts, { onProgress: (p) => steps.push(p.done / p.total) });
    expect(found).toHaveLength(50_000);
    expect(steps.length).toBeGreaterThan(1);
    expect(steps.at(-1)).toBe(1);
    const last = found.at(-1);
    expect(text.slice(last?.start, last?.end)).toBe("3174051509900001");
  });

  it("an engine error rejects only that call and keeps the worker", async () => {
    const { engine, spawned } = engineWith();
    expect(await rejects(engine.redact("abc", [{ start: 0, end: 9, kind: null }], "LABEL"))).toBe("INVALID_SPAN");
    expect(await engine.findOccurrences("aa", "a")).toHaveLength(2);
    expect(spawned).toHaveLength(1);
  });

  it("cancel() rejects pending calls with CANCELLED, terminates, and the next call respawns", async () => {
    const { engine, spawned } = engineWith("hangs", "ok");
    const a = rejects(engine.scan("x", opts));
    const b = rejects(engine.version());
    engine.cancel();
    expect([await a, await b]).toEqual(["CANCELLED", "CANCELLED"]);
    expect(spawned[0]?.terminated).toBe(true);
    expect((await engine.version()).engine).toBe("privora-core");
    expect(spawned).toHaveLength(2);
  });

  it("an AbortSignal cancels the same way, and a signal already aborted never reaches the worker", async () => {
    const { engine, spawned } = engineWith("hangs", "ok");
    const ac = new AbortController();
    const p = rejects(engine.scan("x", opts, { signal: ac.signal }));
    ac.abort();
    expect(await p).toBe("CANCELLED");
    expect(spawned[0]?.terminated).toBe(true);
    expect(await rejects(engine.scan("x", opts, { signal: ac.signal }))).toBe("CANCELLED");
    expect(spawned).toHaveLength(1);
  });

  it("a late reply from a terminated worker is ignored", async () => {
    const { engine, spawned } = engineWith("ok", "ok");
    const first = rejects(engine.scan("NIK: 3174051509900001", opts));
    engine.cancel();
    expect(await first).toBe("CANCELLED");
    const second = await engine.findOccurrences("abab", "ab");
    expect(second).toHaveLength(2);
    expect(spawned).toHaveLength(2);
  });

  it("reports a failed wasm load as LOAD_FAILED and retries with a fresh worker", async () => {
    const { engine, spawned } = engineWith("load-fails", "ok");
    expect(await rejects(engine.version())).toBe("LOAD_FAILED");
    expect(spawned[0]?.terminated).toBe(true);
    expect((await engine.version()).schema).toBe(1);
  });

  it("an INTERNAL error (wasm trap) recycles the worker", async () => {
    const { engine, spawned } = engineWith("crashes", "ok");
    expect(await rejects(engine.version())).toBe("INTERNAL");
    expect(spawned[0]?.terminated).toBe(true);
    expect((await engine.version()).schema).toBe(1);
  });

  it("failure to create a worker is LOAD_FAILED", async () => {
    const engine = createEngine(() => {
      throw new Error("no workers here");
    });
    expect(await rejects(engine.version())).toBe("LOAD_FAILED");
  });

  it("worker error events map to LOAD_FAILED before any reply and INTERNAL after", async () => {
    const { engine, spawned } = engineWith("hangs", "ok", "ok");
    const p = rejects(engine.version());
    spawned[0]?.onerror?.(new Error("script failed"));
    expect(await p).toBe("LOAD_FAILED");
    await engine.version(); // second worker answers
    const q = rejects(engine.scan("x", opts));
    // make the second worker hang on the next call by swapping its behaviour
    (spawned[1] as unknown as { behaviour: Behaviour }).behaviour = "hangs";
    spawned[1]?.onerror?.(new Error("boom"));
    expect(await q).toBe("INTERNAL");
  });

  it("dispose() leaves the engine usable", async () => {
    const { engine, spawned } = engineWith();
    await engine.version();
    engine.dispose();
    expect(spawned[0]?.terminated).toBe(true);
    await engine.version();
    expect(spawned).toHaveLength(2);
  });
});
