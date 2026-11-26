// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// The production build (CSP applied, preview server): pages, layout, states, no external requests, screenshots.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { audit } from "./audit";
import { NIK, scanText } from "./helpers";

const BASE = "http://localhost:4177";
const SHOTS = "test-results/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function open(page: Page, path: string, viewport = { width: 1280, height: 800 }) {
  const external: string[] = [];
  await page.setViewportSize(viewport);
  page.on("request", (r) => {
    if (!r.url().startsWith(BASE) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) external.push(r.url());
  });
  await page.addInitScript(() => {
    (window as unknown as { __v: string[] }).__v = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __v: string[] }).__v.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(BASE + path);
  await page.locator("main").waitFor();
  return {
    done: async () => {
      expect(external).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { __v: string[] }).__v)).toEqual([]);
    },
  };
}

test("home: content, 56px bar, status chip to verify.html, glow, fonts, no external request", async ({ page }) => {
  const o = await open(page, "/");
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(page).toHaveTitle("Privora");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Hitamkan NIK sebelum dokumenmu pergi ke mana-mana, tanpa mengunggah apa pun.")).toBeVisible();
  expect((await page.locator("header").boundingBox())?.height).toBe(56);
  const chip = page.getByRole("link", { name: /Lokal. Tidak ada unggahan/ });
  await expect(chip).toHaveAttribute("href", "verify.html");
  const bgImg = await page.locator(".landing-glow").evaluate((e) => getComputedStyle(e).backgroundImage);
  expect(bgImg).toContain("radial-gradient");
  expect(bgImg).toContain("0.06");
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check("14px Geist"))).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("14px");
  expect(await page.locator("link[rel=icon]").getAttribute("href")).toBe("/favicon.svg");
  expect((await page.request.get(BASE + "/favicon.svg")).ok()).toBe(true);
  expect(await audit(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/home.png`, fullPage: true });
  await o.done();
});

test("home: modes are a keyboard radio group, a chosen file is read locally", async ({ page }) => {
  await open(page, "/");
  const radios = page.getByRole("radio");
  await expect(radios).toHaveCount(3);
  await radios.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(radios.nth(1)).toBeChecked();
  await page.getByRole("button", { name: "Pilih berkas" }).focus();
  await page.setInputFiles("input[type=file]", { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("teks sintetis") });
  await expect(page.getByRole("status").filter({ hasText: "a.txt: 13 karakter dibuka." })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveValue("teks sintetis");
});

test("home to workspace to help by link and keyboard", async ({ page }) => {
  await open(page, "/");
  await scanText(page);
  await page.getByRole("link", { name: "Bantuan" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Bantuan" })).toBeVisible();
});

test("workspace without a document explains itself and links home", async ({ page }) => {
  const o = await open(page, "/#/ruang-kerja");
  await expect(page.getByText("Belum ada dokumen.")).toBeVisible();
  await page.getByRole("button", { name: "Ke beranda" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Samarkan data pribadi");
  await o.done();
});

test("workspace at 1280px: three columns 240 / flexible / 360", async ({ page }) => {
  const o = await open(page, "/");
  await scanText(page);
  const asides = page.locator("aside");
  await expect(asides).toHaveCount(2);
  expect((await asides.nth(0).boundingBox())?.width).toBe(240);
  expect((await asides.nth(1).boundingBox())?.width).toBe(360);
  const mid = await asides.nth(0).locator("xpath=following-sibling::div").boundingBox();
  expect(mid?.width).toBe(1280 - 240 - 360);
  expect(await audit(page)).toEqual([]);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check("13px 'Geist Mono'"))).toBe(true);
  await page.screenshot({ path: `${SHOTS}/workspace.png` });
  await o.done();
});

test("workspace: unselecting a finding changes its highlight, jump focuses the text", async ({ page }) => {
  await open(page, "/");
  await scanText(page);
  const mark = page.locator("mark", { hasText: NIK });
  expect(await mark.evaluate((e) => getComputedStyle(e).borderBottomStyle)).toBe("solid");
  await page.getByRole("checkbox", { name: NIK }).uncheck();
  expect(await mark.evaluate((e) => getComputedStyle(e).borderBottomStyle)).toBe("dashed");
  await page.getByRole("button", { name: "Lompat ke NIK di dokumen" }).click();
  await expect(mark).toBeFocused();
  await expect(page.getByText(/^\d+ dari \d+ dipilih$/)).toBeVisible();
});

test("workspace below 1024px turns into tabs (also at phone width, without sideways scroll)", async ({ page }) => {
  await open(page, "/", { width: 800, height: 900 });
  await scanText(page);
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(page.getByRole("tab", { name: "Dokumen" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Temuan" }).click();
  expect(await page.getByRole("tabpanel").getByRole("checkbox").count()).toBeGreaterThan(3);
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/workspace-375.png` });
  await page.getByRole("tab", { name: "Dokumen" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.goto(BASE + "/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("help page shows all five honest statements and passes the audit", async ({ page }) => {
  const o = await open(page, "/#/bantuan");
  const items = page.locator("#honest li");
  await expect(items).toHaveCount(5);
  await expect(items.nth(2)).toContainText("ekstensi browser, malware, atau riwayat clipboard");
  await expect(page.getByText("Nama tanpa label tidak terdeteksi")).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/help.png`, fullPage: true });
  await o.done();
});

test("verify.html: own policy, live probe blocked, resources, hashes recomputed", async ({ page }) => {
  const o = await open(page, "/verify.html");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Verifikasi");
  await expect(page.locator("#honest li")).toHaveCount(5);
  await expect(page.getByText("bukan bukti independen")).toBeVisible();

  const csp = page.locator("#csp pre");
  await expect(csp.nth(0)).toContainText("connect-src 'self'");
  await expect(csp.nth(0)).not.toContainText("wasm-unsafe-eval");
  await expect(csp.nth(1)).toContainText("wasm-unsafe-eval");
  await expect(csp.nth(2)).toContainText("frame-ancestors 'none'");
  await expect(page.locator("#csp")).toContainText("Server mengirim header CSP yang membatasi koneksi worker");

  await expect(page.locator("#resources")).toContainText("0 ke luar origin");
  expect(await audit(page)).toEqual([]);
  await o.done();

  await page.getByRole("button", { name: "Jalankan uji blokir" }).click();
  await expect(page.locator("#probe")).toContainText("Diblokir oleh CSP (aturan connect-src)");
  const violations = await page.evaluate(() => (window as unknown as { __v: string[] }).__v);
  expect(violations.length).toBeGreaterThan(0);
  for (const v of violations) expect(v).toMatch(/^connect-src https:\/\/privora-probe\.invalid/);

  await expect(page.locator("#hashes")).toContainText(createHash("sha256").update(readFileSync("dist/hashes.json")).digest("hex"));
  await page.getByRole("button", { name: /Hitung ulang hash/ }).click();
  await expect(page.locator("#hashes")).toContainText(/Semua \d+ berkas yang disajikan cocok/, { timeout: 30_000 });
  await expect(page.locator("#hashes")).toContainText("1 berkas dibaca host");
  // Whatever the list shows as another origin can only be the blocked probe.
  await page.getByRole("button", { name: "Perbarui daftar" }).click();
  for (const row of await page.locator("#resources tbody tr", { hasText: "Origin lain" }).all()) await expect(row).toContainText("privora-probe.invalid");
  await page.screenshot({ path: `${SHOTS}/verify.png` });
});

test("the dev gallery is not served by the production build", async ({ page }) => {
  await open(page, "/dev/ui");
  await expect(page.getByTestId("gallery")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); // the normal home renders instead
});

test("unsupported browser: clear message with a status per feature", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "WebAssembly", { value: undefined, configurable: true });
  });
  await open(page, "/");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Browser ini belum didukung");
  await expect(alert).toContainText("WebAssembly");
  await expect(alert).toContainText("Belum tersedia");
  await page.screenshot({ path: `${SHOTS}/unsupported.png` });
});

test("skip link is the first tab stop and moves focus to main", async ({ page }) => {
  await open(page, "/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Lompat ke konten" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});
