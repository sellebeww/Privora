// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// scripts/check-paths.mjs and check-dist rely on this: it must find a build machine's paths, also in binaries.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findMachinePaths } from "../../../scripts/lib/machine-paths.mjs";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
function dist(content: string) {
  const d = mkdtempSync(join(tmpdir(), "privora-paths-"));
  dirs.push(d);
  writeFileSync(join(d, "a.wasm"), Buffer.concat([Buffer.from([0, 97, 115, 109]), Buffer.from(content, "latin1")]));
  return d;
}

describe("findMachinePaths", () => {
  it.each([
    ["this home directory", `${homedir()}/src/lib.rs`],
    ["another macOS home", "/Users/someone/x.rs"],
    ["a Linux home", "/home/runner/work/x.rs"],
    ["a cargo registry", "/root/.cargo/registry/src/x.rs"],
  ])("finds %s", (_n, text) => expect(findMachinePaths(dist(text))).not.toEqual([]));
  it("finds an extra directory given by the caller", () => {
    const area = mkdtempSync(join(tmpdir(), "privora-area-"));
    dirs.push(area);
    const d = dist(`${area}/src/lib.rs`);
    expect(findMachinePaths(d, [area])).not.toEqual([]);
  });
  it("accepts remapped paths", () => {
    expect(findMachinePaths(dist("/cargo/registry/src/x.rs /privora/crates/y.rs /rustc/abc/library/z.rs"))).toEqual([]);
  });
});
