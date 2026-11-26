// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { defineConfig } from "@playwright/test";

// 4176: dev server (the /dev/ui gallery exists only here). 4177: preview of the production build (CSP applied).
export default defineConfig({
  testDir: ".",
  testMatch: ["ui.spec.ts", "pages.spec.ts", "flow.spec.ts", "pdf.spec.ts", "offline.spec.ts", "audit-*.spec.ts"],
  reporter: "list",
  timeout: 60_000,
  // PRIVORA_BROWSER=firefox or webkit runs the same suite there (Playwright builds, installed like Chromium).
  use: { browserName: (process.env["PRIVORA_BROWSER"] ?? "chromium") as "chromium" | "firefox" | "webkit" },
  webServer: [
    { command: "pnpm exec vite --port 4176 --strictPort", port: 4176, cwd: "..", reuseExistingServer: false },
    { command: "pnpm exec vite preview --port 4177 --strictPort", port: 4177, cwd: "..", reuseExistingServer: false },
  ],
});
