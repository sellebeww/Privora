// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// After the build: fill the service worker with the precache list and write the SHA-256 manifest that
// verify.html recomputes. Output depends only on file names and bytes, never on time or paths.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export const MANIFEST = "hashes.json";
export const SW = "sw.js";
/** Read by the host, not served: kept in the manifest, left out of the precache. */
const NOT_SERVED = new Set(["_headers"]);

export interface ManifestFile {
  path: string;
  sha256: string;
  bytes: number;
  served: boolean;
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

function list(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? list(join(dir, e.name), base) : [relative(base, join(dir, e.name)).split(sep).join("/")],
  );
}

function describeFile(dir: string, path: string): ManifestFile {
  const data = readFileSync(join(dir, path));
  return { path, sha256: sha256(data), bytes: data.length, served: !NOT_SERVED.has(path) };
}

export function writeOfflineFiles(dir: string, template: string): void {
  // Default sort is by UTF-16 code unit: the same on every machine, unlike localeCompare.
  const files = list(dir).filter((p) => p !== MANIFEST && p !== SW).sort().map((p) => describeFile(dir, p));
  // The worker script is precached too, so verify.html can hash it offline (update checks bypass the worker).
  const precache = [...files.filter((f) => f.served).map((f) => f.path), MANIFEST, SW];
  const version = sha256(template + JSON.stringify(files)).slice(0, 16);
  const filled = template.replace('"__PRIVORA_VERSION__"', JSON.stringify(version)).replace('["__PRIVORA_PRECACHE__"]', JSON.stringify(precache));
  if (filled.includes("__PRIVORA_") || filled === template) throw new Error("service worker placeholders not filled");
  writeFileSync(join(dir, SW), filled);
  const all = [...files, describeFile(dir, SW)].sort((a, b) => (a.path < b.path ? -1 : 1));
  writeFileSync(join(dir, MANIFEST), `${JSON.stringify({ algorithm: "SHA-256", files: all }, null, 1)}\n`);
}

export function offlinePlugin(): Plugin {
  let outDir = "";
  let failed = false;
  return {
    name: "privora-offline",
    apply: "build",
    configResolved: (c) => void (outDir = resolve(c.root, c.build.outDir)),
    buildEnd: (error) => void (failed = error !== undefined),
    closeBundle: {
      order: "post",
      sequential: true,
      handler() {
        if (!failed) writeOfflineFiles(outDir, readFileSync(fileURLToPath(new URL("./src/offline/sw.js", import.meta.url)), "utf8"));
      },
    },
  };
}
