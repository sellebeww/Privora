// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// No value the user chose to hide may come out anywhere (text, tokens,
// file names, clipboard, errors, console, title, what is left in the page or the heap), and offsets must
// survive emoji, combining marks and CRLF from the file to the highlight to the output. Chromium,
// production build under the CSP. All values are invented (SINTETIS).
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { allowClipboard, pickMode } from "./helpers";

const BASE = "http://localhost:4177";

const VALUES = [
  "Rahayu Contoh Wiratama",
  "3171011505900001",
  "3273012006850002",
  "09.254.294.3-407.000",
  "0813-5550-0177",
  "rahayu.contoh@example.test",
  "4111 1111 1111 1111",
  "Jl. Anggrek Contoh No. 17, RT 03 RW 04",
  "15 Mei 1990",
];
/** Pieces of the values: not even a part of one may appear. */
const PIECES = [...VALUES, "Rahayu", "Wiratama", "Anggrek", "rahayu.", "@example", "317101", "900001", "327301", "254.294", "5550-0177", "1111 1111", "Mei 1990"];
const DOC = [
  "SURAT KETERANGAN (SINTETIS)",
  `Nama : ${VALUES[0]}`,
  `NIK : ${VALUES[1]}`,
  `No. KK : ${VALUES[2]}`,
  `NPWP : ${VALUES[3]}`,
  `Telp : ${VALUES[4]}`,
  `Email : ${VALUES[5]}`,
  `Kartu kredit : ${VALUES[6]}`,
  `Alamat : ${VALUES[7]}`,
  `Tanggal Lahir : ${VALUES[8]}`,
].join("\n");
const SOURCE_NAME = `KTP ${VALUES[0]} ${VALUES[1]}.txt`;

const leaks = (where: string, text: string) => PIECES.filter((p) => text.includes(p)).map((p) => `${where}: ${p}`);

function listen(context: BrowserContext) {
  const log: string[] = [];
  context.on("console", (m) => log.push(m.text()));
  context.on("weberror", (e) => log.push(String(e.error())));
  return log;
}

/** Everything a person or an extension could read from the page right now. */
const pageState = (page: Page) =>
  page.evaluate(async () => {
    const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].map((e) => e.value);
    const caches_: string[] = [];
    for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) caches_.push(r.url);
    return [
      document.documentElement.outerHTML,
      ...fields,
      document.title,
      location.href,
      JSON.stringify({ ...localStorage }),
      JSON.stringify({ ...sessionStorage }),
      document.cookie,
      (await indexedDB.databases()).map((d) => d.name).join(),
      JSON.stringify(history.state),
      window.name,
      ...caches_,
    ].join("\n");
  });

async function download(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  return { name: dl.suggestedFilename(), text: readFileSync((await dl.path())!, "utf8") };
}

async function openFile(page: Page, path: string, mode: "Samarkan" | "Tokenisasi untuk LLM") {
  await page.goto(`${BASE}/`);
  await page.locator('input[type="file"]').setInputFiles(path);
  await pickMode(page, mode);
  await page.getByRole("button", { name: "Pindai" }).click();
  await expect(page).toHaveURL(/#\/ruang-kerja$/, { timeout: 30_000 });
}

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

for (const mode of ["Samarkan", "Tokenisasi untuk LLM"] as const) {
  test(`${mode}: nothing hidden comes out, and clearing leaves nothing in the page`, async ({ page, context }, info) => {
    await allowClipboard(page, context);
    const log = listen(context);
    const source = info.outputPath(SOURCE_NAME);
    writeFileSync(source, DOC);
    await openFile(page, source, mode);
    await expect(page.getByRole("heading", { name: "9 temuan" })).toBeVisible();
    await page.getByRole("button", { name: "Lihat hasil" }).click();
    await expect(page.getByRole("button", { name: "Salin", exact: true })).toBeVisible();
    const found: string[] = [];
    const after = await region(page, "Sesudah").innerText();
    expect(after).toContain("SURAT KETERANGAN");
    found.push(...leaks("result pane", after));
    await page.getByRole("button", { name: "Salin", exact: true }).click();
    found.push(...leaks("clipboard", await page.evaluate(() => navigator.clipboard.readText())));
    const out = await download(page, () => page.getByRole("button", { name: "Unduh .txt" }).click());
    found.push(...leaks("download name", out.name), ...leaks("download", out.text), ...leaks("title", await page.title()));
    if (mode === "Samarkan") {
      expect(out.name).toBe("dokumen-samar.txt");
      await page.getByRole("radio", { name: "Blok" }).click();
      await expect(region(page, "Sesudah")).toContainText("█".repeat(8));
      found.push(...leaks("blok", await region(page, "Sesudah").innerText()));
    } else {
      expect(out.name).toBe("dokumen-bertoken.txt");
      // A token is the kind and a counter: nothing of the value, not even its length.
      expect(out.text.match(/\[\[[^\]]*\]\]/g)).toEqual(["NAMA", "NIK", "KK", "NPWP", "TELEPON", "EMAIL", "KARTU", "ALAMAT", "TGL_LAHIR"].map((k) => `[[${k}_1]]`));
      await page.getByRole("button", { name: "Simpan peta terenkripsi" }).click();
      const dlg = page.getByRole("dialog");
      await dlg.getByLabel("Frasa sandi", { exact: true }).fill("frasa uji yang panjang");
      await dlg.getByLabel("Ulangi frasa sandi").fill("frasa uji yang panjang");
      const map = await download(page, () => dlg.getByRole("button", { name: "Enkripsi dan unduh" }).click());
      expect(map.name).toBe("dokumen-peta.json");
      found.push(...leaks("map file", map.text), ...leaks("map name", map.name));
    }
    found.push(...leaks("toasts and result screen without the source pane", (await page.locator("body").innerText()).replace(await region(page, "Sebelum").innerText(), "")));

    await page.getByRole("button", { name: "Bersihkan sesi" }).click();
    await expect(page).toHaveURL(`${BASE}/#/bersih`);
    await expect(page.getByText(/Sesi dibersihkan/)).toBeVisible();
    for (const route of ["#/", "#/ruang-kerja", "#/pulihkan", "#/bantuan", "#/pdf", "#/"]) {
      await page.evaluate((r) => (location.hash = r), route);
      await expect(page.locator("main")).toBeVisible();
      found.push(...leaks(`after clearing, ${route}`, await pageState(page)));
    }
    found.push(...leaks("console", log.join("\n")));
    expect(found).toEqual([]);
  });
}

test("restore page: clearing works before any result and forgets the passphrase and the error", async ({ page }) => {
  await page.goto(`${BASE}/#/pulihkan`);
  await page.getByRole("textbox", { name: /Balasan atau teks bertoken/ }).fill(`[[NIK_1]] milik ${VALUES[0]}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "peta.json", mimeType: "application/json", buffer: Buffer.from('{"v":1,"kdf":"PBKDF2-SHA256","iter":1,"salt":"AAECAwQFBgcICQoLDA0ODw==","iv":"ZGVmZ2hpamtsbW5v","ct":"AAAAAAAAAAAAAAAAAAAAAA=="}') });
  await page.getByLabel("Frasa sandi peta").fill("frasa yang salah sekali");
  await page.getByRole("button", { name: "Buka peta" }).click();
  await expect(page.getByRole("alert")).toContainText("Peta tidak bisa dibuka");
  expect(leaks("error", await page.getByRole("alert").innerText())).toEqual([]);
  await page.getByRole("button", { name: "Bersihkan sesi" }).click();
  await expect(page).toHaveURL(`${BASE}/#/bersih`);
  await page.getByRole("link", { name: "Pulihkan" }).first().click();
  await expect(page.getByRole("textbox", { name: /Balasan atau teks bertoken/ })).toHaveValue("");
  await expect(page.getByLabel("Frasa sandi peta")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const state = await pageState(page);
  expect(leaks("restore page", state)).toEqual([]);
  expect(state).not.toContain("frasa yang salah");
});

test("a refused tokenisation names no value", async ({ page, context }) => {
  const log = listen(context);
  await page.goto(`${BASE}/`);
  await page.getByRole("textbox").fill(`[[NIK_1]] [[PRV-NIK_1]]\nNIK: ${VALUES[1]}`);
  await pickMode(page, "Tokenisasi untuk LLM");
  await page.getByRole("button", { name: "Pindai" }).click();
  await page.getByRole("button", { name: "Lihat hasil" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("tokenisasi ditolak");
  expect(leaks("error", await alert.innerText())).toEqual([]);
  expect(leaks("console", log.join("\n"))).toEqual([]);
});

test("clearing the session leaves no copy of the document in the JavaScript heap", async ({ page, context }, info) => {
  // No assertion here may hand a value to the page, or the test itself would put it in the heap.
  const source = info.outputPath("dokumen.txt");
  writeFileSync(source, DOC);
  test.skip(context.browser()?.browserType().name() !== "chromium", "heap snapshots need the Chromium debugging protocol");
  const cdp = await context.newCDPSession(page);
  const held = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    const chunks: string[] = [];
    const on = (e: { chunk: string }) => chunks.push(e.chunk);
    cdp.on("HeapProfiler.addHeapSnapshotChunk", on);
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
    cdp.off("HeapProfiler.addHeapSnapshotChunk", on);
    const heap = chunks.join("");
    return ["3171011505900001", "Rahayu Contoh Wiratama", "rahayu.contoh@example.test"].filter((v) => heap.includes(v));
  };
  await openFile(page, source, "Tokenisasi untuk LLM");
  await page.getByRole("button", { name: "Lihat hasil" }).click();
  await expect(page.getByRole("button", { name: "Salin", exact: true })).toBeVisible();
  expect(await held(), "control: the open document is in the heap").toHaveLength(3);
  await page.getByRole("button", { name: "Bersihkan sesi" }).click();
  await expect(page).toHaveURL(`${BASE}/#/bersih`);
  await expect(page.getByRole("textbox")).toHaveValue("");
  expect(await held()).toEqual([]);
});

test("offsets: emoji, astral, joined and combining characters and CRLF stay exact from file to output", async ({ page, context }, info) => {
  await allowClipboard(page, context);
  const lead = "👨‍👩‍👧 𝔘𝔫𝔦 é é 漢字 😀😀";
  const text = [
    `${lead} NIK: 3171011505900001 😀`,
    `😀Nama: André Contoh`,
    `𝔘 HP: 0813\u00a05550\u00a00177 🎉 surel rahayu.contoh@example.test🎉`,
    `akhir ${lead}`,
  ].join("\r\n");
  const source = info.outputPath("unicode.txt");
  writeFileSync(source, text);
  await openFile(page, source, "Samarkan");
  const marks = await region(page, "Isi dokumen").locator("mark").evaluateAll((els) => els.map((e) => e.textContent));
  expect(marks).toEqual(["3171011505900001", "André Contoh", "0813\u00a05550\u00a00177", "rahayu.contoh@example.test"]);
  // A hand made selection after astral characters maps to the same offsets.
  await page.evaluate(() => {
    const root = document.querySelector('[role=region][aria-label="Isi dokumen"]')!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let last: [Node, number] | null = null;
    while ((node = walker.nextNode())) {
      const i = (node.nodeValue ?? "").lastIndexOf("漢字");
      if (i >= 0) last = [node, i];
    }
    const r = document.createRange();
    r.setStart(last![0], last![1]);
    r.setEnd(last![0], last![1] + 2);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  });
  await page.getByRole("button", { name: "Hitamkan ini" }).click();
  await page.getByRole("button", { name: "Lihat hasil" }).click();
  await expect(page.getByRole("button", { name: "Unduh .txt" })).toBeVisible();
  const out = await download(page, () => page.getByRole("button", { name: "Unduh .txt" }).click());
  const want = text
    .replace("3171011505900001", "[NIK]")
    .replace("André Contoh", "[NAMA]")
    .replace("0813\u00a05550\u00a00177", "[TELEPON]")
    .replace("rahayu.contoh@example.test", "[EMAIL]")
    .replace(/漢字(?=[^漢]*$)/, "[DATA]");
  expect(out.text).toBe(want);
});
