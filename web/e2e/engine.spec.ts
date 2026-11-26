// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// The real worker in Chromium under the production CSP. Prints timings.
import { expect, test } from "@playwright/test";

type Api = Record<string, () => Promise<unknown>>;
const run = <T>(page: import("@playwright/test").Page, name: string): Promise<T> =>
  page.evaluate((n) => (window as unknown as { __ENGINE__: Api }).__ENGINE__[n]?.(), name) as Promise<T>;

test.beforeEach(async ({ page }) => {
  await page.route("https://**", (r) => r.abort());
  await page.goto("http://localhost:4175/engine-e2e.html");
  await page.waitForSelector("body[data-ready='1']");
});

test("worker loads wasm under CSP and serves the API", async ({ page }) => {
  const r = await run<{ engine: string; loadMs: number; slices: string[]; roundTrip: boolean; violations: string[] }>(page, "basic");
  console.log("basic", JSON.stringify(r));
  expect(r.engine).toBe("privora-core");
  expect(r.slices).toEqual(["3174051509900001", "081234567890"]);
  expect(r.roundTrip).toBe(true);
  expect(r.violations).toEqual([]);
});

test("scan timings for 1 MB and 10 MB through the worker", async ({ page }) => {
  const r = await run<{ density: string; chars: number; ms: number; findings: number; progressSteps: number }[]>(page, "timings");
  console.log("timings", JSON.stringify(r));
  for (const t of r) {
    expect(t.findings).toBeGreaterThan(0);
    expect(t.progressSteps).toBeGreaterThan(0);
  }
});

test("cancel terminates a running scan and the engine recovers", async ({ page }) => {
  const r = await run<{ cancelled: string; cancelMs: number; after: string }>(page, "cancel");
  console.log("cancel", JSON.stringify(r));
  expect(r.cancelled).toBe("CANCELLED");
  expect(r.after).toBe("privora-core");
  expect(r.cancelMs).toBeLessThan(500);
});

test("a worker that cannot load is reported as LOAD_FAILED", async ({ page }) => {
  expect((await run<{ code: string }>(page, "loadFailure")).code).toBe("LOAD_FAILED");
});

test("the main thread keeps running during a 10 MB scan", async ({ page }) => {
  const r = await run<{ ms: number; ticks: number; maxGap: number }>(page, "uiStaysResponsive");
  console.log("responsive", JSON.stringify(r));
  expect(r.ticks).toBeGreaterThan(5);
  expect(r.maxGap).toBeLessThan(250);
});
