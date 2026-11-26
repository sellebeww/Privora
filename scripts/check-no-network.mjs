// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Static check for the "no upload" claim. Fails if app sources or the
// production build reference network APIs outside the recorded allowlist, or if dist/ contains
// absolute http(s) URLs outside the allowlist. Static analysis only: it cannot prove the absence
// of obfuscated calls, which is why CSP, offline mode and DevTools remain part of the story.
// Usage: node scripts/check-no-network.mjs [--root <repo>]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootArg = process.argv.indexOf("--root");
const root = rootArg > 0 ? resolve(process.argv[rootArg + 1] ?? ".") : join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = ["web/src", "web/index.html", "web/verify.html", "web/public", "web/dist"];

const FORBIDDEN = [
  ["XMLHttpRequest", /\bXMLHttpRequest\b/g],
  ["WebSocket", /\bWebSocket\b/g],
  ["EventSource", /\bEventSource\b/g],
  ["sendBeacon", /\bsendBeacon\b/g],
  ["RTCPeerConnection", /\bRTCPeerConnection\b/g],
  ["WebTransport", /\bWebTransport\b/g],
  ["fetch", /\bfetch\s*(?:\?\.)?\s*\(/g],
];

// CSP restricts what a page may request, not where it may go: a navigation can carry data in the URL.
// Checked in the app sources only (the vendored libraries in dist navigate nowhere Privora calls).
const NAVIGATION = [
  ["location assignment", /(?<![\w.])(?:(?:window|document|self|globalThis)\.)?location(?:\.href)?\s*=(?!=)/g],
  ["location.assign or replace", /\blocation\.(?:assign|replace)\s*\(/g],
  ["window.open", /\bwindow\.open\s*\(/g],
  ["new Image", /\bnew\s+Image\s*\(/g],
];

// pdf.js (lazy chunks) carries its own network layer (XMLHttpRequest, fetch) for loading a document from a URL,
// and uses fetch for its cMaps, standard fonts and image decoders. Privora opens documents from memory
// (`getDocument({data})`, web/src/pdf/loader.ts), so the URL path is dead code; the asset fetches are
// same-origin and connect-src 'self' enforces that. e2e (web/e2e/pdf.spec.ts) records every request while a
// PDF is opened, previewed and exported and fails on anything that is not same-origin. D-38.
const PDFJS_CHUNK = /^web\/dist\/assets\/(pdf|pdf\.worker\.min)-[\w-]+\.m?js$/;

// Every exception: one file, one API, the largest number of uses, and why. More uses than recorded fail.
const WASM_GLUE = "wasm-bindgen glue loads its own same-origin .wasm file";
const SW = "service worker: fetches the build's own files to precache them, and passes same-origin misses to the network";
const VERIFY = "verify.html: reads this build's own files to hash them, plus one external probe that CSP must block";
const API_ALLOW = [
  { file: /^web\/src\/wasm\/pkg\/privora\.js$/, api: "fetch", max: 1, reason: WASM_GLUE },
  { file: /^web\/dist\/assets\/worker-[\w-]+\.js$/, api: "fetch", max: 1, reason: WASM_GLUE },
  { file: /^web\/(src\/offline|dist)\/sw\.js$/, api: "fetch", max: 2, reason: SW },
  { file: /^web\/(src\/verify\/net\.ts|dist\/assets\/verify-[\w-]+\.js)$/, api: "fetch", max: 2, reason: VERIFY },
  { file: PDFJS_CHUNK, api: "fetch", max: Infinity, reason: "pdf.js, vendored (D-38)" },
  { file: PDFJS_CHUNK, api: "XMLHttpRequest", max: Infinity, reason: "pdf.js, vendored (D-38)" },
];

const URL_ALLOW = [
  { re: /^http:\/\/www\.apache\.org\/licenses\/LICENSE-2\.0$/, file: PDFJS_CHUNK, reason: "Apache-2.0 licence banner of pdf.js" },
  { re: /^https?:\/\/(www\.xfa\.org|ns\.adobe\.com)\//, file: PDFJS_CHUNK, reason: "XFA, XDP and XMP namespace identifiers inside pdf.js, not requests" },
  { re: /^https?:\/\/(example\.com|foo\.bar|\$\{e\})$/, file: PDFJS_CHUNK, reason: "base and placeholder strings pdf.js feeds to the URL parser, not requests" },
  { re: /^https:\/\/privora-probe\.invalid\/$/, file: /^web\/dist\/assets\/verify-[\w-]+\.js$/, reason: "the blocked-request test of verify.html; .invalid never resolves" },
  { re: /^https?:\/\//, file: /^web\/dist\/licenses\.txt$/, reason: "licence texts of bundled software, plain text that nothing loads" },
  { re: /^https?:\/\/www\.w3\.org\//, reason: "XML/SVG/MathML namespace identifiers used by React, not requests" },
  { re: /^https:\/\/tailwindcss\.com$/, reason: "licence banner comment in generated CSS" },
  { re: /^https?:\/\/react\.dev\/errors/, reason: "React error decoder text, not a request" },
  { re: /^https?:\/\/(www\.)?(scripts\.sil\.org|openfontlicense\.org)/, reason: "font licence text" },
];

function* walk(path) {
  if (!existsSync(path)) return;
  if (!statSync(path).isDirectory()) return yield path;
  for (const name of readdirSync(path)) if (name !== "node_modules") yield* walk(join(path, name));
}

const TEXT = /\.(m?[jt]sx?|html|css|json|webmanifest|svg|txt|map)$|_headers$/;
const failures = [];
let scanned = 0;

for (const base of SCAN) {
  for (const file of walk(join(root, base))) {
    if (!TEXT.test(file) || /\.test\.[jt]sx?$/.test(file)) continue;
    const rel = relative(root, file).split("\\").join("/");
    // web/public/pdfjs is a copy of vendored files; its shipped form is checked under web/dist.
    if (rel.startsWith("web/public/pdfjs/")) continue;
    const text = readFileSync(file, "utf8");
    scanned += 1;
    for (const [api, re] of FORBIDDEN) {
      const uses = text.match(re)?.length ?? 0;
      if (uses === 0) continue;
      const rule = API_ALLOW.find((a) => a.api === api && a.file.test(rel));
      if (!rule) failures.push(`${rel}: uses ${api}`);
      else if (uses > rule.max) failures.push(`${rel}: ${uses} uses of ${api}, the exception allows ${rule.max}`);
    }
    if (!rel.startsWith("web/dist/") && !rel.startsWith("web/src/wasm/pkg/")) {
      for (const [what, re] of NAVIGATION) if (text.match(re)) failures.push(`${rel}: ${what} can send data in a URL`);
    }
    if (rel.startsWith("web/dist/")) {
      for (const m of text.matchAll(/(?:https?|wss?):\/\/[^\s"'`)<>\\]+/g)) {
        if (!URL_ALLOW.some((a) => a.re.test(m[0]) && (!a.file || a.file.test(rel)))) failures.push(`${rel}: absolute URL ${m[0]}`);
      }
    }
  }
}

if (!existsSync(join(root, "web", "dist"))) failures.push("web/dist is missing: run `pnpm -C web build` first");

if (failures.length) {
  console.error(`check-no-network: FAILED (${failures.length})`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`check-no-network: ok (${scanned} files scanned, ${API_ALLOW.length} API exceptions, ${URL_ALLOW.length} URL patterns allowed)`);
