// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// A build must not carry paths of the machine that made it.
// Usage: node scripts/check-paths.mjs <dist> [more forbidden directories...]
import { findMachinePaths } from "./lib/machine-paths.mjs";

const [dist = "web/dist", ...extra] = process.argv.slice(2);
const found = findMachinePaths(dist, extra);
if (found.length) {
  console.error(`check-paths: FAILED (${found.length})`);
  for (const f of found) console.error("  " + f);
  process.exit(1);
}
console.log(`check-paths: ok (no machine path in ${dist})`);
