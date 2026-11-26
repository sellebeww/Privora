// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Writes web/public/licenses.txt: the licence texts of everything that ships in the build (pdf.js keeps
// its own files under pdfjs/). Run after a dependency change and commit the result: node scripts/gen-licenses.mjs
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "web");

/** "A OR B" is taken under MIT; "A AND B" needs every text. */
function licenceText(dir, name, licence) {
  const files = readdirSync(dir).filter((f) => /^(licen[cs]e|ofl|copying)/i.test(f)).sort();
  const pick = files.filter((f) => /mit/i.test(f));
  const use = pick.length && !licence.includes(" AND ") ? pick : files;
  if (!use.length) throw new Error(`no licence file for ${name}`);
  return use.map((f) => readFileSync(join(dir, f), "utf8").trim()).join("\n\n");
}

function npmDir(name, from = web) {
  const require = createRequire(join(from, "package.json"));
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    return realpathSync(join(from, "node_modules", name));
  }
}

const parts = [];
const add = (name, version, licence, dir) => parts.push(`${name} ${version} (${licence})\n\n${licenceText(dir, name, licence)}`);

const reactDom = npmDir("react-dom");
for (const [name, dir] of [
  ["react", npmDir("react")],
  ["react-dom", reactDom],
  ["scheduler", join(dirname(realpathSync(reactDom)), "scheduler")],
  ["tailwindcss", npmDir("tailwindcss")],
  ["geist", realpathSync(join(web, "node_modules", "geist"))],
]) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  add(name, pkg.version, name === "geist" ? "SIL Open Font License 1.1, fonts" : pkg.license, dir);
}

const meta = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--locked"], { cwd: root, maxBuffer: 1 << 28, encoding: "utf8" }));
const tree = execFileSync("cargo", ["tree", "--locked", "-p", "privora-wasm", "--target", "wasm32-unknown-unknown", "-e", "normal,no-proc-macro", "--prefix", "none", "--format", "{p}"], { cwd: root, encoding: "utf8" });
const shipped = [...new Set(tree.split("\n").filter(Boolean).map((l) => l.split(" ").slice(0, 2).join(" ")))].sort();
for (const line of shipped) {
  const [name, v] = line.split(" ");
  if (name.startsWith("privora-")) continue;
  const p = meta.packages.find((x) => x.name === name && `v${x.version}` === v);
  add(name, p.version, p.license, dirname(p.manifest_path));
}

const head = `Third-party licences of the software and fonts in this Privora build.
Privora itself is MIT, Copyright (c) 2026 Vassel Goleyu. pdf.js (Apache-2.0) and its assets keep their
licence files under pdfjs/. The Rust standard library (MIT OR Apache-2.0) is compiled into the wasm module.`;
writeFileSync(join(web, "public", "licenses.txt"), `${[head, ...parts].join(`\n\n${"=".repeat(80)}\n\n`)}\n`);
console.log(`web/public/licenses.txt: ${parts.length} entries`);
