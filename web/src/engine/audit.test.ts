// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Regression tests for past leaks. All values are invented (SINTETIS).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scanChunked } from "./handler.ts";
import { REF, wasmApi } from "./testSupport.ts";
import type { Finding, RefDate } from "./types.ts";

const options = { referenceDate: REF };
const whole = (text: string) => JSON.parse(wasmApi.scan(text, JSON.stringify(options))) as Finding[];
const parts = (text: string, target: number) => scanChunked(wasmApi, text, options, () => {}, target);

describe("a scan in chunks finds exactly what one scan finds", () => {
  const values = [
    "NIK: 3171 0115 0590 0001",
    "HP: +62 812 5550 0101",
    "Kartu: 4111 1111 1111 1111",
    "Nama: Budi Contoh Santoso",
    "Tanggal Lahir: 15 Mei 1990",
    "surel budi.contoh@example.test",
  ];
  // One long line (minified JSON, a CSV export): every cut has to land on a space, often inside a value.
  const oneLine = values.map((v) => `{ data pengisi tanpa angka penting , ${v}  } `).join("");
  const lines = `Pembuka\n${"pengisi ".repeat(20)}\nAlamat: Jl. Contoh Raya Nomor Lima\nRT 01 RW 02 Kel. Contoh\nNIK: 3171 0115 0590 0001 akhir`;

  for (const [name, text] of [["one long line", oneLine], ["several lines", lines]] as const) {
    it(`${name}: every chunk size from 40 to the whole text`, () => {
      const want = whole(text);
      expect(want.length).toBeGreaterThan(1);
      const wrong: number[] = [];
      for (let target = 40; target <= text.length; target += 1) {
        if (JSON.stringify(parts(text, target)) !== JSON.stringify(want)) wrong.push(target);
      }
      expect(wrong).toEqual([]);
    });
  }
});

describe("NIK validator against the independent Python oracle (scripts/audit/nik_oracle.py)", () => {
  interface Case {
    name: string;
    nik: string;
    today: [number, number, number];
    expect: { error?: string; gender?: string; born?: number[][]; ambiguous?: boolean };
  }
  const cases = JSON.parse(readFileSync(new URL("./fixtures/nik_oracle.json", import.meta.url), "utf8")) as Case[];

  it("has at least 30 cases", () => expect(cases.length).toBeGreaterThanOrEqual(30));
  it.each(cases)("$name", (c) => {
    const [year, month, day] = c.today;
    const referenceDate: RefDate = { year, month, day };
    const found = JSON.parse(wasmApi.scan(`NIK ${c.nik}`, JSON.stringify({ sensitivity: "HATI_HATI", referenceDate }))) as Finding[];
    expect(found.map((f) => [f.kind, f.start, f.end])).toEqual([["NIK", 4, 20]]);
    const v = found[0]!.validation!;
    const got =
      v.type === "NIK_OK"
        ? { gender: v.gender, born: v.birthCandidates.map((d) => [d.year, d.month, d.day]), ambiguous: v.centuryAmbiguous }
        : { error: v.type === "NIK_ERROR" ? v.error : v.type };
    expect(got).toEqual(c.expect);
  });
});
