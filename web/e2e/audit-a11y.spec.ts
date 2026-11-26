// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Axe-core (WCAG 2.2 A and AA, plus best practices) on every screen and
// state of the production build, and the whole text flow by keyboard alone. axe runs through the
// debugging protocol, so the page keeps its CSP. All values are invented (SINTETIS).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { DOC, scanText } from "./helpers";
import { fixtureBytes } from "./pdfFixture";

const BASE = "http://localhost:4177";
const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

// The markup is the same in every browser; injecting axe crashed Playwright's Firefox tab, so it runs in Chromium.
const chromiumOnly = () => test.skip((process.env["PRIVORA_BROWSER"] ?? "chromium") !== "chromium", "axe runs in Chromium");

async function violations(page: Page, where: string) {
  await page.waitForTimeout(200); // let the 140 ms transitions finish, or contrast is read mid fade
  await page.evaluate(AXE);
  // PDF boxes are drawn where the text is, so on tight lines their 32 px hit areas overlap. WCAG 2.5.8
  // allows that when the same action has a conforming control on the page: the findings checkboxes.
  const found = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(d: Document, o: object): Promise<{ violations: { id: string; nodes: { target: string[]; failureSummary?: string }[] }[] }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
    const pdfBox = (n: { target: string[] }) => document.querySelector(n.target.join(" "))?.matches('button[title="Hapus kotak ini"]') === true;
    return r.violations
      .map((v) => (v.id === "target-size" ? { ...v, nodes: v.nodes.filter((n) => !pdfBox(n)) } : v))
      .filter((v) => v.nodes.length > 0)
      .map((v) => `${v.id}: ${v.nodes.slice(0, 4).map((n) => `${n.target.join(" ")} [${n.failureSummary?.replace(/\s+/g, " ").slice(0, 160)}]`).join(" | ")}`);
  });
  return found.map((f) => `${where}: ${f}`);
}

for (const [label, viewport] of [["wide", { width: 1280, height: 900 }], ["narrow", { width: 375, height: 800 }]] as const) {
  test(`axe, ${label}: every screen of the text flow`, async ({ page }) => {
    chromiumOnly();
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    const all: string[] = [];
    await page.goto(`${BASE}/`);
    await expect(page.getByText("Memuat mesin deteksi")).toHaveCount(0, { timeout: 15_000 });
    all.push(...(await violations(page, "home")));
    await page.getByRole("button", { name: "Pindai" }).click();
    all.push(...(await violations(page, "home, empty error")));
    await scanText(page, DOC, "Tokenisasi untuk LLM");
    all.push(...(await violations(page, "review")));
    if (label === "narrow") {
      for (const tab of ["Temuan", "Langkah"]) {
        await page.getByRole("tab", { name: tab }).click();
        all.push(...(await violations(page, `review tab ${tab}`)));
      }
      await page.getByRole("tab", { name: "Temuan" }).click();
    }
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog")).toBeVisible();
    all.push(...(await violations(page, "shortcut dialog")));
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Lihat hasil" }).click();
    await expect(page.getByRole("button", { name: "Salin", exact: true })).toBeVisible();
    all.push(...(await violations(page, "result tokenised")));
    await page.getByRole("button", { name: "Simpan peta terenkripsi" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Enkripsi dan unduh" }).click();
    all.push(...(await violations(page, "map dialog with error")));
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Pulihkan" }).first().click();
    all.push(...(await violations(page, "restore")));
    await page.getByRole("textbox", { name: /Balasan atau teks bertoken/ }).fill("[[NIK_1]] dan [[BUKAN_2]]");
    await page.getByRole("button", { name: "Pulihkan", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Hasil pemulihan" })).toBeVisible();
    all.push(...(await violations(page, "restore result")));
    await page.getByRole("button", { name: "Bersihkan sesi" }).click();
    await expect(page.getByText(/Sesi dibersihkan/)).toBeVisible();
    all.push(...(await violations(page, "cleared")));
    await page.goto(`${BASE}/#/ruang-kerja`);
    all.push(...(await violations(page, "workspace empty")));
    await page.goto(`${BASE}/#/bantuan`);
    all.push(...(await violations(page, "help")));
    await page.goto(`${BASE}/verify.html`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Jalankan uji blokir" }).click();
    await expect(page.getByText(/Diblokir oleh CSP/)).toBeVisible();
    await page.getByRole("button", { name: /Hitung ulang hash/ }).click();
    await expect(page.getByText(/cocok dengan manifes/)).toBeVisible({ timeout: 60_000 });
    all.push(...(await violations(page, "verify")));
    expect(all).toEqual([]);
  });

  test(`axe, ${label}: PDF review, final preview, errors`, async ({ page }) => {
    chromiumOnly();
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    const all: string[] = [];
    await page.goto(`${BASE}/`);
    await page.locator('input[type="file"]').setInputFiles({ name: "rusak.pdf", mimeType: "application/pdf", buffer: Buffer.from("bukan pdf") });
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 30_000 });
    all.push(...(await violations(page, "pdf error")));
    await page.locator('input[type="file"]').setInputFiles({ name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from(fixtureBytes()) });
    await expect(page).toHaveURL(/#\/pdf$/, { timeout: 60_000 });
    await expect(page.getByRole("img", { name: /^Pratinjau halaman 1 / })).toBeVisible();
    all.push(...(await violations(page, "pdf review")));
    if (label === "narrow") await page.getByRole("tab", { name: "Temuan" }).click();
    all.push(...(await violations(page, "pdf findings")));
    await page.getByRole("button", { name: "Ke pratinjau akhir" }).click();
    await expect(page.getByRole("heading", { name: "Pratinjau akhir" })).toBeVisible();
    all.push(...(await violations(page, "pdf final")));
    expect(all).toEqual([]);
  });
}

/** Press Tab until the element with this accessible name has focus. */
async function tabTo(page: Page, name: RegExp, limit = 80) {
  for (let i = 0; i < limit; i += 1) {
    const label = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      if (!e) return "";
      const byLabel = (e as HTMLInputElement).labels?.[0]?.textContent;
      return e.getAttribute("aria-label") || byLabel || e.textContent || "";
    });
    if (name.test(label.trim())) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${name}`);
}

test("the whole text flow works with the keyboard alone, with a visible focus ring", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/`);
  await expect(page.getByText("Memuat mesin deteksi")).toHaveCount(0, { timeout: 15_000 });
  await tabTo(page, /^Tempel teks atau lepas berkas/);
  await page.keyboard.type("NIK: 3171011505900001\nTelp: 0813-5550-0177");
  await tabTo(page, /^Samarkan/);
  await page.keyboard.press("ArrowRight"); // to tokenisation
  await tabTo(page, /^Pindai$/);
  const outline = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement!);
    return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineOffset}`;
  });
  expect(outline).toBe("solid 2px 2px");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "2 temuan" })).toBeVisible();
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("Space"); // second finding off
  await expect(page.getByText("1 dari 2 dipilih")).toBeVisible();
  await page.keyboard.press("a"); // all on again
  await expect(page.getByText("2 dari 2 dipilih")).toBeVisible();
  await tabTo(page, /^Lihat hasil$/);
  await page.keyboard.press("Enter");
  await tabTo(page, /^Simpan peta terenkripsi$/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await tabTo(page, /^Frasa sandi$|^Frasa sandi/);
  await page.keyboard.type("frasa uji yang panjang");
  await page.keyboard.press("Tab");
  await page.keyboard.type("frasa uji yang panjang");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
  expect(dl.suggestedFilename()).toBe("dokumen-peta.json");
  await tabTo(page, /^Bersihkan sesi$/);
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Sesi dibersihkan/)).toBeVisible();
});
