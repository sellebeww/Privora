// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Compare the wasm engine with the independent Python oracle (SINTETIS). Needs `make wasm` first.
//   python3 scripts/audit/nik_oracle.py random 200000 1 > /tmp/cases.json
//   node scripts/audit/nik-diff.mjs /tmp/cases.json
import { readFileSync } from "node:fs";
import { initSync, scan } from "../../web/src/wasm/pkg/privora.js";

initSync({ module: readFileSync(new URL("../../web/src/wasm/pkg/privora_bg.wasm", import.meta.url)) });

const cases = JSON.parse(readFileSync(process.argv[2], "utf8"));
const byDate = new Map();
for (const c of cases) {
  const k = c.today.join("-");
  if (!byDate.has(k)) byDate.set(k, []);
  byDate.get(k).push(c);
}

const seen = (v) =>
  v.type === "NIK_ERROR"
    ? { error: v.error }
    : { gender: v.gender, born: v.birthCandidates.map((d) => [d.year, d.month, d.day]), ambiguous: v.centuryAmbiguous };

let compared = 0;
const wrong = [];
for (const group of byDate.values()) {
  const [year, month, day] = group[0].today;
  const options = JSON.stringify({ sensitivity: "HATI_HATI", referenceDate: { year, month, day } });
  for (let from = 0; from < group.length; from += 5000) {
    const part = group.slice(from, from + 5000);
    // The keyword makes every 16 digit line a NIK finding, valid or not.
    const text = part.map((c) => `NIK ${c.nik}`).join("\n");
    const found = new Map(JSON.parse(scan(text, options)).filter((f) => f.kind === "NIK").map((f) => [f.start, f]));
    part.forEach((c, i) => {
      const f = found.get(i * 21 + 4);
      const got = f?.validation ? seen(f.validation) : null;
      compared += 1;
      if (JSON.stringify(got) !== JSON.stringify(c.expect)) wrong.push({ name: c.name, nik: c.nik, today: c.today, python: c.expect, rust: got });
    });
  }
}
console.log(`nik-diff: ${compared} cases compared, ${wrong.length} differences`);
for (const w of wrong.slice(0, 10)) console.log(JSON.stringify(w));
process.exit(wrong.length === 0 && compared === cases.length ? 0 : 1);
