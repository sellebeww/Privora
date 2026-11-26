// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Findings as rows for the list: Indonesian reason text, implied sex and birth date for NIK (panel only).
import { id } from "../i18n/id";
import type { FindingRow } from "../ui";
import type { Finding, RefDate, Validation } from "../engine/types";
import type { SessionState } from "./session";

const two = (n: number) => String(n).padStart(2, "0");
const date = (d: RefDate) => `${two(d.day)}-${two(d.month)}-${d.year}`;

/** What a valid NIK implies. Shown in the panel only, never in the output. */
export function nikDetail(v: Validation | null): string | null {
  if (!v || v.type !== "NIK_OK") return null;
  const w = id.workspace;
  const dates = v.birthCandidates.map(date).join(" / ");
  return w.nikDetail(v.gender === "L" ? w.male : w.female, v.centuryAmbiguous ? `${dates} (${w.nikAmbiguous})` : dates);
}

export function reasonText(f: Finding): string {
  const base = id.workspace.reason[f.reason] ?? id.workspace.reasonUnknown;
  const d = f.kind === "NIK" ? nikDetail(f.validation) : null;
  return d ? `${base}. ${d}` : base;
}

const SHOWN = 120;
const clip = (s: string) => (s.length > SHOWN ? `${s.slice(0, SHOWN)}...` : s);

export function findingRows(s: SessionState): FindingRow[] {
  const rows: FindingRow[] = s.findings.map((f, i) => ({
    key: `a${i}`,
    kind: f.kind,
    confidence: f.confidence,
    reason: reasonText(f),
    value: clip(s.text.slice(f.start, f.end)),
    selected: s.selected.has(`a${i}`),
  }));
  for (const m of s.manual) {
    rows.push({
      key: m.key,
      kind: id.workspace.manualKind,
      reason: id.workspace.manualReason,
      value: clip(s.text.slice(m.start, m.end)),
      selected: s.selected.has(m.key),
    });
  }
  return rows;
}
