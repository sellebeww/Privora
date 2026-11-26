// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Shared by the browser specs. Every value here is invented (SINTETIS).
import { expect, type BrowserContext, type Page } from "@playwright/test";

export const NIK = "3171011505900001";
export const DOC = [
  "SURAT KETERANGAN (SINTETIS)",
  "Nama : Budi Contoh Santoso",
  `NIK : ${NIK}`,
  "Telp : 0812-5550-0101",
  "Email : budi.contoh@example.test",
  "Alamat : Jl. Contoh No. 5, RT 01 RW 02",
  "Catatan: Budi Contoh Santoso hadir. \u{1F600} Hubungi budi.contoh@example.test lagi.",
].join("\n");

/**
 * Let the test read what the app copies. Chromium grants the real clipboard; Firefox and WebKit cannot
 * grant it to a test, so there the page gets an in-memory stand in (the real permission is untested there).
 */
export async function allowClipboard(page: Page, context: BrowserContext) {
  if (context.browser()?.browserType().name() === "chromium") return context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    let last = "";
    Object.defineProperty(Navigator.prototype, "clipboard", {
      configurable: true,
      get: () => ({ writeText: async (t: string) => void (last = t), readText: async () => last }),
    });
  });
}

/** Choose a mode on the home page the way a pointer does it: on the visible card. */
export async function pickMode(page: Page, mode: "Samarkan" | "Tokenisasi untuk LLM") {
  await page.locator("label", { hasText: mode }).click();
  await expect(page.getByRole("radio", { name: new RegExp(`^${mode}`) })).toBeChecked();
}

/** Paste the text on the home page, scan, and wait for the review screen. The page must be on `/`. */
export async function scanText(page: Page, text = DOC, mode: "Samarkan" | "Tokenisasi untuk LLM" = "Samarkan") {
  await page.getByRole("textbox").fill(text);
  await pickMode(page, mode);
  await page.getByRole("button", { name: "Pindai" }).click();
  await expect(page).toHaveURL(/#\/ruang-kerja$/, { timeout: 30_000 });
  // Wide: the findings heading. Narrow: the Temuan tab (the heading sits in another tab).
  await expect(page.getByRole("heading", { name: /\d+ temuan/ }).or(page.getByRole("tab", { name: "Temuan" }))).toBeVisible();
}
