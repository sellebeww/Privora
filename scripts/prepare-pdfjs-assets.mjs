// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Copies the pdf.js runtime assets the app needs from the installed pdfjs-dist into web/public/pdfjs
// (D-9): cMaps, standard fonts and the image decoders with their licence files. The PDF JavaScript
// engine (quickjs-eval.*) is NOT copied: Privora never runs scripts from a document.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const require = createRequire(join(web, "package.json"));
const src = dirname(require.resolve("pdfjs-dist/package.json"));
const out = join(web, "public", "pdfjs");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, "cmaps"), join(out, "cmaps"), { recursive: true });
cpSync(join(src, "standard_fonts"), join(out, "standard_fonts"), { recursive: true });
cpSync(join(src, "wasm"), join(out, "wasm"), { recursive: true, filter: (p) => !/quickjs-eval\.(js|wasm)$/.test(p) });
cpSync(join(src, "LICENSE"), join(out, "LICENSE"));

const left = readdirSync(join(out, "wasm"));
if (left.some((f) => f.startsWith("quickjs-eval"))) throw new Error("quickjs-eval must not be shipped");
if (!existsSync(join(out, "cmaps", "Adobe-Japan1-UCS2.bcmap"))) throw new Error("cmaps missing");
console.log(`pdfjs assets ready in web/public/pdfjs (${readdirSync(join(out, "cmaps")).length} cmaps, ${readdirSync(join(out, "standard_fonts")).length} font files, wasm: ${left.filter((f) => f.endsWith(".wasm")).join(", ")})`);
