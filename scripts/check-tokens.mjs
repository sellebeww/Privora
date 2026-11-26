// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Fails when styles or components use a colour, radius, shadow, spacing or arbitrary value that is not a token.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { scanSource, scanSvg } from "./lib/token-scan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "web");
const SKIP_DIR = new Set(["node_modules", "pkg", "fixtures"]);

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP_DIR.has(name)) continue;
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const failures = [];
let scanned = 0;
const tokensCss = readFileSync(join(web, "src/styles/tokens.css"), "utf8");
const tokenHexes = new Set([...tokensCss.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase()));

// Browser test harnesses (e2e, engine) are not UI. Only the UI sources are checked.
const targets = [join(web, "src/app"), join(web, "src/ui"), join(web, "src/dev"), join(web, "src/styles"), join(web, "index.html"), join(web, "verify.html"), join(web, "src/index.css"), join(web, "src/main.tsx"), join(web, "src/verify.tsx")];
for (const t of targets) {
  const files = existsSync(t) && statSync(t).isDirectory() ? [...walk(t)] : existsSync(t) ? [t] : [];
  for (const f of files) {
    if (!/\.(css|tsx?|html)$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
    scanned += 1;
    const rel = relative(root, f);
    for (const v of scanSource(readFileSync(f, "utf8"), rel)) failures.push(`${rel}:${v.line}: ${v.rule}: ${v.text}`);
  }
}
for (const f of walk(join(web, "public"))) {
  if (!f.endsWith(".svg")) continue;
  scanned += 1;
  for (const v of scanSvg(readFileSync(f, "utf8"), tokenHexes)) failures.push(`${relative(root, f)}: ${v.rule}: ${v.text}`);
}

if (failures.length) {
  console.error(`check-tokens: FAILED (${failures.length})`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`check-tokens: ok (${scanned} files, ${tokenHexes.size} token colours)`);
