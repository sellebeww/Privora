// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Computes WCAG contrast for the token pairs the UI actually uses.
// Exit 1 if a pair that must pass does not. Pairs with a recorded reason are marked EXEMPT, never hidden.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { over, parseColor, parseTokens, ratio } from "./lib/contrast.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tok = parseTokens(readFileSync(join(root, "web/src/styles/tokens.css"), "utf8"));
const solid = (n) => parseColor(tok[n]);
const on = (fg, ...base) => base.reduce((acc, b) => over(parseColor(tok[b]), acc), solid(fg));

// [what, foreground colour, background colour, need, exemption reason or null]
const bg = solid("bg");
const surface = solid("surface");
const sel = over(parseColor(tok["accent-subtle"]), solid("bg-elevated"));
const selSurface = over(parseColor(tok["accent-subtle"]), solid("surface"));
const PAIRS = [
  ["Body text on page", solid("text"), bg, 4.5, null],
  ["Body text on surface", solid("text"), surface, 4.5, null],
  ["Body text on elevated", solid("text"), solid("bg-elevated"), 4.5, null],
  ["Body text on surface hover", solid("text"), solid("surface-hover"), 4.5, null],
  ["Muted text on page", solid("text-muted"), bg, 4.5, null],
  ["Muted text on surface", solid("text-muted"), surface, 4.5, null],
  ["Muted text on elevated", solid("text-muted"), solid("bg-elevated"), 4.5, null],
  ["Muted text on surface hover", solid("text-muted"), solid("surface-hover"), 4.5, null],
  ["Accent text on page", solid("accent"), bg, 4.5, null],
  ["Accent text on surface", solid("accent"), surface, 4.5, null],
  ["Accent text on selected highlight (elevated)", solid("accent"), sel, 4.5, null],
  ["Accent text on selected tint (surface)", solid("accent"), selSurface, 4.5, null],
  ["Text on selected highlight", solid("text"), sel, 4.5, null],
  ["Primary button label (ink on accent)", solid("accent-ink"), solid("accent"), 4.5, null],
  ["Primary button label on hover", solid("accent-ink"), solid("accent-hover"), 4.5, null],
  ["Danger text on page", solid("danger"), bg, 4.5, null],
  ["Danger text on surface", solid("danger"), surface, 4.5, null],
  ["Warning text on page", solid("warning"), bg, 4.5, null],
  ["Warning text on surface", solid("warning"), surface, 4.5, null],
  ["Focus ring (accent) on page", solid("accent"), bg, 3, null],
  ["Focus ring (accent) on surface", solid("accent"), surface, 3, null],
  ["Control boundary (text-subtle) on elevated", solid("text-subtle"), solid("bg-elevated"), 3, null],
  ["Control boundary (text-subtle) on surface", solid("text-subtle"), surface, 3, null],
  ["Switch thumb on (accent) on track", solid("accent"), sel, 3, null],
  ["Subtle text on page", solid("text-subtle"), bg, 4.5, "text-subtle is never used for text that carries information; it is used for control boundaries only"],
  ["Border on page (decoration)", solid("border"), bg, 3, "decorative separators: content never depends on them (WCAG 1.4.11 applies to component boundaries)"],
  ["Strong border on page (decoration)", solid("border-strong"), bg, 3, "decorative container and button outlines: buttons are identified by their text, inputs use text-subtle boundaries"],
];

const rows = [];
let bad = 0;
for (const [what, fg, back, need, why] of PAIRS) {
  const r = ratio(fg, back);
  const pass = r >= need;
  const status = pass ? "PASS" : why ? "EXEMPT" : "FAIL";
  if (status === "FAIL") bad += 1;
  rows.push(`| ${what} | ${r.toFixed(2)} | ${need} | ${status}${!pass && why ? `: ${why}` : ""} |`);
}
// EXEMPT rows are failures that are recorded with a reason, not hidden.
console.log(["| Pair | Ratio | Needed | Status |", "|---|---|---|---|", ...rows].join("\n"));
if (bad) {
  console.error(`check-contrast: FAILED (${bad})`);
  process.exit(1);
}
console.log(`check-contrast: ok (${PAIRS.length} pairs)`);
