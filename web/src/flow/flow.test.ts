// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Text flow without a browser: files, marks, session reducer, and the real wasm engine through the
// worker client (in-process stand-in), from pasted text to restored text. All data is SINTETIS.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreWithMarks } from "../app/Restore";
import { createEngine } from "../engine/engine";
import { InProcessWorker, REF } from "../engine/testSupport";
import type { Finding, TokenEntry } from "../engine/types";
import { findingRows, nikDetail } from "./findingRows";
import { FileReadError, downloadName, readTextFile, TEXT_WARN_BYTES, type FileLike } from "./files";
import { buildMarks, estimateHeight, piecesOf, spansOf, splitBlocks, trimRange, type Row } from "./marks";
import { initialState, reducer, rowsOf, type SessionState } from "./session";

const bytes = (...b: number[]): FileLike => ({ name: "a.txt", size: b.length, arrayBuffer: async () => new Uint8Array(b).buffer });
const fileOf = (name: string, content: string | Uint8Array, size?: number): FileLike => {
  const u = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return { name, size: size ?? u.length, arrayBuffer: async () => u.slice().buffer };
};

describe("source: reading a file locally", () => {
  it("reads UTF-8 with diacritics, emoji and CRLF exactly as written", async () => {
    const t = "Nama : Siti Aminah \u{1F600}\r\nAlamat : Jl. Kebon Jeruk\r\n";
    expect((await readTextFile(fileOf("a.txt", t))).text).toBe(t);
  });
  it("drops a BOM and nothing else", async () => {
    const r = await readTextFile(fileOf("a.md", "﻿halo"));
    expect(r.text).toBe("halo");
  });
  it("a wrong encoding is a clear error, not replacement characters", async () => {
    await expect(readTextFile(bytes(0x63, 0x61, 0x66, 0xe9))).rejects.toMatchObject({ code: "ENCODING" }); // Latin-1 "cafe" with e acute
    await expect(readTextFile(bytes(0xff, 0xfe, 0x41, 0x00))).rejects.toBeInstanceOf(FileReadError); // UTF-16 LE
    await expect(readTextFile(bytes(0xc0, 0xaf))).rejects.toMatchObject({ code: "ENCODING" }); // overlong
  });
  it("empty and unsupported files", async () => {
    await expect(readTextFile(fileOf("a.txt", "  \n "))).rejects.toMatchObject({ code: "EMPTY" });
    await expect(readTextFile(fileOf("a.docx", "x"))).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    await expect(readTextFile(fileOf("noext", "x"))).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    await expect(readTextFile({ name: "a.csv", size: 1, arrayBuffer: () => Promise.reject(new Error("x")) })).rejects.toMatchObject({ code: "READ_FAILED" });
  });
  it("accepts .csv and upper case extensions", async () => {
    expect((await readTextFile(fileOf("DATA.CSV", "a,b"))).text).toBe("a,b");
  });
  it("size over 25 MB is a warning (large), not a block", async () => {
    expect((await readTextFile(fileOf("a.txt", "x", TEXT_WARN_BYTES + 1))).large).toBe(true);
    expect((await readTextFile(fileOf("a.txt", "x", TEXT_WARN_BYTES))).large).toBe(false);
  });
  // F-06: a source name such as "KTP Budi 3171....txt" must never reach an output file name.
  it("download names are fixed and carry nothing from the source", () => {
    expect(downloadName("samar", "txt")).toBe("dokumen-samar.txt");
    expect(downloadName("peta", "json")).toBe("dokumen-peta.json");
  });
  // F-15: bytes that happen to be valid UTF-8 can still be a binary file.
  it("a binary file with a NUL byte is refused", async () => {
    await expect(readTextFile(bytes(0x50, 0x4b, 0x03, 0x04, 0x00, 0x00))).rejects.toMatchObject({ code: "ENCODING" });
  });
});

const row = (key: string, start: number, end: number, selected = true, kind: string | null = "NIK"): Row => ({ key, start, end, kind, selected });

describe("review: marks, blocks, selection", () => {
  it("overlapping rows: a stretch is selected only where a selected row covers it", () => {
    const m = buildMarks([row("a", 10, 20, false), row("m1", 15, 30, true, null), row("b", 40, 50)]);
    expect(m).toEqual([
      { start: 10, end: 15, selected: false, keys: ["a"] },
      { start: 15, end: 30, selected: true, keys: ["a", "m1"] },
      { start: 40, end: 50, selected: true, keys: ["b"] },
    ]);
  });
  it("a manual range inside a selected finding is one selected mark with both keys", () => {
    expect(buildMarks([row("a", 10, 30), row("m1", 12, 18, true, null)])).toEqual([{ start: 10, end: 30, selected: true, keys: ["a", "m1"] }]);
  });
  it("marks are always sorted, disjoint, and selected exactly where spansOf covers (random rows)", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
    for (let t = 0; t < 200; t++) {
      const rows = Array.from({ length: 1 + rnd(8) }, (_, i) => {
        const a = rnd(60);
        return row(`r${i}`, a, a + 1 + rnd(20), rnd(2) === 1, i % 2 ? null : "NIK");
      });
      const marks = buildMarks(rows);
      for (let i = 1; i < marks.length; i++) expect(marks[i]!.start).toBeGreaterThanOrEqual(marks[i - 1]!.end);
      for (let pos = 0; pos < 90; pos++) {
        const hidden = rows.some((r) => r.selected && r.start <= pos && pos < r.end);
        const shown = rows.some((r) => r.start <= pos && pos < r.end);
        const m = marks.find((x) => x.start <= pos && pos < x.end);
        expect(!!m).toBe(shown);
        if (m) expect(m.selected).toBe(hidden);
      }
    }
  });
  it("touching rows stay separate marks", () => {
    expect(buildMarks([row("a", 0, 5), row("b", 5, 9)])).toHaveLength(2);
  });
  it("spansOf passes only selected rows, keeps null kind for manual", () => {
    expect(spansOf([row("a", 0, 5), row("b", 6, 9, false), row("m1", 10, 12, true, null)])).toEqual([
      { start: 0, end: 5, kind: "NIK" },
      { start: 10, end: 12, kind: null },
    ]);
  });
  it("blocks cover the text exactly, never cut a surrogate pair, and prefer line ends", () => {
    const text = ("baris \u{1F600} dengan emoji dan teks Indonesia\n".repeat(400)) + "x".repeat(9000) + "\u{1F600}".repeat(3000);
    const blocks = splitBlocks(text, 1000);
    expect(blocks[0]!.start).toBe(0);
    expect(blocks.at(-1)!.end).toBe(text.length);
    blocks.forEach((b, i) => {
      if (i > 0) expect(b.start).toBe(blocks[i - 1]!.end);
      const hi = text.charCodeAt(b.end - 1);
      expect(hi >= 0xd800 && hi < 0xdc00 && b.end < text.length).toBe(false);
    });
    expect(splitBlocks("")).toEqual([]);
  });
  it("pieces of every block concatenate to the block text, marks clipped to block edges", () => {
    const text = "abcdefghij".repeat(100);
    const marks = buildMarks([row("a", 5, 15), row("b", 95, 105), row("c", 990, 1000), row("d", 300, 700)]);
    const blocks = splitBlocks(text, 100);
    let from = 0;
    for (const b of blocks) {
      const { pieces, next } = piecesOf(b, marks, from);
      from = next;
      expect(pieces.map((p) => text.slice(p.start, p.end)).join("")).toBe(text.slice(b.start, b.end));
      for (const p of pieces) expect(p.start >= b.start && p.end <= b.end && p.end > p.start).toBe(true);
    }
  });
  it("trimRange trims edge whitespace and refuses empty", () => {
    expect(trimRange("  Budi  ", 0, 8)).toEqual({ start: 2, end: 6 });
    expect(trimRange("   ", 0, 3)).toBeNull();
    expect(trimRange("abc", 2, 0)).toEqual({ start: 0, end: 2 });
    const t = "a\u{1F600}b";
    expect(trimRange(t, 2, 3)).toEqual({ start: 1, end: 3 }); // starts inside the pair: pulled back
  });
  it("height estimate grows with lines and wrapping", () => {
    const text = "a\n".repeat(10);
    expect(estimateHeight(text, { start: 0, end: text.length }, 80, 24)).toBe(240);
    const long = "x".repeat(800);
    expect(estimateHeight(long, { start: 0, end: 800 }, 80, 24)).toBe(240);
  });
});

describe("session reducer", () => {
  const f = (start: number, end: number, kind: Finding["kind"] = "NIK"): Finding => ({ kind, start, end, confidence: "TINGGI", reason: "NIK_STRUKTUR_VALID", validation: null });
  const scanned = (s = initialState): SessionState => reducer(reducer(s, { type: "scan-start" }), { type: "scan-done", findings: [f(0, 5), f(10, 15, "EMAIL")], sensitivity: "SEIMBANG" });
  it("all findings start selected; toggle and set-all respect choices", () => {
    let s = scanned();
    expect([...s.selected].sort()).toEqual(["a0", "a1"]);
    s = reducer(s, { type: "toggle", keys: ["a0"] });
    expect(s.selected.has("a0")).toBe(false);
    expect(s.selected.has("a1")).toBe(true);
    s = reducer(s, { type: "set-all", keys: ["a0", "a1"], on: false });
    expect(s.selected.size).toBe(0);
    s = reducer(s, { type: "toggle", keys: ["a0", "a1"] }); // none selected: turns all on
    expect(s.selected.size).toBe(2);
    s = reducer(s, { type: "toggle", keys: ["a0", "a1"] }); // all selected: turns all off
    expect(s.selected.size).toBe(0);
  });
  it("manual ranges are deduplicated by range and selected", () => {
    let s = scanned();
    s = reducer(s, { type: "add-manual", ranges: [{ start: 20, end: 25 }, { start: 20, end: 25 }, { start: 30, end: 31 }] });
    expect(s.manual.map((m) => m.key)).toEqual(["m1", "m2"]);
    s = reducer(s, { type: "toggle", keys: ["m1"], on: false });
    s = reducer(s, { type: "add-manual", ranges: [{ start: 20, end: 25 }] });
    expect(s.manual).toHaveLength(2);
    expect(s.selected.has("m1")).toBe(true); // adding again re-selects the same range
  });
  it("a rescan keeps selected manual ranges and switched-off findings (same range), token map is dropped", () => {
    let s = scanned();
    s = reducer(s, { type: "add-manual", ranges: [{ start: 20, end: 25 }] });
    s = reducer(s, { type: "token-map", map: [{ token: "[[X_1]]", value: "v" }] });
    s = reducer(s, { type: "toggle", keys: ["a0"], on: false });
    s = reducer(reducer(s, { type: "scan-start" }), { type: "scan-done", findings: [f(0, 5), f(40, 45)], sensitivity: "HATI_HATI" });
    expect([...s.selected].sort()).toEqual(["a1", "m1"]); // a0 (0:5) was switched off, a1 is new
    expect(s.tokenMap).toBeNull();
    expect(s.scannedWith).toBe("HATI_HATI");
  });
  it("new text drops findings, selection and map but keeps settings", () => {
    let s = scanned({ ...initialState, sensitivity: "HATI_HATI", style: "BLOK", mode: "tokenize" });
    s = reducer(s, { type: "text", text: "baru", fileName: "x.txt" });
    expect(s).toMatchObject({ text: "baru", fileName: "x.txt", findings: [], manual: [], tokenMap: null, scannedWith: null, sensitivity: "HATI_HATI", style: "BLOK", mode: "tokenize" });
    expect(s.selected.size).toBe(0);
  });
  it("cancel returns to idle without an error banner state of its own", () => {
    const s = reducer(reducer(initialState, { type: "scan-start" }), { type: "scan-fail", error: "CANCELLED" });
    expect(s.phase).toBe("idle");
    expect(reducer(reducer(initialState, { type: "scan-start" }), { type: "scan-fail", error: "INTERNAL" }).phase).toBe("error");
  });
  it("progress is ignored unless scanning", () => {
    expect(reducer(initialState, { type: "scan-progress", done: 1, total: 2 })).toBe(initialState);
  });
});

// A synthetic document: every name, number and address is invented.
const NIK = "3171011505900001";
const DOC = [
  "SURAT KETERANGAN (SINTETIS)",
  "Nama : Budi Contoh Santoso",
  `NIK : ${NIK}`,
  "Telp : 0812-5550-0101",
  "Email : budi.contoh@example.test",
  "Alamat : Jl. Contoh No. 5, RT 01 RW 02",
  "Catatan: Budi Contoh Santoso hadir. \u{1F600} Hubungi budi.contoh@example.test lagi.",
].join("\n");

const newEngine = () => createEngine(() => new InProcessWorker());

async function review(text: string) {
  const engine = newEngine();
  const findings = await engine.scan(text, { referenceDate: REF });
  let s: SessionState = reducer(reducer({ ...initialState, text }, { type: "scan-start" }), { type: "scan-done", findings, sensitivity: "SEIMBANG" });
  return { engine, get s() { return s; }, set: (x: SessionState) => (s = x) };
}

describe("end to end with the real engine: paste, review, change selection, tokenise, LLM reply, restore", () => {
  it("finds the invented data and explains NIK in the panel only", async () => {
    const r = await review(DOC);
    const rows = findingRows(r.s);
    const kinds = new Set(rows.map((x) => x.kind));
    for (const k of ["NIK", "TELEPON", "EMAIL", "NAMA", "ALAMAT"]) expect(kinds.has(k)).toBe(true);
    const nik = rows.find((x) => x.kind === "NIK")!;
    expect(nik.reason).toContain("perempuan".length ? "Tersirat" : "");
    expect(nik.reason).toMatch(/laki-laki|perempuan/);
    expect(nik.reason).toContain("15-05-1990");
    expect(nik.value).toBe(NIK);
    // The explanation never reaches the output.
    const out = await r.engine.redact(DOC, spansOf(rowsOf(r.s)), "LABEL");
    expect(out).not.toMatch(/laki-laki|perempuan|1990|Tersirat/);
    expect(out).toContain("[NIK]");
    expect(out).not.toContain(NIK);
  });
  it("a deselected finding stays visible, selected ones are hidden (user choice is honoured)", async () => {
    const r = await review(DOC);
    const rows = rowsOf(r.s);
    const phone = rows.find((x) => DOC.slice(x.start, x.end) === "0812-5550-0101")!;
    r.set(reducer(r.s, { type: "toggle", keys: [phone.key], on: false }));
    const out = await r.engine.redact(DOC, spansOf(rowsOf(r.s)), "BLOK");
    expect(out).toContain("0812-5550-0101");
    expect(out).not.toContain(NIK);
    expect(out).toContain("█".repeat(8));
  });
  it("none selected: the output equals the input", async () => {
    const r = await review(DOC);
    r.set(reducer(r.s, { type: "set-all", keys: rowsOf(r.s).map((x) => x.key), on: false }));
    expect(await r.engine.redact(DOC, spansOf(rowsOf(r.s)), "LABEL")).toBe(DOC);
    const t = await r.engine.tokenize(DOC, spansOf(rowsOf(r.s)));
    expect(t.text).toBe(DOC);
    expect(t.map).toEqual([]);
  });
  it("manual range overlapping a selected finding: union is hidden, nothing of either survives", async () => {
    const r = await review(DOC);
    const at = DOC.indexOf(NIK);
    // starts 3 characters before the NIK and ends 4 characters inside it
    r.set(reducer(r.s, { type: "add-manual", ranges: [{ start: at - 3, end: at + 4 }] }));
    const out = await r.engine.redact(DOC, spansOf(rowsOf(r.s)), "LABEL");
    expect(out).not.toMatch(/3171|NIK : 3|01150|0001/);
    expect(out.match(/\[NIK\]/g)).toHaveLength(1);
    expect(out).toContain("\nNIK[NIK]\n"); // the union became one hidden stretch, its kind kept
  });
  it("manual range over a deselected finding hides only the manual part", async () => {
    const r = await review(DOC);
    const nikRow = rowsOf(r.s).find((x) => DOC.slice(x.start, x.end) === NIK)!;
    r.set(reducer(r.s, { type: "toggle", keys: [nikRow.key], on: false }));
    const at = DOC.indexOf(NIK);
    r.set(reducer(r.s, { type: "add-manual", ranges: [{ start: at, end: at + 6 }] }));
    const out = await r.engine.redact(DOC, spansOf(rowsOf(r.s)), "LABEL");
    expect(out).toContain(`[DATA]${NIK.slice(6)}`);
    expect(out).not.toContain(NIK.slice(0, 6));
  });
  it("hide all occurrences: every exact occurrence becomes a manual range and is hidden", async () => {
    const r = await review(DOC);
    const needle = "Budi Contoh Santoso";
    const found = await r.engine.findOccurrences(DOC, needle);
    expect(found).toHaveLength(2);
    r.set(reducer(r.s, { type: "add-manual", ranges: found }));
    const out = await r.engine.redact(DOC, spansOf(rowsOf(r.s)), "LABEL");
    expect(out).not.toContain("Budi");
    expect(out).not.toContain("Santoso");
  });
  it("tokenise, simulate an LLM reply that keeps tokens, restore: exact original (strict)", async () => {
    const r = await review(DOC);
    const t = await r.engine.tokenize(DOC, spansOf(rowsOf(r.s)));
    expect(t.text).not.toContain(NIK);
    expect(t.text).toMatch(/\[\[NIK_1\]\]/);
    expect(t.map.length).toBeGreaterThan(3);
    const back = await restoreWithMarks(r.engine, t.text, t.map, "STRICT");
    expect(back.text).toBe(DOC);
    expect(back.report.restored).toBeGreaterThan(3);
    expect(back.report.unknown).toEqual([]);
    expect(back.report.unused).toEqual([]);
    // Every mark is exactly one restored value.
    const values = new Set(t.map.map((e) => e.value));
    expect(back.marks.length).toBe(back.report.restored);
    for (const m of back.marks) expect(values.has(back.text.slice(m.start, m.end))).toBe(true);
  });
  it("an LLM reply that rewrites around the tokens restores the values in place", async () => {
    const r = await review(DOC);
    const t = await r.engine.tokenize(DOC, spansOf(rowsOf(r.s)));
    const nikTok = t.map.find((e) => e.value === NIK)!.token;
    const reply = `Ringkasan: pemohon dengan NIK ${nikTok} terdaftar. Sisa: [[BUKAN_1]] dan ${nikTok}.`;
    const back = await restoreWithMarks(r.engine, reply, t.map, "STRICT");
    expect(back.text).toBe(`Ringkasan: pemohon dengan NIK ${NIK} terdaftar. Sisa: [[BUKAN_1]] dan ${NIK}.`);
    expect(back.marks.map((m) => back.text.slice(m.start, m.end))).toEqual([NIK, NIK]);
    expect(back.report.unknown).toEqual(["[[BUKAN_1]]"]);
    expect(back.report.unused.length).toBe(t.map.length - 1);
  });
  it("tolerant mode accepts a changed case and spaces, and flags them; strict leaves them", async () => {
    const r = await review(DOC);
    const t = await r.engine.tokenize(DOC, spansOf(rowsOf(r.s)));
    const nikTok = t.map.find((e) => e.value === NIK)!.token; // [[NIK_1]]
    const sloppy = nikTok.toLowerCase().replace("[[", "[[ ").replace("]]", " ]]");
    const tol = await restoreWithMarks(r.engine, sloppy, t.map, "TOLERANT");
    expect(tol.text).toBe(NIK);
    expect(tol.report.flagged).toHaveLength(1);
    const strict = await restoreWithMarks(r.engine, sloppy, t.map, "STRICT");
    expect(strict.text).toBe(sloppy);
    expect(strict.marks).toEqual([]);
  });
  it("sentinel characters in the input fall back to no highlight, text still correct", async () => {
    const r = await review(DOC);
    const t = await r.engine.tokenize(DOC, spansOf(rowsOf(r.s)));
    const back = await restoreWithMarks(r.engine, `${t.text}`, t.map, "STRICT");
    expect(back.text).toBe(`${DOC}`);
    expect(back.marks).toEqual([]);
  });
  it("token shaped text already in the document makes the namespace change, tokens stay unique", async () => {
    const text = `${DOC}\n[[NIK_1]] sudah ada di teks sumber`;
    const r = await review(text);
    const t = await r.engine.tokenize(text, spansOf(rowsOf(r.s)));
    expect(t.map[0]!.token.startsWith("[[PRV-")).toBe(true);
    const back = await restoreWithMarks(r.engine, t.text, t.map, "STRICT");
    expect(back.text).toBe(text);
  });
  it("round trip holds for random selections and random manual ranges", async () => {
    const r = await review(DOC);
    const rows = rowsOf(r.s);
    let seed = 12345;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
    for (let i = 0; i < 60; i++) {
      let s = r.s;
      for (const x of rows) if (rnd(2)) s = reducer(s, { type: "toggle", keys: [x.key], on: false });
      const ranges = Array.from({ length: rnd(5) }, () => {
        const a = rnd(DOC.length);
        const b = Math.min(DOC.length, a + 1 + rnd(25));
        return trimRange(DOC, a, b);
      }).filter((x): x is { start: number; end: number } => x !== null);
      s = reducer(s, { type: "add-manual", ranges });
      const spans = spansOf(rowsOf(s));
      const t = await r.engine.tokenize(DOC, spans);
      const back = await restoreWithMarks(r.engine, t.text, t.map, "STRICT");
      expect(back.text).toBe(DOC);
    }
  });
  it("a map from a 5 MB document: scan, tokenise and restore stay exact", async () => {
    const unit = DOC + "\n\n";
    const big = unit.repeat(Math.ceil((5 * 1024 * 1024) / unit.length));
    const t0 = performance.now();
    const r = await review(big);
    const scanMs = performance.now() - t0;
    const rows = rowsOf(r.s);
    expect(rows.length).toBeGreaterThan(50_000);
    const t = await r.engine.tokenize(big, spansOf(rows));
    const back = await r.engine.restore(t.text, t.map, "STRICT");
    expect(back.text).toBe(big);
    // Informational timing (Node, in-process, no thread).
    console.info(`5 MB (${big.length} units, ${rows.length} rows) scan ${Math.round(scanMs)} ms`);
  }, 120_000);
  it("rows for 5 MB build quickly", async () => {
    const unit = DOC + "\n\n";
    const big = unit.repeat(Math.ceil((5 * 1024 * 1024) / unit.length));
    const r = await review(big);
    const t0 = performance.now();
    const list = findingRows(r.s);
    const marks = buildMarks(rowsOf(r.s));
    const blocks = splitBlocks(big);
    console.info(`5 MB rows ${list.length}, marks ${marks.length}, blocks ${blocks.length}, build ${Math.round(performance.now() - t0)} ms`);
    expect(marks.length).toBeGreaterThan(0);
  }, 120_000);
  it("a long NIK explanation helper: century ambiguity and null", () => {
    expect(nikDetail(null)).toBeNull();
    expect(nikDetail({ type: "LUHN" })).toBeNull();
    expect(nikDetail({ type: "NIK_OK", province: 31, gender: "L", birthCandidates: [{ year: 1905, month: 1, day: 2 }, { year: 2005, month: 1, day: 2 }], centuryAmbiguous: true })).toBe(
      "Tersirat: laki-laki, lahir 02-01-1905 / 02-01-2005 (abad ambigu)",
    );
  });
  it("cancel: aborting a scan rejects with CANCELLED and the engine keeps working", async () => {
    const engine = newEngine();
    const ac = new AbortController();
    const p = engine.scan(DOC.repeat(2000), { referenceDate: REF }, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await engine.redact("a", [], "LABEL")).toBe("a");
  });
});

describe("no data leaves memory", () => {
  const touched: string[] = [];
  const trap = (name: string) =>
    new Proxy({}, { get: (_t, k) => (touched.push(`${name}.${String(k)}`), undefined), set: () => (touched.push(`${name} set`), true) });
  afterEach(() => vi.unstubAllGlobals());
  it("the whole flow never touches localStorage, sessionStorage or indexedDB", async () => {
    vi.stubGlobal("localStorage", trap("localStorage"));
    vi.stubGlobal("sessionStorage", trap("sessionStorage"));
    vi.stubGlobal("indexedDB", trap("indexedDB"));
    const r = await review(DOC);
    const t = await r.engine.tokenize(DOC, spansOf(rowsOf(r.s)));
    await restoreWithMarks(r.engine, t.text, t.map as TokenEntry[], "TOLERANT");
    expect(touched).toEqual([]);
  });
  // Values are never logged. The app has no logging at all, in TypeScript or in Rust.
  it("no source file logs anything", () => {
    const repo = join(import.meta.dirname, "../../..");
    const bad: string[] = [];
    const walk = (d: string, ext: RegExp, re: RegExp) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) {
          if (n !== "pkg") walk(p, ext, re);
        } else if (ext.test(n) && !/\.test\./.test(n) && re.test(readFileSync(p, "utf8"))) bad.push(p);
      }
    };
    walk(join(repo, "web/src"), /\.(ts|tsx|js)$/, /\bconsole\s*\.|\bdebugger\b/);
    for (const crate of ["privora-core", "privora-wasm"]) walk(join(repo, "crates", crate, "src"), /\.rs$/, /\b(e?print(ln)?|dbg)!|\bconsole::|\bweb_sys\b/);
    expect(bad).toEqual([]);
  });
  it("no source file refers to browser storage APIs", () => {
    const root = join(import.meta.dirname, "..");
    const bad: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) {
          if (n !== "pkg") walk(p);
        } else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) && !p.includes("/wasm/pkg/")) {
          if (/\b(localStorage|sessionStorage|indexedDB|IDBFactory|caches\.open|document\.cookie)\b/.test(readFileSync(p, "utf8"))) bad.push(p);
        }
      }
    };
    walk(root);
    expect(bad).toEqual([]);
  });
});
