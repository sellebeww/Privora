// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// The text flow in real Chromium against the production build (CSP applied, real module worker, real wasm):
// paste, review, tokenise, simulated LLM reply, restore, encrypted map, manual ranges, keyboard, big text, cancel.
// All documents are invented (SINTETIS).
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { audit } from "./audit";
import { allowClipboard, DOC, NIK, scanText } from "./helpers";

const BASE = "http://localhost:4177";
const SHOTS = "test-results/screenshots";
const PASS = "kata-sandi-uji-12345";

/** Collects external requests and CSP violations; `done()` asserts there were none. */
async function open(page: Page, viewport = { width: 1280, height: 900 }) {
  const external: string[] = [];
  await page.setViewportSize(viewport);
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

const docRegion = (page: Page) => page.getByRole("region", { name: "Isi dokumen", exact: true });

async function selectText(page: Page, needle: string, occurrence = 0) {
  await page.evaluate(
    ({ needle, occurrence }) => {
      const root = document.querySelector('[role=region][aria-label="Isi dokumen"]')!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n = 0;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const v = node.nodeValue ?? "";
        for (let i = v.indexOf(needle); i >= 0; i = v.indexOf(needle, i + 1)) {
          if (n++ === occurrence) {
            const r = document.createRange();
            r.setStart(node, i);
            r.setEnd(node, i + needle.length);
            const s = getSelection()!;
            s.removeAllRanges();
            s.addRange(r);
            return;
          }
        }
      }
      throw new Error("text not found");
    },
    { needle, occurrence },
  );
}

async function download(page: Page, click: () => Promise<void>): Promise<{ name: string; text: string }> {
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  return { name: dl.suggestedFilename(), text: readFileSync((await dl.path())!, "utf8") };
}

test("tokenise, simulated LLM reply, restore from the session map, exact original", async ({ page, context }) => {
  await allowClipboard(page, context);
  const o = await open(page);
  await expect(page.getByText("Memuat mesin deteksi")).toHaveCount(0, { timeout: 15_000 });
  await scanText(page, DOC, "Tokenisasi untuk LLM");
  expect(await audit(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/review.png` });

  // The user's choice is honoured: the phone number is left visible.
  await page.getByRole("checkbox", { name: "0812-5550-0101" }).uncheck();
  await page.getByRole("button", { name: "Lihat hasil" }).click();
  await expect(page.getByRole("heading", { name: "Hasil", level: 2 })).toBeVisible();
  const after = page.getByRole("region", { name: "Sesudah", exact: true });
  await expect(after).toContainText("[[NIK_1]]");
  await expect(after).toContainText("0812-5550-0101");
  await expect(after).not.toContainText(NIK);
  expect(await audit(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/result.png` });

  await page.getByRole("button", { name: "Salin", exact: true }).click();
  const tokenised = await page.evaluate(() => navigator.clipboard.readText());
  expect(tokenised).not.toContain(NIK);
  expect(tokenised).toContain("0812-5550-0101");
  // The map is never on the clipboard.
  expect(tokenised).not.toContain("kata-sandi");

  // Simulated LLM reply: the text comes back unchanged, tokens left in place.
  await page.getByRole("link", { name: "Pulihkan" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Pulihkan" })).toBeVisible();
  await expect(page.getByLabel(/Peta sesi ini \(\d+ token\)/)).toBeChecked();
  await page.getByRole("textbox", { name: /Balasan atau teks bertoken/ }).fill(tokenised);
  await page.getByRole("button", { name: "Pulihkan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hasil pemulihan" })).toBeVisible();
  await expect(page.getByText(/\d+ token dipulihkan/)).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/restore.png`, fullPage: true });
  const restored = await download(page, () => page.getByRole("button", { name: "Unduh .txt" }).click());
  expect(restored.text).toBe(DOC);
  expect(restored.name).toMatch(/^dokumen-dipulihkan\.txt$/);
  // Highlight: at least the NIK value is marked in the restored text.
  await expect(page.getByRole("region", { name: "Teks hasil pemulihan", exact: true }).locator("mark", { hasText: NIK })).toHaveCount(1);

  // An LLM reply that rewrites around the tokens, with a stray token-like string.
  await page.getByRole("textbox", { name: /Balasan atau teks bertoken/ }).fill("Ringkasan: [[NIK_1]] terdaftar. Lihat [[BUKAN_9]].");
  await page.getByRole("button", { name: "Pulihkan", exact: true }).click();
  await expect(page.getByText("1 string mirip token tidak ada di peta")).toBeVisible();
  await expect(page.getByRole("region", { name: "Teks hasil pemulihan", exact: true })).toContainText(`Ringkasan: ${NIK} terdaftar. Lihat [[BUKAN_9]].`);

  // Tolerant mode flags the changed spelling; strict leaves it.
  await page.getByRole("textbox", { name: /Balasan atau teks bertoken/ }).fill("[[ nik_1 ]]");
  await page.getByRole("button", { name: "Pulihkan", exact: true }).click();
  await expect(page.getByRole("region", { name: "Teks hasil pemulihan", exact: true })).toContainText("[[ nik_1 ]]");
  await page.getByRole("radio", { name: /Toleran/ }).click();
  await page.getByRole("button", { name: "Pulihkan", exact: true }).click();
  await expect(page.getByRole("region", { name: "Teks hasil pemulihan", exact: true })).toContainText(NIK);
  await expect(page.getByText("1 penggantian toleran (periksa sendiri)")).toBeVisible();

  await o.done();
});

test("encrypted map file: passphrase rules, no plaintext, clear session, restore from the file", async ({ page, context }) => {
  await allowClipboard(page, context);
  const o = await open(page);
  await scanText(page, DOC, "Tokenisasi untuk LLM");
  await page.getByRole("button", { name: "Lihat hasil" }).click();
  await page.getByRole("button", { name: "Salin", exact: true }).click();
  const tokenised = await page.evaluate(() => navigator.clipboard.readText());

  await page.getByRole("button", { name: "Simpan peta terenkripsi" }).click();
  const dlg = page.getByRole("dialog", { name: "Simpan peta token" });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("Tidak ada cara memulihkan frasa sandi");
  await dlg.getByLabel("Frasa sandi", { exact: true }).fill("pendek");
  await dlg.getByLabel("Ulangi frasa sandi").fill("pendek");
  await dlg.getByRole("button", { name: "Enkripsi dan unduh" }).click();
  await expect(dlg.getByRole("alert")).toContainText("minimal 12 karakter");
  await dlg.getByLabel("Frasa sandi", { exact: true }).fill(PASS);
  await dlg.getByLabel("Ulangi frasa sandi").fill(PASS + "x");
  await dlg.getByRole("button", { name: "Enkripsi dan unduh" }).click();
  await expect(dlg.getByRole("alert")).toContainText("tidak sama");
  await dlg.getByLabel("Ulangi frasa sandi").fill(PASS);
  const map = await download(page, () => dlg.getByRole("button", { name: "Enkripsi dan unduh" }).click());
  expect(map.name).toBe("dokumen-peta.json");
  const file = JSON.parse(map.text) as Record<string, unknown>;
  expect(Object.keys(file).sort()).toEqual(["ct", "iter", "iv", "kdf", "salt", "v"]);
  expect(file["v"]).toBe(1);
  expect(file["iter"]).toBe(600_000);
  expect(map.text).not.toContain(NIK);
  expect(map.text).not.toContain("Budi");
  await expect(dlg).toBeHidden();

  await page.getByRole("button", { name: "Bersihkan sesi" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Samarkan data pribadi");
  await expect(page.getByRole("textbox")).toHaveValue("");
  await page.getByRole("link", { name: "Pulihkan" }).first().click();
  await expect(page.getByText("Tidak ada peta di sesi ini")).toBeVisible();
  await page.getByRole("textbox", { name: /Balasan atau teks bertoken/ }).fill(tokenised);
  await page.setInputFiles("input[type=file][accept*=json]", { name: "peta.json", mimeType: "application/json", buffer: Buffer.from(map.text) });
  await page.getByLabel("Frasa sandi peta").fill("frasa-sandi-yang-salah");
  await page.getByRole("button", { name: "Buka peta" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Peta tidak bisa dibuka" })).toBeVisible();
  await page.getByLabel("Frasa sandi peta").fill(PASS);
  await page.getByRole("button", { name: "Buka peta" }).click();
  await expect(page.getByText(/Peta terbuka: \d+ token\./)).toBeVisible();
  await page.getByRole("button", { name: "Pulihkan", exact: true }).click();
  const restored = await download(page, () => page.getByRole("button", { name: "Unduh .txt" }).click());
  expect(restored.text).toBe(DOC);

  // A file that is not a map is refused with a clear message.
  await page.setInputFiles("input[type=file][accept*=json]", { name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"a":1}') });
  await page.getByLabel("Frasa sandi peta").fill(PASS);
  await page.getByRole("button", { name: "Buka peta" }).click();
  await expect(page.getByText("bukan peta Privora yang valid")).toBeVisible();
  await o.done();
});

test("mask mode: style Label and Blok, copy, download with a fixed name", async ({ page, context }) => {
  await allowClipboard(page, context);
  const o = await open(page);
  await page.setInputFiles("input[type=file]", { name: "../surat contoh?.md", mimeType: "text/markdown", buffer: Buffer.from(DOC) });
  await expect(page.getByRole("status").filter({ hasText: "karakter dibuka" })).toBeVisible();
  await page.getByRole("button", { name: "Pindai" }).click();
  await expect(page).toHaveURL(/#\/ruang-kerja$/);
  await page.getByRole("button", { name: "Lihat hasil" }).click();
  const after = page.getByRole("region", { name: "Sesudah", exact: true });
  await expect(after).toContainText("[NIK]");
  await expect(after).not.toContainText(NIK);
  await page.getByRole("radio", { name: "Blok" }).click();
  await expect(after).toContainText("█".repeat(8));
  await expect(after).not.toContainText("[NIK]");
  await page.getByRole("button", { name: "Salin", exact: true }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).not.toContain(NIK);
  expect(copied).toContain("█".repeat(8));
  const file = await download(page, () => page.getByRole("button", { name: "Unduh .txt" }).click());
  expect(file.name).toBe("dokumen-samar.txt"); // nothing from the source name (F-06)
  expect(file.text).toBe(copied);
  await expect(page.getByText("Penyamaran bersifat permanen")).toBeVisible();
  await o.done();
});

test("manual ranges: hide this, hide all occurrences, overlap with a finding, nothing selected", async ({ page }) => {
  const o = await open(page);
  await scanText(page);
  // The second "Budi Contoh Santoso" (in the free text) is not a finding.
  await selectText(page, "Budi Contoh Santoso", 0);
  const bar = page.getByRole("group", { name: "Teks yang dipilih" });
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Hitamkan semua kemunculan" }).click();
  await expect(page.getByText(/^\d+ kemunculan ditambahkan\.$/)).toBeVisible();
  await expect(bar).toBeHidden();
  await expect(page.getByRole("list", { name: "Temuan" }).getByText("MANUAL", { exact: true }).first()).toBeVisible();

  await selectText(page, "Jl. Contoh");
  await page.getByRole("button", { name: "Hitamkan ini" }).click();
  await expect(page.getByText("Ditambahkan ke daftar temuan.")).toBeVisible();

  await page.getByRole("button", { name: "Lihat hasil" }).click();
  const after = page.getByRole("region", { name: "Sesudah", exact: true });
  await expect(after).not.toContainText("Budi");
  await expect(after).not.toContainText("Santoso");
  await expect(after).not.toContainText(NIK);
  await expect(page.getByText("MANUAL", { exact: true }).first()).toBeVisible();

  // Back to review: deselect everything with A, the result equals the input.
  await page.getByRole("button", { name: "Kembali ke tinjauan" }).click();
  await page.keyboard.press("a");
  await expect(page.getByText(/^0 dari \d+ dipilih$/)).toBeVisible();
  await page.getByRole("button", { name: "Lihat hasil" }).click();
  await expect(page.getByText("Belum ada temuan yang dipilih")).toBeVisible();
  await expect(page.getByRole("region", { name: "Sesudah", exact: true })).toContainText("Budi Contoh Santoso");
  await o.done();
});

test("a selection across several highlights and lines is mapped to exact text", async ({ page }) => {
  await open(page);
  await scanText(page);
  // From inside the name highlight to inside the NIK highlight: two marks, a plain line break and a label between.
  await page.evaluate(() => {
    const root = document.querySelector('[role=region][aria-label="Isi dokumen"]')!;
    const nodes: Text[] = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) nodes.push(n as Text);
    const a = nodes.find((n) => n.nodeValue === "Budi Contoh Santoso")!;
    const b = nodes.find((n) => n.nodeValue === "3171011505900001")!;
    const r = document.createRange();
    r.setStart(a, 5);
    r.setEnd(b, 6);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  });
  await page.getByRole("button", { name: "Hitamkan ini" }).click();
  await page.getByRole("button", { name: "Lihat hasil" }).click();
  const after = page.getByRole("region", { name: "Sesudah", exact: true });
  // The name and NIK findings are selected too, so the union is one stretch from "Nama : " to the end of the NIK;
  // its two kinds differ, so it is labelled [DATA]. The free text line with the same name is untouched.
  await expect(after).toContainText("SURAT KETERANGAN (SINTETIS) Nama : [DATA] Telp : [TELEPON]");
  await expect(after).not.toContainText("317101");
  await expect(after).toContainText("Catatan: Budi Contoh Santoso hadir.");
});

test("a manual range over a switched-off finding: only the covered part is drawn as hidden", async ({ page }) => {
  await open(page);
  await scanText(page);
  await page.getByRole("checkbox", { name: NIK }).uncheck();
  await selectText(page, NIK.slice(0, 6));
  await page.getByRole("button", { name: "Hitamkan ini" }).click();
  const marks = docRegion(page).locator("mark");
  const nikMarks = marks.filter({ hasText: /^(317101|1505900001)$/ });
  await expect(nikMarks).toHaveCount(2);
  await expect(nikMarks.nth(0)).toHaveText("317101");
  expect(await nikMarks.nth(0).evaluate((e) => getComputedStyle(e).borderBottomStyle)).toBe("solid");
  expect(await nikMarks.nth(1).evaluate((e) => getComputedStyle(e).borderBottomStyle)).toBe("dashed");
  await page.getByRole("button", { name: "Lihat hasil" }).click();
  await expect(page.getByRole("region", { name: "Sesudah", exact: true })).toContainText("[DATA]1505900001");
});

test("keyboard: J K Space Enter A and the shortcut dialog", async ({ page }) => {
  await open(page);
  await scanText(page);
  const items = page.getByRole("list", { name: "Temuan" }).locator("li[tabindex]");
  await items.first().focus();
  const count = (await page.getByText(/^\d+ dari \d+ dipilih$/).textContent())!;
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("j");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("k");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press(" ");
  await expect(page.getByText(/^\d+ dari \d+ dipilih$/)).not.toHaveText(count);
  await page.keyboard.press(" ");
  await expect(page.getByText(/^\d+ dari \d+ dipilih$/)).toHaveText(count);
  await page.keyboard.press("Enter");
  await expect(docRegion(page).locator("mark:focus")).toHaveCount(1);
  // From the document, J goes back to the list.
  await page.keyboard.press("j");
  await expect(page.locator("li[tabindex='0']")).toBeFocused();
  await page.keyboard.press("a");
  await expect(page.getByText(/^0 dari \d+ dipilih$/)).toBeVisible();
  await page.keyboard.press("a");
  await expect(page.getByText(/^(\d+) dari \1 dipilih$/)).toBeVisible();
  await page.keyboard.press("?");
  const dlg = page.getByRole("dialog", { name: "Pintasan keyboard" });
  await expect(dlg).toBeVisible();
  await expect(dlg.locator("kbd")).toHaveCount(6);
  // Keys do not leak through the open dialog.
  await page.keyboard.press("a");
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(page.getByText(/^(\d+) dari \1 dipilih$/)).toBeVisible();
});

test("a click on a highlight toggles it; sensitivity change asks for a rescan", async ({ page }) => {
  await open(page);
  await scanText(page);
  const mark = docRegion(page).locator("mark", { hasText: NIK });
  await mark.click();
  expect(await mark.evaluate((e) => getComputedStyle(e).borderBottomStyle)).toBe("dashed");
  await mark.click();
  expect(await mark.evaluate((e) => getComputedStyle(e).borderBottomStyle)).toBe("solid");
  await page.getByRole("switch", { name: /Hati-hati/ }).click();
  await expect(page.getByText(/Sensitivitas berubah/)).toBeVisible();
  await page.getByRole("button", { name: "Pindai ulang" }).click();
  await expect(page.getByText(/Sensitivitas berubah/)).toBeHidden();
});

test("no findings: honest message and a way to add by hand", async ({ page }) => {
  await open(page);
  await scanText(page, "Tidak ada apa-apa di sini selain kalimat biasa.");
  await expect(page.getByText("Tidak ada data pribadi terdeteksi. Itu bukan jaminan; periksa sendiri.")).toBeVisible();
  await selectText(page, "kalimat biasa");
  await page.getByRole("button", { name: "Hitamkan ini" }).click();
  await page.getByRole("button", { name: "Lihat hasil" }).click();
  await expect(page.getByRole("region", { name: "Sesudah", exact: true })).toContainText("[DATA]");
});

test("a file in the wrong encoding is refused with a clear message", async ({ page }) => {
  await open(page);
  await page.setInputFiles("input[type=file]", { name: "lama.txt", mimeType: "text/plain", buffer: Buffer.from([0x63, 0x61, 0x66, 0xe9]) });
  await expect(page.getByRole("alert")).toContainText("bukan teks UTF-8 yang valid");
  await expect(page.getByRole("textbox")).toHaveValue("");
  await page.setInputFiles("input[type=file]", { name: "a.docx", mimeType: "application/zip", buffer: Buffer.from("x") });
  await expect(page.getByRole("alert")).toContainText("tidak didukung");
  await page.setInputFiles("input[type=file]", { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  // A file that only has a header is reported as invalid.
  await expect(page.getByRole("alert")).toContainText("bukan PDF yang valid atau rusak", { timeout: 30_000 });
});

test("drag and drop opens a text file", async ({ page }) => {
  await open(page);
  const dt = await page.evaluateHandle((t) => {
    const d = new DataTransfer();
    d.items.add(new File([t], "seret.txt", { type: "text/plain" }));
    return d;
  }, DOC);
  await page.locator("div.border-dashed").dispatchEvent("drop", { dataTransfer: dt });
  await expect(page.getByRole("textbox")).toHaveValue(DOC);
});

test("cancel a running scan, then scan again", async ({ page }) => {
  await open(page);
  const big = (DOC + "\n").repeat(40_000); // about 10 MB, dense
  await page.setInputFiles("input[type=file]", { name: "besar.txt", mimeType: "text/plain", buffer: Buffer.from(big) });
  await expect(page.getByRole("status").filter({ hasText: "karakter dibuka" })).toBeVisible();
  await page.getByRole("button", { name: "Pindai" }).click();
  const cancel = page.getByRole("button", { name: "Batal" });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.getByText("Pemindaian dibatalkan.")).toBeVisible();
  await expect(page).not.toHaveURL(/ruang-kerja/);
  await expect(page.getByRole("button", { name: "Pindai" })).toBeEnabled();
  // The engine restarts by itself.
  await page.getByRole("button", { name: "Kosongkan" }).click();
  await page.getByRole("textbox").fill(DOC);
  await page.getByRole("button", { name: "Pindai" }).click();
  await expect(page).toHaveURL(/#\/ruang-kerja$/);
});

test("5 MB document stays responsive: windowed document, progress, jump, tokenise", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  // About 1.8 KB per unit: one invented record plus filler without personal data.
  const filler = "Lorem ipsum dolor sit amet, teks pengisi tanpa data pribadi. ".repeat(24);
  const unit = `${DOC}\n${filler}\n\n`;
  const big = unit.repeat(Math.ceil((5 * 1024 * 1024) / unit.length));
  expect(big.length).toBeGreaterThan(5 * 1024 * 1024);
  await page.setInputFiles("input[type=file]", { name: "lima-mb.txt", mimeType: "text/plain", buffer: Buffer.from(big) });
  await expect(page.getByRole("status").filter({ hasText: "karakter dibuka" })).toBeVisible();
  // The 5 MB text is not put in a text box.
  await expect(page.getByRole("textbox")).toHaveCount(0);

  await page.evaluate(() => {
    const w = window as unknown as { __gap: number; __last: number };
    w.__gap = 0;
    w.__last = performance.now();
    setInterval(() => {
      const n = performance.now();
      w.__gap = Math.max(w.__gap, n - w.__last);
      w.__last = n;
    }, 10);
  });
  const t0 = Date.now();
  await page.getByRole("button", { name: "Pindai" }).click();
  await expect(page).toHaveURL(/#\/ruang-kerja$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: /\d+ temuan/ })).toBeVisible();
  const scanMs = Date.now() - t0;
  const gap = await page.evaluate(() => (window as unknown as { __gap: number }).__gap);
  const findings = Number((await page.getByRole("heading", { name: /\d+ temuan/ }).textContent())!.match(/\d+/)![0]);
  const blocks = await page.locator("[data-block]").count();
  const marks = await docRegion(page).locator("mark").count();
  console.log(`5MB: scan ${scanMs} ms (click to review), longest main thread gap ${Math.round(gap)} ms, findings ${findings}, rendered blocks ${blocks}, rendered marks ${marks}`);
  expect(findings).toBeGreaterThan(10_000);
  expect(blocks).toBeLessThan(30);
  expect(gap).toBeLessThan(1000);

  // Scroll to the end: only a few blocks exist, the last text is reachable.
  const t1 = Date.now();
  await docRegion(page).evaluate((e) => (e.scrollTop = e.scrollHeight));
  await expect(docRegion(page)).toContainText("teks pengisi");
  await expect.poll(() => docRegion(page).evaluate((e) => e.scrollTop + e.clientHeight >= e.scrollHeight - 2), { timeout: 10_000 }).toBe(true);
  console.log(`5MB: scroll to end and render ${Date.now() - t1} ms, blocks now ${await page.locator("[data-block]").count()}`);
  expect(await page.locator("[data-block]").count()).toBeLessThan(30);

  // Jump back to the first finding from the list.
  await page.getByRole("button", { name: /Lompat ke/ }).first().click();
  await expect(docRegion(page).locator("mark:focus")).toHaveCount(1);
  expect(await docRegion(page).evaluate((e) => e.scrollTop)).toBeLessThan(3000);

  // The list shows at most 100 rows per kind and offers more.
  expect(await page.getByRole("list", { name: "Temuan" }).getByRole("checkbox").count()).toBeLessThan(1500);
  await expect(page.getByRole("button", { name: /Tampilkan \d+ lagi/ }).first()).toBeVisible();

  // Tokenise 5 MB: the result is ready, the output has no NIK.
  const t2 = Date.now();
  await page.getByRole("button", { name: "Lihat hasil" }).click();
  await expect(page.getByRole("button", { name: "Salin", exact: true })).toBeVisible({ timeout: 90_000 });
  console.log(`5MB: result (redact) ready ${Date.now() - t2} ms`);
  const out = await download(page, () => page.getByRole("button", { name: "Unduh .txt" }).click());
  expect(out.text.length).toBeLessThan(big.length);
  expect(out.text).not.toContain(NIK);
  expect(out.name).toBe("dokumen-samar.txt");
});

test("nothing is stored, nothing leaves, after a full flow", async ({ page }) => {
  const o = await open(page);
  await scanText(page, DOC, "Tokenisasi untuk LLM");
  await page.getByRole("button", { name: "Lihat hasil" }).click();
  await expect(page.getByRole("button", { name: "Salin", exact: true })).toBeVisible();
  const stored = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    idb: (await indexedDB.databases()).length,
    cookie: document.cookie,
  }));
  expect(stored).toEqual({ local: 0, session: 0, idb: 0, cookie: "" });
  // Cache Storage holds the app's own files (service worker precache) and nothing from the session.
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cached = await page.evaluate(async () => {
    const out: { cache: string; url: string; text: string }[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) out.push({ cache: name, url: req.url, text: await (await cache.match(req))!.text() });
    }
    return out;
  });
  expect(cached.length).toBeGreaterThan(100);
  const origin = new URL(page.url()).origin;
  for (const c of cached) {
    expect(c.cache).toMatch(/^privora-[0-9a-f]{16}$/);
    expect(c.url.startsWith(`${origin}/`), c.url).toBe(true);
    for (const secret of [NIK, "Budi Contoh Santoso", "budi.contoh@example.test"]) expect(c.text.includes(secret), `${secret} in ${c.url}`).toBe(false);
  }
  await o.done();
});
