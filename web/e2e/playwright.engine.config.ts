// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "engine.spec.ts",
  reporter: "list",
  timeout: 120_000,
  use: { browserName: "chromium" },
  webServer: {
    command: "pnpm exec vite preview --config vite.engine-e2e.config.ts --port 4175 --strictPort",
    port: 4175,
    cwd: "..",
    reuseExistingServer: false,
  },
});
