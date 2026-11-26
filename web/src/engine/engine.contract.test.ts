// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// The TypeScript API against the real wasm build: same results as the native Rust core (golden
// file, written by crates/privora-wasm/tests/api.rs), word lists in sync, typed errors.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handle } from "./handler.ts";
import { REF, wasmApi } from "./testSupport.ts";
import {
  CLIENT_ERROR_CODES,
  CONFIDENCES,
  EngineError,
  KINDS,
  NIK_ERRORS,
  SCHEMA_VERSION,
  WASM_ERROR_CODES,
  type Finding,
  type Span,
} from "./types.ts";

interface Case {
  name: string;
  text: string;
  options: string;
  spans: string;
  scan: string;
  redactLabel: string;
  redactBlock: string;
  tokenize: string;
  restoreStrict: string;
  restoreTolerant: string;
  needle: string;
  find: string;
}
const golden = JSON.parse(readFileSync(new URL("./fixtures/golden.json", import.meta.url), "utf8")) as { cases: Case[] };
const opts = { referenceDate: REF };

describe("contract with the Rust crate", () => {
  it("word lists and schema version match the wasm build", () => {
    const v = handle(wasmApi, { id: 1, op: "version" });
    expect(v.engine).toBe("privora-core");
    expect(v.schema).toBe(SCHEMA_VERSION);
    expect(v.kinds).toEqual([...KINDS]);
    expect(v.confidences).toEqual([...CONFIDENCES]);
    expect(v.errors).toEqual([...WASM_ERROR_CODES]);
    expect(CLIENT_ERROR_CODES.some((c) => (WASM_ERROR_CODES as readonly string[]).includes(c))).toBe(false);
  });

  it("golden file has the documents we expect (emoji included)", () => {
    expect(golden.cases.map((c) => c.name)).toEqual(["empty", "form", "emoji_and_diacritics", "token_lookalike"]);
    expect(golden.cases.some((c) => /\u{1F600}/u.test(c.text))).toBe(true);
  });

  for (const c of golden.cases) {
    it(`wasm equals native Rust on "${c.name}"`, () => {
      const spans = JSON.parse(c.spans) as Span[];
      expect(JSON.stringify(handle(wasmApi, { id: 1, op: "scan", text: c.text, options: opts }))).toBe(c.scan);
      expect(handle(wasmApi, { id: 1, op: "redact", text: c.text, spans, style: "LABEL" })).toBe(c.redactLabel);
      expect(handle(wasmApi, { id: 1, op: "redact", text: c.text, spans, style: "BLOK" })).toBe(c.redactBlock);
      const t = handle(wasmApi, { id: 1, op: "tokenize", text: c.text, spans });
      expect(JSON.stringify(t)).toBe(c.tokenize);
      const strict = handle(wasmApi, { id: 1, op: "restore", text: t.text, map: t.map, mode: "STRICT" });
      expect(JSON.stringify(strict)).toBe(c.restoreStrict);
      expect(JSON.stringify(handle(wasmApi, { id: 1, op: "restore", text: t.text, map: t.map, mode: "TOLERANT" }))).toBe(c.restoreTolerant);
      expect(JSON.stringify(handle(wasmApi, { id: 1, op: "findOccurrences", text: c.text, needle: c.needle }))).toBe(c.find);
    });

    it(`round trip restores "${c.name}" exactly, offsets are UTF-16`, () => {
      const found = handle(wasmApi, { id: 1, op: "scan", text: c.text, options: opts });
      for (const f of found) {
        expect(f.start).toBeGreaterThanOrEqual(0);
        expect(f.end).toBeLessThanOrEqual(c.text.length);
        // The text at a UTF-16 range is what the engine saw: never starts on a low surrogate.
        expect(c.text.charCodeAt(f.start) >= 0xdc00 && c.text.charCodeAt(f.start) < 0xe000).toBe(false);
      }
      const t = handle(wasmApi, { id: 1, op: "tokenize", text: c.text, spans: found });
      const back = handle(wasmApi, { id: 1, op: "restore", text: t.text, map: t.map, mode: "STRICT" });
      expect(back.text).toBe(c.text);
    });
  }

  it("findings carry exactly the documented fields and enum words", () => {
    const text = "\u{1F600} NIK: 3174051509900001, telp 0812 3456 7890, a@b.co, kartu 4111 1111 1111 1111";
    const found = handle(wasmApi, { id: 1, op: "scan", text, options: opts });
    expect(found.map((f) => f.kind)).toEqual(["NIK", "TELEPON", "EMAIL", "KARTU"]);
    for (const f of found) {
      expect(Object.keys(f).sort()).toEqual(["confidence", "end", "kind", "reason", "start", "validation"]);
      expect(KINDS).toContain(f.kind);
      expect(CONFIDENCES).toContain(f.confidence);
    }
    const nik = found[0] as Finding;
    expect(text.slice(nik.start, nik.end)).toBe("3174051509900001");
    expect(nik.validation).toEqual({
      type: "NIK_OK",
      province: 31,
      gender: "L",
      birthCandidates: [{ year: 1990, month: 9, day: 15 }],
      centuryAmbiguous: false,
    });
    expect(found[3]?.validation).toEqual({ type: "LUHN" });
    const bad = handle(wasmApi, { id: 1, op: "scan", text: "NIK: 9911111111111111", options: opts })[0];
    expect(bad?.validation).toEqual({ type: "NIK_ERROR", error: "UNKNOWN_PROVINCE" });
    expect(NIK_ERRORS).toContain("UNKNOWN_PROVINCE");
  });

  it("sensitivity HATI_HATI is honoured", () => {
    const text = "kode 1234567890123456 selesai";
    const a = handle(wasmApi, { id: 1, op: "scan", text, options: opts });
    const b = handle(wasmApi, { id: 1, op: "scan", text, options: { ...opts, sensitivity: "HATI_HATI" } });
    expect(b.length).toBeGreaterThanOrEqual(a.length);
    expect(b.some((f) => f.kind === "NIK" && f.confidence === "RENDAH")).toBe(true);
  });

  it("manual spans (kind null) and Finding objects as spans both work", () => {
    const text = "halo Budi dan NIK 3174051509900001";
    const f = handle(wasmApi, { id: 1, op: "scan", text, options: opts });
    expect(handle(wasmApi, { id: 1, op: "redact", text, spans: [{ start: 5, end: 9, kind: null }, ...(f as unknown as Span[])], style: "LABEL" })).toBe(
      "halo [DATA] dan NIK [NIK]",
    );
  });
});

describe("typed errors", () => {
  const codeOf = (fn: () => unknown): string => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      return (e as EngineError).code;
    }
    return "no error";
  };

  it("maps each failure to its code", () => {
    expect(codeOf(() => handle(wasmApi, { id: 1, op: "redact", text: "abc", spans: [{ start: 0, end: 9, kind: null }], style: "LABEL" }))).toBe("INVALID_SPAN");
    expect(codeOf(() => handle(wasmApi, { id: 1, op: "redact", text: "a\u{1F600}", spans: [{ start: 2, end: 3, kind: null }], style: "LABEL" }))).toBe("INVALID_SPAN");
    expect(codeOf(() => handle(wasmApi, { id: 1, op: "redact", text: "abc", spans: [], style: "X" as never }))).toBe("INVALID_INPUT");
    expect(codeOf(() => handle(wasmApi, { id: 1, op: "scan", text: "abc", options: { referenceDate: { year: 2026, month: 13, day: 1 } } }))).toBe("INVALID_INPUT");
    const text = "[[NIK_1]] [[PRV-NIK_1]] 3174051509900001";
    expect(codeOf(() => handle(wasmApi, { id: 1, op: "tokenize", text, spans: [{ start: 24, end: 40, kind: "NIK" }] }))).toBe("TOKEN_COLLISION");
  });

  it("a wasm trap or foreign throw becomes INTERNAL", () => {
    const broken = { ...wasmApi, scan: () => { throw new WebAssembly.RuntimeError("unreachable"); } };
    expect(codeOf(() => handle(broken, { id: 1, op: "scan", text: "x", options: { referenceDate: REF } }))).toBe("INTERNAL");
  });

  it("error messages never contain user text", () => {
    const secret = "3174051509900001-RAHASIA";
    for (const fn of [
      () => handle(wasmApi, { id: 1, op: "restore", text: secret, map: [{ token: secret, value: 5 as never }], mode: "STRICT" }),
      () => handle(wasmApi, { id: 1, op: "redact", text: secret, spans: [{ start: 0, end: 999, kind: "BOGUS" as never }], style: "LABEL" }),
      () => handle(wasmApi, { id: 1, op: "scan", text: secret, options: { referenceDate: { year: secret as never, month: 1, day: 1 } } }),
    ]) {
      try {
        fn();
        expect.unreachable();
      } catch (e) {
        expect(String((e as Error).message) + String((e as Error).stack ?? "").split("\n")[0]).not.toContain("RAHASIA");
        expect(WASM_ERROR_CODES as readonly string[]).toContain((e as EngineError).code);
      }
    }
  });

  it("refuses an input over the size cap instead of trapping", () => {
    const big = "a".repeat(64 * 1024 * 1024 + 1);
    expect(codeOf(() => handle(wasmApi, { id: 1, op: "findOccurrences", text: big, needle: "a" }))).toBe("TOO_LARGE");
    // Under the unit cap but over the byte cap (3 bytes per character): refused inside wasm.
    const cjk = "\u5b57".repeat(22_400_000);
    expect(codeOf(() => handle(wasmApi, { id: 1, op: "findOccurrences", text: cjk, needle: "x" }))).toBe("TOO_LARGE");
    // and the instance is still usable afterwards
    expect(handle(wasmApi, { id: 1, op: "findOccurrences", text: "aa", needle: "a" })).toHaveLength(2);
  });

  it("a lone surrogate keeps offsets aligned", () => {
    const text = "x\uD800y NIK: 3174051509900001";
    const f = handle(wasmApi, { id: 1, op: "scan", text, options: { referenceDate: REF } });
    expect(text.slice(f[0]?.start, f[0]?.end)).toBe("3174051509900001");
  });
});
