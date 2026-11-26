// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import type { Plugin } from "vite";
import { buildCsp, securityHeaders, type CspOptions } from "./csp.ts";

/** Injects the CSP <meta> into every HTML entry (verify.html gets its own, stricter one) and emits _headers. */
export function cspPlugin(opts: CspOptions): Plugin {
  return {
    name: "privora-csp",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler: (_html, ctx) => {
        const content = buildCsp({ ...opts, wasm: !ctx.filename.endsWith("verify.html") });
        return [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content }, injectTo: "head-prepend" }];
      },
    },
    generateBundle() {
      const lines = Object.entries(securityHeaders(opts)).map(([k, v]) => `  ${k}: ${v}\n`);
      this.emitFile({ type: "asset", fileName: "_headers", source: `/*\n${lines.join("")}` });
    },
  };
}
