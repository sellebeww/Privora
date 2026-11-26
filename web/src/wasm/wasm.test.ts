// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Pipeline proof: the wasm built by `make wasm` loads in Node and offsets are UTF-16.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { engine_name, initSync, utf16_len } from "./pkg/privora.js";

initSync({ module: readFileSync(new URL("./pkg/privora_bg.wasm", import.meta.url)) });

describe("privora wasm", () => {
  it("crosses the boundary", () => {
    expect(engine_name()).toBe("privora-core");
  });

  it("counts UTF-16 units like a JS string, including emoji and a lone surrogate", () => {
    for (const s of ["", "abc", "é", "😀", "a\uD800b😀"]) {
      expect(utf16_len(s)).toBe(s.length);
    }
  });
});
