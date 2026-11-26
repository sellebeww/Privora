// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// The export of a hostile PDF (src/pdf/adversarialPdf.ts) carries nothing
// but pixels, vertical and rotated text ends up black, and the export refuses to write a file whose boxes
// it cannot prove black. Chromium, production build under the CSP. All values are invented (SINTETIS).
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ADV, HIDDEN_MARKERS, makeAdversarialPdf, VERTICAL } from "../src/pdf/adversarialPdf";
import { auditPdf, decodeLossless, maxInside, secretsInBytes } from "../src/pdf/audit";
import { pixelRect, type Box } from "../src/pdf/geometry";
import { makeTestPdf } from "../src/pdf/testPdf";

const BASE = "http://localhost:4177";
const DEV = "http://localhost:4176";
const SCALE = 150 / 72;
const hostile = () => makeAdversarialPdf(new Uint8Array(readFileSync("node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf")));

async function toFinal(page: Page, bytes: Uint8Array, pages: number, name = `KTP ${ADV.nik}.pdf`) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/`);
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(bytes) });
  await expect(page).toHaveURL(/#\/pdf$/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Ke pratinjau akhir" }).click();
  for (let i = 1; i <= pages; i += 1) {
    await page.getByRole("img", { name: new RegExp(`^Pratinjau halaman ${i} `) }).scrollIntoViewIfNeeded();
    await expect(page.getByText(`${i} dari ${pages} halaman sudah dilihat`)).toBeVisible({ timeout: 30_000 });
  }
  await page.getByRole("checkbox", { name: /Saya sudah memeriksa/ }).check();
}
async function exportNow(page: Page) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByRole("button", { name: "Ekspor PDF" }).click()]);
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(readFileSync((await dl.path())!)) };
}

/** Where the invented values are painted, worked out from the file itself (not from the app). */
const INK: { page: number; what: string; box: Box }[] = [
  // Page 1: /Rotate 90, CropBox [50 200 560 700]; a user point (x, y) shows at (y - 200, x - 50).
  { page: 0, what: "rotated NIK", box: { x: 401, y: 87, w: 9, h: 140 } },
  { page: 0, what: "rotated e-mail", box: { x: 361, y: 100, w: 6, h: 110 } },
  {
    page: 1,
    what: "vertical NIK",
    box: { x: VERTICAL.x - 5, y: VERTICAL.pageHeight - VERTICAL.y + VERTICAL.prefix.length * VERTICAL.size + 2, w: 10, h: ADV.nikVertical.length * VERTICAL.size - 4 },
  },
];
const FORBIDDEN = [
  ...HIDDEN_MARKERS, "MARKTHUMBRGB", "MARKID", ADV.nik, ADV.nikVertical, ADV.mail, "Liberation", "JavaScript", "/Font", "/Info", "/Annots", "/Metadata",
  "/AcroForm", "/EmbeddedFile", "/Names", "/Outlines", "/OpenAction", "/Thumb", "/PieceInfo", "/OCProperties", "xpacket", "xmpmeta", "KTP",
];

test("the source really carries what the export must drop", () => {
  const raw = Buffer.from(hostile()).toString("latin1");
  // Invisible and off page text are written as glyph numbers, so their markers are not plain bytes in the source.
  const plain = HIDDEN_MARKERS.filter((m) => !["MARKINVISIBLE", "MARKOFFPAGE", "MARKFREE"].includes(m));
  for (const m of [...plain, "MARKTHUMBRGB", "MARKID", "/FontFile2", "/Identity-V", "/AcroForm", "/EmbeddedFiles", "/CropBox", "/Rotate 90"]) expect(raw).toContain(m);
});

for (const format of ["LOSSLESS", "JPEG"] as const) {
  test(`hostile PDF, ${format}: only pictures, values black, nothing hidden carried over`, async ({ page }) => {
    await toFinal(page, hostile(), 2);
    await page.getByLabel("Format gambar").selectOption(format);
    const out = await exportNow(page);
    expect(out.name).toBe("dokumen-samar.pdf");
    const report = auditPdf(out.bytes);
    expect(report.problems).toEqual([]);
    expect(report.pages.map((p) => [p.width, p.height])).toEqual([[500, 510], [612, 792]]);
    expect(secretsInBytes(out.bytes, FORBIDDEN)).toEqual([]);
    if (format !== "LOSSLESS") return;
    for (const t of INK) {
      const im = report.pages[t.page]!.image;
      const r = pixelRect(t.box, SCALE, im.width, im.height);
      expect(r.w * r.h).toBeGreaterThan(100);
      expect(maxInside(decodeLossless(im), im.width, r), t.what).toBe(0);
    }
    writeFileSync("test-results/audit-hostile-export.pdf", out.bytes);
  });
}

test("the annotation and form warning is shown for the hostile page", async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.locator('input[type="file"]').setInputFiles({ name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from(hostile()) });
  await expect(page.getByText(/6 anotasi atau isian/)).toBeVisible({ timeout: 60_000 });
});

for (const format of ["LOSSLESS", "JPEG"] as const) {
  test(`${format}: a browser that returns altered canvas pixels gets no file`, async ({ page }) => {
    await page.addInitScript(() => {
      const real = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (this: CanvasRenderingContext2D, ...a: Parameters<typeof real>) {
        const d = real.apply(this, a);
        for (let i = 0; i < d.data.length; i += 4) d.data[i] = (d.data[i]! + 1) & 255;
        return d;
      };
    });
    await toFinal(page, hostile(), 2);
    await page.getByLabel("Format gambar").selectOption(format);
    let downloads = 0;
    page.on("download", () => (downloads += 1));
    await page.getByRole("button", { name: "Ekspor PDF" }).click();
    await expect(page.getByRole("alert")).toContainText("ekspor dihentikan", { timeout: 30_000 });
    expect(downloads).toBe(0);
  });
}

test("boxes stay black whatever state is left on the canvas; a leftover clip is caught", async ({ page }) => {
  await page.goto(`${DEV}/`);
  const got = await page.evaluate(async () => {
    const path = "/src/pdf/render.ts";
    const { drawBoxes, rectsAreBlack } = await import(/* @vite-ignore */ path);
    const make = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 100;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 100, 100);
      return ctx;
    };
    const dirty = make();
    dirty.translate(40, 40);
    dirty.scale(0.1, 0.1);
    dirty.globalAlpha = 0.2;
    dirty.globalCompositeOperation = "destination-over";
    dirty.filter = "opacity(0.1)";
    const a = rectsAreBlack(dirty, drawBoxes(dirty, [{ x: 10, y: 10, w: 30, h: 30 }], 1));
    const clipped = make();
    clipped.beginPath();
    clipped.rect(0, 0, 5, 5);
    clipped.clip();
    const b = rectsAreBlack(clipped, drawBoxes(clipped, [{ x: 10, y: 10, w: 30, h: 30 }], 1));
    return { dirty: a, clipped: b };
  });
  expect(got).toEqual({ dirty: true, clipped: false });
});

test("a very tall page counts as seen only once its bottom was reached", async ({ page }) => {
  const tall = makeTestPdf({ pages: [{ width: 200, height: 2400, pieces: [{ text: `NIK: ${ADV.nik}`, x: 20, y: 1200, size: 10 }] }] });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/`);
  await page.locator('input[type="file"]').setInputFiles({ name: "panjang.pdf", mimeType: "application/pdf", buffer: Buffer.from(tall) });
  await expect(page).toHaveURL(/#\/pdf$/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Ke pratinjau akhir" }).click();
  const canvas = page.getByRole("img", { name: /^Pratinjau halaman 1 / });
  await canvas.evaluate((e) => e.scrollIntoView({ block: "start" }));
  await page.waitForFunction(() => (document.querySelector("canvas")?.width ?? 0) > 0);
  await page.waitForTimeout(500);
  await expect(page.getByText("0 dari 1 halaman sudah dilihat")).toBeVisible();
  await canvas.evaluate((e) => e.scrollIntoView({ block: "end" }));
  await expect(page.getByText("1 dari 1 halaman sudah dilihat")).toBeVisible({ timeout: 30_000 });
});
