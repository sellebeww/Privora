// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Robustness in Chromium on the production build. A 50 MB text,
// pathological strings, binary files named as text, broken PDFs, and many sessions in one tab.
// All values are invented (SINTETIS). Measured numbers are printed, from one machine, one run.
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { makeAdversarialPdf } from "../src/pdf/adversarialPdf";
import { makeTestPdf } from "../src/pdf/testPdf";
import { NIK } from "./helpers";

const BASE = "http://localhost:4177";

function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("crash", () => errors.push("page crashed"));
  return errors;
}
const fileInput = (page: Page) => page.locator('input[type="file"]').first();
const scanButton = (page: Page) => page.getByRole("button", { name: "Pindai" });

async function scanToResult(page: Page, timeout: number) {
  await scanButton(page).click();
  await expect(page).toHaveURL(/#\/ruang-kerja$/, { timeout });
  await page.getByRole("button", { name: "Lihat hasil" }).click();
  await expect(page.getByRole("button", { name: "Unduh .txt" })).toBeVisible({ timeout });
}

test("a 50 MB text file: warned, scanned, redacted and downloaded without freezing the page", async ({ page }, info) => {
  test.setTimeout(300_000);
  const errors = watch(page);
  const filler = `${"teks pengisi tanpa data pribadi ".repeat(300)}\n`;
  const unit = `${filler}NIK: ${NIK}\nEmail: budi.contoh@example.test\n`;
  const text = unit.repeat(Math.ceil((50 * 1024 * 1024) / unit.length));
  const path = info.outputPath("lima-puluh-mb.txt");
  writeFileSync(path, text);
  await page.goto(`${BASE}/`);
  await fileInput(page).setInputFiles(path);
  await expect(page.getByText(/Berkas ini 50 MB/)).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => {
    const w = window as unknown as { __gap: number };
    let last = performance.now();
    w.__gap = 0;
    setInterval(() => {
      const n = performance.now();
      w.__gap = Math.max(w.__gap, n - last);
      last = n;
    }, 10);
  });
  const t0 = Date.now();
  await scanToResult(page, 120_000);
  const ms = Date.now() - t0;
  const gap = await page.evaluate(() => (window as unknown as { __gap: number }).__gap);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByRole("button", { name: "Unduh .txt" }).click()]);
  const out = readFileSync((await dl.path())!, "utf8");
  process.stderr.write(`\n[metric] 50 MB: scan to result ${ms} ms, longest main thread gap ${Math.round(gap)} ms\n`);
  expect(out.includes(NIK)).toBe(false);
  expect(out.includes("budi.contoh@")).toBe(false);
  expect(out.split("[NIK]").length - 1).toBe(text.split(NIK).length - 1);
  expect(gap).toBeLessThan(5000);
  expect(errors).toEqual([]);
});

const MB = 1024 * 1024;
const PATHOLOGICAL: [string, string][] = [
  ["one 4 MB line of digit groups", "1234 ".repeat(MB * 0.8)],
  ["phone prefix soup", "0812 3456 ".repeat(200_000)],
  ["token openers", "[[".repeat(MB)],
  ["labels without values", "Nama:".repeat(400_000)],
  ["at signs", "a@".repeat(MB)],
  ["one endless domain", `a@${"1.".repeat(MB)}`],
  ["astral characters", "😀".repeat(MB)],
  ["blank lines", `${"\n".repeat(2 * MB)}x`],
];
for (const [name, text] of PATHOLOGICAL) {
  test(`pathological text finishes and the page stays usable: ${name}`, async ({ page }, info) => {
    test.setTimeout(240_000);
    const errors = watch(page);
    const path = info.outputPath("p.txt");
    writeFileSync(path, text);
    await page.goto(`${BASE}/`);
    await fileInput(page).setInputFiles(path);
    await expect(page.getByRole("status").filter({ hasText: "karakter dibuka" }).first()).toBeVisible();
    const t0 = Date.now();
    await scanButton(page).click();
    await expect(page).toHaveURL(/#\/ruang-kerja$/, { timeout: 180_000 });
    await expect(page.getByRole("heading", { name: /\d+ temuan/ })).toBeVisible({ timeout: 60_000 });
    process.stderr.write(`\n[metric] ${name}: ${Date.now() - t0} ms\n`);
    await page.getByRole("link", { name: "Bantuan" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Bantuan" })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const noise = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 197 + 91) % 256));
const BINARY: [string, Buffer][] = [
  ["a PNG", png],
  ["a ZIP header", Buffer.from([0x50, 0x4b, 3, 4, 20, 0, 0, 0, 8, 0])],
  ["all zeros", Buffer.alloc(4096)],
  ["random bytes", noise],
];
for (const [name, body] of BINARY) {
  test(`a binary file named .txt is refused: ${name}`, async ({ page }) => {
    await page.goto(`${BASE}/`);
    await fileInput(page).setInputFiles({ name: "berkas.txt", mimeType: "text/plain", buffer: body });
    await expect(page.getByRole("alert")).toContainText("bukan teks UTF-8");
    await expect(page.getByRole("textbox")).toHaveValue("");
  });
}

const good = () => Buffer.from(makeTestPdf({ pages: [{ width: 300, height: 300, pieces: [{ text: `NIK: ${NIK}`, x: 20, y: 200 }] }] }));
const hostile = () => Buffer.from(makeAdversarialPdf(new Uint8Array(readFileSync("node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"))));
const BROKEN: [string, () => Buffer][] = [
  ["empty file", () => Buffer.alloc(0)],
  ["header only", () => Buffer.from("%PDF-1.7\n")],
  ["cut in half", () => hostile().subarray(0, 4000)],
  ["random bytes after the header", () => Buffer.concat([Buffer.from("%PDF-1.7\n"), noise])],
  ["no pages", () => Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF")],
  ["page tree that points at itself", () => Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [2 0 R] /Count 1 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF")],
];
for (const [name, body] of BROKEN) {
  test(`a broken PDF gets a message and the app keeps working: ${name}`, async ({ page }) => {
    const errors = watch(page);
    await page.goto(`${BASE}/`);
    await fileInput(page).setInputFiles({ name: "rusak.pdf", mimeType: "application/pdf", buffer: body() });
    await expect(page.getByRole("alert")).toContainText(/PDF/, { timeout: 30_000 });
    await expect(page).toHaveURL(`${BASE}/`);
    await fileInput(page).setInputFiles({ name: "baik.pdf", mimeType: "application/pdf", buffer: good() });
    await expect(page).toHaveURL(/#\/pdf$/, { timeout: 30_000 });
    expect(errors).toEqual([]);
  });
}

test("thirty documents in one tab: memory and workers do not keep growing", async ({ page, context }, info) => {
  test.setTimeout(420_000);
  const errors = watch(page);
  test.skip(context.browser()?.browserType().name() !== "chromium", "heap measurement needs the Chromium debugging protocol");
  const cdp = await context.newCDPSession(page);
  const heapMB = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    const { usedSize } = await cdp.send("Runtime.getHeapUsage");
    return usedSize / MB;
  };
  const record = `NIK: ${NIK}\nEmail: budi.contoh@example.test\n${"pengisi ".repeat(100)}\n`;
  const textPath = info.outputPath("satu-mb.txt");
  writeFileSync(textPath, record.repeat(1200));
  await page.goto(`${BASE}/`);
  const samples: number[] = [];
  const workers: number[] = [];
  for (let i = 1; i <= 30; i += 1) {
    await page.evaluate(() => (location.hash = "#/"));
    if (i % 3 === 0) {
      await fileInput(page).setInputFiles({ name: "a.pdf", mimeType: "application/pdf", buffer: hostile() });
      await expect(page).toHaveURL(/#\/pdf$/, { timeout: 60_000 });
      await expect(page.getByRole("img", { name: /^Pratinjau halaman 1 / })).toBeVisible();
    } else {
      await fileInput(page).setInputFiles(textPath);
      await scanToResult(page, 60_000);
    }
    if (i % 5 === 0) {
      samples.push(await heapMB());
      workers.push(page.workers().length);
    }
  }
  process.stderr.write(`\n[metric] heap MB after 5..30 documents: ${samples.map((s) => s.toFixed(1)).join(" ")}; workers ${workers.join(" ")}\n`);
  // Alternating text and PDF documents: the last samples may not sit far above the early ones.
  expect(Math.max(...samples.slice(-3))).toBeLessThan(Math.max(...samples.slice(0, 3)) * 1.3 + 10);
  expect(Math.max(...workers)).toBeLessThanOrEqual(3);
  expect(errors).toEqual([]);
});

test("a PDF over 50 MB is warned about, not blocked", async ({ page }, info) => {
  test.setTimeout(180_000);
  // A valid one page file followed by padding: the size is what is tested, not the content.
  const path = info.outputPath("besar.pdf");
  writeFileSync(path, Buffer.concat([good(), Buffer.alloc(51 * MB, 0x20), Buffer.from("\n%%EOF\n")]));
  await page.goto(`${BASE}/`);
  await fileInput(page).setInputFiles(path);
  await expect(page).toHaveURL(/#\/pdf$/, { timeout: 120_000 });
  await expect(page.getByText(/Berkas ini 51 MB/)).toBeVisible();
});

test("cancel while exporting, then export again", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/`);
  const many = makeTestPdf({ pages: Array.from({ length: 12 }, () => ({ width: 595, height: 842, pieces: [{ text: `NIK: ${NIK}`, x: 72, y: 700 }] })) });
  await fileInput(page).setInputFiles({ name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from(many) });
  await expect(page).toHaveURL(/#\/pdf$/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Ke pratinjau akhir" }).click();
  for (let i = 1; i <= 12; i += 1) {
    await page.getByRole("img", { name: new RegExp(`^Pratinjau halaman ${i} `) }).scrollIntoViewIfNeeded();
    await expect(page.getByText(`${i} dari 12 halaman sudah dilihat`)).toBeVisible({ timeout: 30_000 });
  }
  await page.getByRole("checkbox", { name: /Saya sudah memeriksa/ }).check();
  await page.getByLabel("Resolusi (DPI)").selectOption("300");
  let downloads = 0;
  page.on("download", () => (downloads += 1));
  await page.getByRole("button", { name: "Ekspor PDF" }).click();
  await page.getByRole("button", { name: "Batal" }).click();
  await expect(page.getByText(/Ekspor dibatalkan/)).toBeVisible();
  expect(downloads).toBe(0);
  await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByRole("button", { name: "Ekspor PDF" }).click()]);
});
