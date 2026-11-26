// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Prints the SHA-256 of every file of a build, then the manifest hash that verify.html shows.
// Usage: node scripts/hash-dist.mjs [dir]   (default web/dist)
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const dir = process.argv[2] ?? "web/dist";
const files = readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join("/"))
  .sort();
const hash = (p) => createHash("sha256").update(readFileSync(join(dir, p))).digest("hex");
for (const f of files) console.log(`${hash(f)}  ${f}`);
console.log(`${files.length} files. Manifest SHA-256 (hashes.json): ${files.includes("hashes.json") ? hash("hashes.json") : "missing"}`);
