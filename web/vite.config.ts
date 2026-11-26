// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "./csp.ts";
import { offlinePlugin } from "./offline-build.ts";
import { cspPlugin } from "./vite-plugin-csp.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), cspPlugin({ blob: false }), offlinePlugin()],
  // `vite preview` sends the same headers as the _headers file, so browser tests run under them (workers too).
  preview: { headers: securityHeaders({ blob: false }) },
  resolve: {
    alias: { "@geist": fileURLToPath(new URL("./node_modules/geist/dist/fonts", import.meta.url)) },
  },
  build: {
    target: "es2022",
    // No data: URLs for assets: connect-src would have to allow them for fetch().
    assetsInlineLimit: 0,
    sourcemap: false,
    // Vite's modulepreload polyfill calls fetch(); native modulepreload covers all target browsers.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        verify: fileURLToPath(new URL("./verify.html", import.meta.url)),
      },
    },
  },
  worker: { format: "es" },
  // CPU heavy tests (600,000 round key derivation, pixel codecs, child processes) took over the 5 s
  // default when all test files ran at once on a busy 8 core machine (D-56). Assertions are unchanged.
  test: { include: ["src/**/*.test.{ts,tsx}"], testTimeout: 30_000 },
});
