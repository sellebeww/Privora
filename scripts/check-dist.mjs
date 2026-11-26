// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Inspects web/dist: the dev-only component gallery must not be shipped, the entry pages and local fonts must be.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { findMachinePaths } from "./lib/machine-paths.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "web", "dist");
const failures = [];
if (!existsSync(dist)) {
  console.error("check-dist: web/dist is missing: run `pnpm -C web build` first");
  process.exit(1);
}
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(dist);
const rel = (f) => relative(root, f);

const REQUIRED = ["index.html", "verify.html", "favicon.svg", "_headers", "sw.js", "hashes.json", "manifest.webmanifest", "licenses.txt"];
for (const must of REQUIRED) {
  if (!existsSync(join(dist, must))) failures.push(`missing web/dist/${must}`);
}
if (!files.some((f) => /Geist-Variable.*\.woff2$/.test(f)) || !files.some((f) => /GeistMono-Variable.*\.woff2$/.test(f))) {
  failures.push("Geist fonts are not bundled in dist");
}
// Strings and paths that only the dev gallery contains.
const GALLERY = [/UiGallery/, /Galeri komponen/, /\/dev\/ui/, /data-testid="gallery"/];
for (const f of files) {
  if (/(^|\/)dev(\/|$)/.test(relative(dist, f))) failures.push(`${rel(f)}: dev path in dist`);
  if (!/\.(m?js|css|html|json|txt|map)$|_headers$/.test(f)) continue;
  if (/\.map$/.test(f)) failures.push(`${rel(f)}: source map in dist`);
  const text = readFileSync(f, "utf8");
  for (const re of GALLERY) if (re.test(text)) failures.push(`${rel(f)}: contains ${re}`);
  if (/<(?:link|script)[^>]+(?:href|src)=["']https?:/i.test(text)) failures.push(`${rel(f)}: external link or script tag`);
  if (/@import\s+url\(\s*["']?https?:|font-face[^}]*url\(\s*["']?https?:/i.test(text)) failures.push(`${rel(f)}: external font or import`);
}
if (REQUIRED.every((f) => existsSync(join(dist, f)))) {
  for (const page of ["index.html", "verify.html"]) {
    const html = readFileSync(join(dist, page), "utf8");
    if (!/<html lang="id"/.test(html)) failures.push(`${page} lacks lang="id"`);
    if (!/http-equiv="Content-Security-Policy"/.test(html)) failures.push(`${page} lacks the CSP meta`);
    if (!/rel="manifest"/.test(html)) failures.push(`${page} lacks the web app manifest link`);
    if (/<script(?![^>]*\ssrc=)[^>]*>|<style[\s>]|\sstyle=|\son[a-z]+=/i.test(html)) failures.push(`${page}: inline script, style or handler`);
  }
  const headers = readFileSync(join(dist, "_headers"), "utf8");
  for (const h of ["Content-Security-Policy", "X-Content-Type-Options: nosniff", "Referrer-Policy: no-referrer", "Permissions-Policy"]) {
    if (!headers.includes(h)) failures.push(`_headers lacks ${h}`);
  }

  // The manifest lists exactly the files of this build with their current hashes; the worker precaches all served ones.
  const names = files.map((f) => relative(dist, f).split("\\").join("/"));
  const manifest = JSON.parse(readFileSync(join(dist, "hashes.json"), "utf8")).files;
  const listed = new Set(manifest.map((f) => f.path));
  for (const n of names) if (n !== "hashes.json" && !listed.has(n)) failures.push(`${n}: not in hashes.json`);
  for (const f of manifest) {
    const p = join(dist, f.path);
    if (!existsSync(p) || createHash("sha256").update(readFileSync(p)).digest("hex") !== f.sha256) failures.push(`${f.path}: hash differs from hashes.json`);
  }
  const precache = JSON.parse(/const PRECACHE = (\[.*?\]);/.exec(readFileSync(join(dist, "sw.js"), "utf8"))?.[1] ?? "[]");
  const wanted = names.filter((n) => n !== "_headers");
  for (const n of wanted) if (!precache.includes(n)) failures.push(`${n}: not precached by sw.js`);
  for (const n of precache) if (!wanted.includes(n)) failures.push(`sw.js precaches ${n}, which is not a served file`);
}
failures.push(...findMachinePaths(dist));

// Size budgets, gzip level 9, 1 KB = 1000 bytes. pdf.js loads only for a PDF.
const gz = (f) => gzipSync(readFileSync(f), { level: 9 }).length;
const wasm = files.filter((f) => /privora_bg-[\w-]+\.wasm$/.test(f));
const entry = existsSync(join(dist, "index.html")) ? readFileSync(join(dist, "index.html"), "utf8") : "";
const initial = [...entry.matchAll(/<(?:script[^>]+src|link rel="modulepreload"[^>]+href)="\/?([^"]+\.js)"/g)].map((m) => join(dist, m[1]));
const sizes = { wasm: wasm.reduce((n, f) => n + gz(f), 0), js: initial.reduce((n, f) => n + (existsSync(f) ? gz(f) : 0), 0) };
if (wasm.length !== 1) failures.push(`expected one engine wasm, found ${wasm.length}`);
if (initial.length === 0) failures.push("no initial script found in index.html");
if (sizes.wasm > 400_000) failures.push(`engine wasm is ${sizes.wasm} bytes gzipped, the budget is 400000`);
if (sizes.js > 250_000) failures.push(`initial JavaScript is ${sizes.js} bytes gzipped, the budget is 250000`);

if (failures.length) {
  console.error(`check-dist: FAILED (${failures.length})`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`check-dist: ok (${files.length} files, no gallery, no external references, no machine paths, manifest and precache complete; gzip: wasm ${sizes.wasm}, initial JS ${sizes.js} bytes in ${initial.length} files)`);
