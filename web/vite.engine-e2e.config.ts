// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Test-only build: the real engine worker under the production CSP, driven by Playwright.
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { cspPlugin } from "./vite-plugin-csp.ts";

export default defineConfig({
  root: ".",
  publicDir: false,
  plugins: [cspPlugin({ blob: false })],
  build: {
    target: "es2022",
    outDir: "dist-engine-e2e",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    rollupOptions: { input: { engine: fileURLToPath(new URL("./engine-e2e.html", import.meta.url)) } },
  },
  worker: { format: "es" },
});
