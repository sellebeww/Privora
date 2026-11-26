// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Files under `dist` (binary ones included) that contain a directory of this machine. */
export function findMachinePaths(dist, extra = []) {
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  // "/" or "/root" alone would match ordinary text; very short directories are covered by the patterns below.
  const dirs = [repo, homedir(), process.env["CARGO_HOME"], ...extra].filter((d) => d && d.length > 6);
  const needles = new Set([...dirs, ...dirs.filter((d) => existsSync(d)).map((d) => realpathSync(d))]);
  // Typical home and cargo layouts, in case the build ran as someone else.
  const patterns = [/\/Users\/[\w.-]+\//, /\/home\/(?!web_user\/)[\w.-]+\//, /[\\/]\.cargo[\\/]registry/];
  const found = [];
  for (const e of readdirSync(dist, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const file = join(e.parentPath, e.name);
    const text = readFileSync(file).toString("latin1");
    for (const n of needles) if (text.includes(n)) found.push(`${relative(dist, file)}: contains ${n}`);
    for (const p of patterns) {
      const m = p.exec(text);
      if (m) found.push(`${relative(dist, file)}: contains ${m[0]}`);
    }
  }
  return found;
}
