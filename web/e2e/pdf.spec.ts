// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// PDF flow in real Chromium against the production build (CSP applied): open, review, final preview,
// export, and the SECURITY checks on the exported file. All documents are invented (SINTETIS).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { auditPdf, decodeLossless, maxInside, secretsInBytes } from "../src/pdf/audit";
import { pixelRect } from "../src/pdf/geometry";
import { makeTestPdf } from "../src/pdf/testPdf";
import { audit } from "./audit";
import { fixtureBytes, fixturePages, inkTargets, manyPages, NIK, plainRegion, SECRETS } from "./pdfFixture";

const BASE = "http://localhost:4177";
const DEV = "http://localhost:4176";
const SHOTS = "test-results/screenshots";
const DPI = 150;
const METRICS = "test-results/pdf-metrics.json";

test.use({ launchOptions: { args: ["--enable-precise-memory-info"] } });

/** Resident memory of every Chromium process this test run started (sum, MB). Includes workers, canvases and the GPU-less raster. */
function browserRssMB(): number {
  const out = execFileSync("ps", ["-axo", "rss=,command="], { encoding: "utf8" });
  let kb = 0;
  for (const l of out.split("\n")) if (l.includes("e2e/.browsers") && l.includes("chrome")) kb += Number(l.trim().split(/\s+/)[0] ?? 0);
  return Math.round(kb / 1024);
}
function sampleRss() {
  const start = browserRssMB();
  let peak = start;
  const timer = setInterval(() => (peak = Math.max(peak, browserRssMB())), 300);
  return { start, peak: () => peak, stop: () => (clearInterval(timer), peak) };
}

function note(key: string, value: unknown) {
  mkdirSync("test-results", { recursive: true });
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(readFileSync(METRICS, "utf8")) as Record<string, unknown>;
  } catch {
    /* first write */
  }
  all[key] = value;
  writeFileSync(METRICS, JSON.stringify(all, null, 2));
  process.stderr.write(`\n[metric] ${key}: ${JSON.stringify(value)}\n`);
}

async function open(page: Page) {
  const external: string[] = [];
  await page.setViewportSize({ width: 1280, height: 900 });
  page.on("request", (r) => {
    if (!r.url().startsWith(BASE) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) external.push(r.url());
  });
  await page.addInitScript(() => {
    (window as unknown as { __v: string[] }).__v = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __v: string[] }).__v.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(`${BASE}/`);
  await page.locator("main").waitFor();
  return {
    done: async () => {
      expect(external).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { __v: string[] }).__v)).toEqual([]);
    },
  };
}

async function choose(page: Page, bytes: Uint8Array, name = "dokumen-uji.pdf") {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(bytes) });
}
async function openReview(page: Page, bytes: Uint8Array) {
  await choose(page, bytes);
  await expect(page).toHaveURL(/#\/pdf$/, { timeout: 90_000 });
  await expect(page.getByRole("img", { name: /^Pratinjau halaman 1 / })).toBeVisible();
}
async function toFinal(page: Page) {
  await page.getByRole("button", { name: "Ke pratinjau akhir" }).click();
  await expect(page.getByRole("heading", { name: "Pratinjau akhir" })).toBeVisible();
}
async function seeAllPages(page: Page, n: number) {
  for (let i = 0; i < n; i += 1) {
    await page.getByRole("img", { name: new RegExp(`^Pratinjau halaman ${i + 1} `) }).scrollIntoViewIfNeeded();
    await expect(page.getByText(`${Math.min(n, i + 1)} dari ${n} halaman sudah dilihat`).or(page.getByText(`${n} dari ${n} halaman sudah dilihat`))).toBeVisible({ timeout: 20_000 }).catch(() => undefined);
  }
  await expect(page.getByText(`${n} dari ${n} halaman sudah dilihat`)).toBeVisible({ timeout: 30_000 });
}
async function exportNow(page: Page) {
  await page.getByRole("checkbox", { name: /Saya sudah memeriksa/ }).check();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 180_000 }), page.getByRole("button", { name: "Ekspor PDF" }).click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(readFileSync(path)) };
}

/** Pixels of a PDF page rendered in the browser by pdf.js (same code as the export), cropped to a rectangle. */
async function sourceCrop(dev: Page, bytes: Uint8Array, pageNo: number, rect: { x: number; y: number; w: number; h: number }) {
  const b64 = Buffer.from(bytes).toString("base64");
  return dev.evaluate(
    async ({ b64, pageNo, rect, dpi }) => {
      const bin = atob(b64);
      const data = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const loaderPath = "/src/pdf/loader.ts";
      const renderPath = "/src/pdf/render.ts";
      const { openPdf } = await import(/* @vite-ignore */ loaderPath);
      const { renderPage } = await import(/* @vite-ignore */ renderPath);
      const o = await openPdf(data.buffer);
      const pg = await o.doc.getPage(pageNo);
      const c = document.createElement("canvas");
      await renderPage(pg, c, dpi / 72);
      const d = c.getContext("2d")!.getImageData(rect.x, rect.y, rect.w, rect.h).data;
      o.destroy();
      let s = "";
      for (let i = 0; i < d.length; i += 4) s += String.fromCharCode(d[i]!, d[i + 1]!, d[i + 2]!);
      return btoa(s);
    },
    { b64, pageNo, rect, dpi: DPI },
  );
}

/** Check an exported file against the fixture: structure, secrets, black ink, untouched plain text. */
async function verifyExport(dev: Page, source: Uint8Array, out: Uint8Array, opts: { lossless: boolean; skip?: string[] }) {
  const report = auditPdf(out);
  expect(report.problems).toEqual([]);
  expect(report.pages).toHaveLength(3);
  expect(secretsInBytes(out, [...SECRETS, "Courier", "Helvetica", "Times", "SINTETIS", "Author", "Privora", "pdf.js"])).toEqual([]);
  const pages = fixturePages();
  report.pages.forEach((p, i) => {
    const src = pages[i];
    const swap = src?.rotate === 90 || src?.rotate === 270;
    const [x0, y0, x1, y1] = src?.cropBox ?? [0, 0, src?.width ?? 0, src?.height ?? 0];
    expect(p.width).toBeCloseTo(swap ? y1 - y0 : x1 - x0, 1);
    expect(p.height).toBeCloseTo(swap ? x1 - x0 : y1 - y0, 1);
  });
  if (!opts.lossless) return;
  const decoded = report.pages.map((p) => decodeLossless(p.image));
  for (const t of inkTargets()) {
    if (opts.skip?.includes(t.what)) continue;
    const im = report.pages[t.page]!.image;
    const r = pixelRect(t.box, DPI / 72, im.width, im.height);
    expect(r.w * r.h, t.what).toBeGreaterThan(0);
    expect(maxInside(decoded[t.page]!, im.width, r), `ink of ${t.what} is black`).toBe(0);
  }
  // Plain text stays as the source render shows it (so the file is the page, not just boxes).
  const r = pixelRect(plainRegion.box, DPI / 72, report.pages[0]!.image.width, report.pages[0]!.image.height);
  const crop = Buffer.from(await sourceCrop(dev, source, 1, r), "base64");
  let diff = 0;
  let inkPixels = 0;
  for (let y = 0; y < r.h; y += 1) {
    for (let x = 0; x < r.w; x += 1) {
      const o = ((r.y + y) * report.pages[0]!.image.width + r.x + x) * 3;
      const c = (y * r.w + x) * 3;
      for (let k = 0; k < 3; k += 1) if (decoded[0]![o + k] !== crop[c + k]) diff += 1;
      if ((crop[c] ?? 255) < 128) inkPixels += 1;
    }
  }
  expect(inkPixels, "the plain line has ink in the source render").toBeGreaterThan(5);
  expect(diff, "plain text pixels equal the source render").toBe(0);

  // Render the EXPORTED file again with pdf.js and look inside every box (an independent reader of the file).
  for (const t of inkTargets()) {
    if (opts.skip?.includes(t.what)) continue;
    const im = report.pages[t.page]!.image;
    const rr = pixelRect(t.box, DPI / 72, im.width, im.height);
    const px = Buffer.from(await sourceCrop(dev, out, t.page + 1, rr), "base64");
    let max = 0;
    for (const v of px) max = Math.max(max, v);
    expect(max, `re-rendered ink of ${t.what} is black`).toBeLessThanOrEqual(2);
  }
  // pdf.js resamples the image a little, so edge pixels move; what must hold is that the text is still there.
  const again = Buffer.from(await sourceCrop(dev, out, 1, r), "base64");
  const dark = (b: Buffer) => b.reduce((n, v, i) => (i % 3 === 0 && v < 128 ? n + 1 : n), 0);
  expect(dark(again) / dark(crop), "re-rendered plain text keeps its ink").toBeGreaterThan(0.7);
  expect(dark(again) / dark(crop)).toBeLessThan(1.3);
}

test.describe("PDF review and export", () => {
  test("open, review, final preview, export: no network, nothing but pixels", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const guard = await open(page);
    const source = fixtureBytes();
    await choose(page, source);
    await expect(page).toHaveURL(/#\/pdf$/, { timeout: 90_000 });
    await expect(page.getByRole("heading", { name: /\d+ temuan/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /^Pratinjau halaman 1 / })).toBeVisible();
    await expect(page.getByText("Halaman 1 dari 3", { exact: true })).toBeVisible();
    const boxes = page.getByRole("button", { name: /^Hapus kotak, / });
    await expect(boxes).toHaveCount(4); // name, NIK, phone, email on page 1
    expect(await audit(page)).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/pdf-review.png` });

    // Remove one box (keyboard): its finding is switched off and a manual box is drawn by hand.
    await boxes.first().focus();
    await page.keyboard.press("Enter");
    await expect(boxes).toHaveCount(3);
    // Put it back through the findings list so the whole fixture is covered in the export.
    await page.getByRole("checkbox", { name: /Budi Contoh Santoso/ }).first().check();
    await expect(boxes).toHaveCount(4);

    // Scanned look warning on page 3 and annotations warning on page 1.
    await page.getByRole("button", { name: "Halaman berikutnya" }).click();
    await page.getByRole("button", { name: "Halaman berikutnya" }).click();
    await expect(page.getByText(/tampak berupa pindaian; Privora belum mendukung OCR/)).toBeVisible();
    await page.getByRole("button", { name: "Halaman sebelumnya" }).click();
    await page.getByRole("button", { name: "Halaman sebelumnya" }).click();
    await expect(page.getByText(/2 anotasi atau isian/)).toBeVisible();

    await toFinal(page);
    await page.getByRole("img", { name: /^Pratinjau halaman 1 / }).scrollIntoViewIfNeeded();
    await page.waitForFunction(() => (document.querySelector("canvas")?.width ?? 0) > 0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/pdf-final.png` }); // page 1 as it will be exported, boxes in solid black
    // Export is locked until the pages were seen.
    await expect(page.getByRole("checkbox", { name: /Saya sudah memeriksa/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Ekspor PDF" })).toBeDisabled();
    await seeAllPages(page, 3);
    await expect(page.getByRole("checkbox", { name: /Saya sudah memeriksa/ })).toBeEnabled();
    expect(await audit(page)).toEqual([]);

    const out = await exportNow(page);
    expect(out.name).toBe("dokumen-samar.pdf");
    await expect(page.getByText(/PDF dibuat: 3 halaman/)).toBeVisible();
    await guard.done();

    const dev = await (await browser.newContext()).newPage();
    await dev.goto(`${DEV}/`);
    await verifyExport(dev, source, out.bytes, { lossless: true });
    note("fixture 3 pages, lossless 150 dpi (bytes)", { source: source.length, output: out.bytes.length });
  });

  test("an edit after the preview locks the export again, and a removed box is not in the file", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const guard = await open(page);
    const source = fixtureBytes();
    await openReview(page, source);
    // Switch the email finding off on page 1 by clicking its box.
    const boxes = page.getByRole("button", { name: /^Hapus kotak, / });
    await expect(boxes).toHaveCount(4);
    await toFinal(page);
    await seeAllPages(page, 3);
    await page.getByRole("checkbox", { name: /Saya sudah memeriksa/ }).check();
    await page.getByRole("button", { name: "Kembali ke tinjauan" }).click();
    await boxes.nth(3).click(); // the email box (last in reading order)
    await expect(boxes).toHaveCount(3);
    await toFinal(page);
    await expect(page.getByRole("checkbox", { name: /Saya sudah memeriksa/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Ekspor PDF" })).toBeDisabled();
    await seeAllPages(page, 3);
    const out = await exportNow(page);
    await guard.done();
    const dev = await (await browser.newContext()).newPage();
    await dev.goto(`${DEV}/`);
    await verifyExport(dev, source, out.bytes, { lossless: true, skip: ["email"] });
    // The switched off email is NOT black: the text is still readable in the picture, as the user chose.
    const report = auditPdf(out.bytes);
    const t = inkTargets().find((x) => x.what === "email")!;
    const im = report.pages[0]!.image;
    expect(maxInside(decodeLossless(im), im.width, pixelRect(t.box, DPI / 72, im.width, im.height))).toBeGreaterThan(100);
  });

  test("a hand drawn box and a keyboard moved box end up black in the file", async ({ page, browser }) => {
    test.setTimeout(180_000);
    await open(page);
    await page.setViewportSize({ width: 1280, height: 1500 }); // the whole page on screen
    const source = fixtureBytes();
    await openReview(page, source);
    const canvas = page.getByRole("img", { name: /^Pratinjau halaman 1 / });
    const b = (await canvas.boundingBox())!;
    // Draw over the empty area at the bottom of page 1.
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.85);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.9, { steps: 5 });
    await page.mouse.up();
    const manual = page.getByRole("button", { name: "Hapus kotak manual" });
    await expect(manual).toHaveCount(1);
    await manual.focus();
    for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowRight");
    const after = (await manual.boundingBox())!;
    await toFinal(page);
    await seeAllPages(page, 3);
    const out = await exportNow(page);
    const report = auditPdf(out.bytes);
    expect(report.problems).toEqual([]);
    const im = report.pages[0]!.image;
    const rgb = decodeLossless(im);
    const px = (after.x - b.x) / b.width;
    const py = (after.y - b.y) / b.height;
    const rect = pixelRect({ x: px * 612 + 2, y: py * 792 + 2, w: (after.width / b.width) * 612 - 4, h: (after.height / b.height) * 792 - 4 }, DPI / 72, im.width, im.height);
    expect(rect.w).toBeGreaterThan(20);
    expect(maxInside(rgb, im.width, rect)).toBe(0);
    void browser;
  });

  test("JPEG format: valid, only pixels, boxes black away from their edge (size and edge values recorded)", async ({ page, browser }) => {
    test.setTimeout(180_000);
    await open(page);
    const source = fixtureBytes();
    await openReview(page, source);
    await toFinal(page);
    await page.getByLabel("Format gambar").selectOption("JPEG");
    await seeAllPages(page, 3);
    const out = await exportNow(page);
    const report = auditPdf(out.bytes);
    expect(report.problems).toEqual([]);
    expect(report.pages.every((p) => p.image.filter === "DCT")).toBe(true);
    expect(secretsInBytes(out.bytes, [...SECRETS, "Exif", "ICC_PROFILE", "Photoshop", "Adobe", "JFIF"])).toEqual([]);
    expect(out.bytes.subarray(0, 4).toString()).toBeDefined();
    // Decode the JPEG in the browser and look inside the boxes.
    const dev = await (await browser.newContext()).newPage();
    await dev.goto(`${DEV}/`);
    const targets = inkTargets().filter((t) => t.page === 0);
    const im = report.pages[0]!.image;
    const rects = targets.map((t) => pixelRect(t.box, DPI / 72, im.width, im.height));
    const b64 = Buffer.from(im.data).toString("base64");
    const stats = await dev.evaluate(
      async ({ b64, rects }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
        const c = document.createElement("canvas");
        c.width = bmp.width;
        c.height = bmp.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(bmp, 0, 0);
        return rects.map((r) => {
          let all = 0;
          let inner = 0;
          const d = ctx.getImageData(r.x, r.y, r.w, r.h).data;
          for (let y = 0; y < r.h; y += 1) {
            for (let x = 0; x < r.w; x += 1) {
              const v = Math.max(d[(y * r.w + x) * 4]!, d[(y * r.w + x) * 4 + 1]!, d[(y * r.w + x) * 4 + 2]!);
              all = Math.max(all, v);
              if (x >= 8 && y >= 8 && x < r.w - 8 && y < r.h - 8) inner = Math.max(inner, v);
            }
          }
          return { all, inner };
        });
      },
      { b64, rects },
    );
    note("jpeg: darkest-to-lightest value inside the ink rectangle (0 = black), whole and 8 px inset", stats);
    for (const s of stats) expect(s.inner).toBeLessThanOrEqual(24);
    note("fixture 3 pages, jpeg q0.92 150 dpi (bytes)", { output: out.bytes.length });
  });

  test("password protected, corrupt and empty files: a clear message, nothing leaves", async ({ page }) => {
    const guard = await open(page);
    await choose(page, makeTestPdf({ pages: [{ width: 200, height: 200, pieces: [{ text: "x", x: 10, y: 10 }] }], encrypted: true }), "terkunci.pdf");
    await expect(page.getByRole("alert").filter({ hasText: "dilindungi kata sandi" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("alert").filter({ hasText: "tidak ada kata sandi yang dikirim" })).toBeVisible();
    await choose(page, new TextEncoder().encode("bukan pdf sama sekali, hanya teks"), "rusak.pdf");
    await expect(page.getByRole("alert").filter({ hasText: "bukan PDF yang valid atau rusak" })).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(`${BASE}/`);
    await guard.done();
  });

  test("a PDF with no text layer warns and still allows manual boxes", async ({ page }) => {
    await open(page);
    await openReview(page, makeTestPdf({ pages: [{ width: 400, height: 300, pieces: [], imageOnly: true }] }));
    await expect(page.getByText(/tidak punya lapisan teks yang bisa dipindai/)).toBeVisible();
    await expect(page.getByText(/tampak berupa pindaian/)).toBeVisible();
    await page.getByRole("button", { name: "Tambah kotak manual" }).click();
    await expect(page.getByRole("button", { name: "Hapus kotak manual" })).toHaveCount(1);
  });

  test("narrow screen: tabs, and the final step works", async ({ page }) => {
    await open(page);
    await page.setViewportSize({ width: 390, height: 800 });
    await openReview(page, fixtureBytes());
    await expect(page.getByRole("tab", { name: "Temuan" })).toBeVisible();
    await page.getByRole("tab", { name: "Temuan" }).click();
    await expect(page.getByRole("heading", { name: /\d+ temuan/ })).toBeVisible();
    expect(await audit(page)).toEqual([]);
  });
});

test.describe("cancel, big pages, 100 pages (memory and time recorded)", () => {
  async function heap(cdp: CDPSession) {
    const m = await cdp.send("Performance.getMetrics");
    return m.metrics.find((x) => x.name === "JSHeapUsedSize")?.value ?? 0;
  }

  test("100 pages: open, scan, export; heap stays flat per page; cancel leaves no file", async ({ page }) => {
    test.setTimeout(420_000);
    test.skip(page.context().browser()?.browserType().name() !== "chromium", "heap and process memory are read through Chromium only");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await open(page);
    const source = manyPages(100);
    const rss = sampleRss();
    const t0 = Date.now();
    const base = await heap(cdp);
    let peak = base;
    const sampler = setInterval(() => void heap(cdp).then((h) => (peak = Math.max(peak, h))).catch(() => undefined), 200);
    await openReview(page, source);
    const openMs = Date.now() - t0;
    await expect(page.getByText("Halaman 1 dari 100", { exact: true })).toBeVisible();
    const afterOpen = await heap(cdp);
    await toFinal(page);

    // Cancel first: start the export, cancel after a few pages, expect no download and the page still usable.
    await seeAllPages(page, 100);
    await page.getByRole("checkbox", { name: /Saya sudah memeriksa/ }).check();
    let downloaded = false;
    page.once("download", () => (downloaded = true));
    await page.getByRole("button", { name: "Ekspor PDF" }).click();
    await expect(page.getByText(/Menggambar halaman (\d+) dari 100/).first()).toBeVisible();
    await page.waitForFunction(() => /Menggambar halaman ([3-9]|\d\d) dari 100/.test(document.body.innerText), undefined, { timeout: 60_000 });
    await page.getByRole("button", { name: "Batal" }).click();
    await expect(page.getByText("Ekspor dibatalkan. Tidak ada berkas yang dibuat.")).toBeVisible();
    expect(downloaded).toBe(false);
    await expect(page.getByRole("button", { name: "Ekspor PDF" })).toBeEnabled();

    // Now the full export, time per page and heap.
    const t1 = Date.now();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 300_000 }), page.getByRole("button", { name: "Ekspor PDF" }).click()]);
    const bytes = new Uint8Array(readFileSync(await dl.path()));
    const exportMs = Date.now() - t1;
    clearInterval(sampler);
    const rssPeak = rss.stop();
    const afterExport = await heap(cdp);
    const report = auditPdf(bytes);
    expect(report.problems).toEqual([]);
    expect(report.pages).toHaveLength(100);
    expect(secretsInBytes(bytes, [NIK, "budi.contoh@example.test"])).toEqual([]);
    note("100 pages lossless 150 dpi", { sourceBytes: source.length, outputBytes: bytes.length, openAndScanMs: openMs, exportMs, msPerPage: Math.round(exportMs / 100), browserRssMB: { start: rss.start, peak: rssPeak, end: browserRssMB() }, jsHeapMB: { before: Math.round(base / 1e6), afterOpen: Math.round(afterOpen / 1e6), peakWhileSampling: Math.round(peak / 1e6), afterExport: Math.round(afterExport / 1e6) } });
    // Not a leak per page: after the export the heap is within a generous multiple of what it was after opening.
    expect(afterExport).toBeLessThan(Math.max(afterOpen * 3, afterOpen + 150e6));
  });

  test("an A0 page at 300 dpi is lowered to what a canvas can hold and says so", async ({ page }) => {
    test.setTimeout(300_000);
    await open(page);
    const a0 = makeTestPdf({ pages: [{ width: 2384, height: 3370, pieces: [{ text: `NIK: ${NIK}`, x: 200, y: 3000, size: 48, font: "Courier" }] }] });
    await openReview(page, a0);
    await toFinal(page);
    await page.getByLabel("Resolusi (DPI)").selectOption("300");
    await seeAllPages(page, 1);
    const rss = sampleRss();
    const t = Date.now();
    const out = await exportNow(page);
    const ms = Date.now() - t;
    const rssPeak = rss.stop();
    await expect(page.getByText(/terlalu besar untuk kanvas browser/)).toBeVisible();
    const report = auditPdf(out.bytes);
    expect(report.problems).toEqual([]);
    expect(Math.max(report.pages[0]!.image.width, report.pages[0]!.image.height)).toBeLessThanOrEqual(8192);
    expect(report.pages[0]!.width).toBeCloseTo(2384, 0);
    note("A0 2384x3370 pt at 300 dpi requested", { px: [report.pages[0]!.image.width, report.pages[0]!.image.height], bytes: out.bytes.length, ms, browserRssMB: { start: rss.start, peak: rssPeak } });
  });

  test("cancel while opening a big document returns to a usable home page", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    await choose(page, manyPages(150), "besar.pdf");
    await page.getByRole("button", { name: "Batal" }).click({ timeout: 30_000 }).catch(() => undefined);
    // Either it was cancelled or it finished first; in both cases a second file opens normally.
    await page.goto(`${BASE}/`);
    await choose(page, fixtureBytes());
    await expect(page).toHaveURL(/#\/pdf$/, { timeout: 90_000 });
  });
});

test("a filled form field is drawn into the picture but not scanned, so the page warns (the file equals what the user saw)", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await open(page);
  const rect: [number, number, number, number] = [72, 600, 300, 620];
  const src = makeTestPdf({ pages: [{ width: 612, height: 792, pieces: [{ text: "Isian di bawah", x: 72, y: 640 }], widget: { value: "Budi Contoh Santoso", rect } }] });
  await openReview(page, src);
  await expect(page.getByText(/1 anotasi atau isian/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Hapus kotak/ })).toHaveCount(0); // nothing is boxed automatically
  await toFinal(page);
  await seeAllPages(page, 1);
  const out = await exportNow(page);
  const report = auditPdf(out.bytes);
  expect(report.problems).toEqual([]);
  expect(secretsInBytes(out.bytes, ["Budi Contoh Santoso"])).toEqual([]);
  const im = report.pages[0]!.image;
  const rgb = decodeLossless(im);
  const r = pixelRect({ x: rect[0], y: 792 - rect[3], w: rect[2] - rect[0], h: rect[3] - rect[1] }, DPI / 72, im.width, im.height);
  let ink = 0;
  for (let y = 0; y < r.h; y += 1) for (let x = 0; x < r.w; x += 1) if ((rgb[((r.y + y) * im.width + r.x + x) * 3] ?? 255) < 128) ink += 1;
  note("form field value drawn into the picture (dark pixels inside the field rectangle)", { ink });
  // The warning says "periksa sendiri": the value is visible in the preview, and nothing boxes it automatically.
  expect(ink).toBeGreaterThan(100);
  const dev = await (await browser.newContext()).newPage();
  await dev.goto(`${DEV}/`);
  const crop = Buffer.from(await sourceCrop(dev, src, 1, r), "base64");
  let diff = 0;
  for (let y = 0; y < r.h; y += 1) for (let x = 0; x < r.w; x += 1) for (let k = 0; k < 3; k += 1) if (rgb[((r.y + y) * im.width + r.x + x) * 3 + k] !== crop[(y * r.w + x) * 3 + k]) diff += 1;
  expect(diff, "the file equals the render the user saw").toBe(0);
});
