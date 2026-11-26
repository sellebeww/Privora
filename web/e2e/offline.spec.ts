// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Offline use and updates of the production build in real Chromium. Each test serves its
// own copy of dist, so "offline" can mean that the server is really gone. All documents are invented (SINTETIS).
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { writeOfflineFiles } from "../offline-build";
import { NIK, scanText } from "./helpers";
import { fixtureBytes } from "./pdfFixture";

const WEB = resolve("."); // Playwright runs in web/
const PORT = 4178;
const BASE = `http://localhost:${PORT}`;
let dir = "";
let server: PreviewServer | null = null;

async function start() {
  server = await preview({ root: WEB, configFile: join(WEB, "vite.config.ts"), build: { outDir: dir }, preview: { port: PORT, strictPort: true } });
}
async function stop() {
  const s = server;
  server = null;
  if (!s) return;
  (s.httpServer as unknown as { closeAllConnections?(): void }).closeAllConnections?.();
  await new Promise<void>((done) => s.httpServer.close(() => done()));
}
test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "privora-dist-"));
  cpSync(join(WEB, "dist"), dir, { recursive: true });
  await start();
});
test.afterEach(async () => {
  await stop();
  rmSync(dir, { recursive: true, force: true });
});

/** Records what must never happen: a request elsewhere, a CSP violation, a page error. */
function watch(context: BrowserContext) {
  const bad: string[] = [];
  context.on("request", (r) => {
    if (!/^(data|blob):/.test(r.url()) && !r.url().startsWith(`${BASE}/`)) bad.push(`request ${r.url()}`);
  });
  context.on("console", (m) => {
    if (/Content Security Policy|Permissions-Policy|Permissions policy|Unrecognized feature/i.test(m.text())) bad.push(`console ${m.text()}`);
  });
  context.on("page", (p) => p.on("pageerror", (e) => bad.push(`pageerror ${e.message}`)));
  return bad;
}
const controlled = (page: Page) => page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });
const cacheNames = (page: Page) => page.evaluate(() => caches.keys());

test("every response carries the security headers", async ({ request }) => {
  for (const path of ["/", "/verify.html", "/sw.js", "/pdfjs/wasm/openjpeg.wasm"]) {
    const h = (await request.get(BASE + path)).headers();
    expect(h["content-security-policy"], path).toContain("default-src 'none'");
    expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["referrer-policy"], path).toBe("no-referrer");
    expect(h["permissions-policy"], path).toContain("camera=()");
  }
});

for (const from of ["the server", "the offline cache"] as const) {
  test(`the engine worker, loaded from ${from}, cannot reach another origin`, async ({ browser }) => {
    const context = await browser.newContext({ serviceWorkers: from === "the server" ? "block" : "allow" });
    const sent: string[] = [];
    context.on("request", (r) => void (r.url().startsWith(`${BASE}/`) || sent.push(r.url())));
    const page = await context.newPage();
    await page.goto(`${BASE}/`);
    if (from === "the offline cache") {
      await controlled(page);
      await stop();
      await page.reload();
    }
    const started = page.waitForEvent("worker", (w) => w.url().includes("/assets/worker-"));
    await scanText(page);
    const result = await (await started).evaluate(
      () =>
        new Promise<{ failed: boolean; directive: string | null }>((done) => {
          let directive: string | null = null;
          self.addEventListener("securitypolicyviolation", (e) => (directive = (e as SecurityPolicyViolationEvent).effectiveDirective));
          fetch("https://privora-probe.invalid/").then(
            () => done({ failed: false, directive }),
            () => setTimeout(() => done({ failed: true, directive }), 300),
          );
        }),
    );
    expect(result).toEqual({ failed: true, directive: "connect-src" });
    expect(sent).toEqual([]);
    await context.close();
  });
}

test("after one visit the whole app works with the server gone: text, PDF export, verify page", async ({ context }) => {
  const bad = watch(context);
  const first = await context.newPage();
  await first.goto(`${BASE}/`);
  await controlled(first);
  // Only the home page was visited: no scan, no PDF. Everything later must come from the precache.
  const cached = await first.evaluate(async () => {
    const urls: string[] = [];
    for (const n of await caches.keys()) urls.push(...(await (await caches.open(n)).keys()).map((r) => r.url));
    return urls.sort();
  });
  const files = (JSON.parse(readFileSync(join(dir, "hashes.json"), "utf8")) as { files: { path: string; served: boolean }[] }).files;
  expect(cached).toEqual([...files.filter((f) => f.served).map((f) => f.path), "hashes.json"].map((p) => `${BASE}/${p}`).sort());
  await first.close();

  await stop();
  await context.setOffline(true);
  const page = await context.newPage();
  await expect(page.request.get(`${BASE}/`)).rejects.toThrow(); // the server really is gone
  await page.goto(`${BASE}/`);
  await scanText(page);
  await page.getByRole("button", { name: "Lihat hasil" }).click();
  await expect(page.getByRole("button", { name: "Salin", exact: true })).toBeVisible();
  const [txt] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Unduh .txt" }).click()]);
  expect(readFileSync(await txt.path(), "utf8")).not.toContain(NIK);

  await page.goto(`${BASE}/`);
  await page.locator('input[type="file"]').setInputFiles({ name: "uji.pdf", mimeType: "application/pdf", buffer: Buffer.from(fixtureBytes()) });
  await expect(page).toHaveURL(/#\/pdf$/, { timeout: 60_000 });
  await expect(page.getByRole("img", { name: /^Pratinjau halaman 1 / })).toBeVisible();
  await page.getByRole("button", { name: "Ke pratinjau akhir" }).click();
  for (let i = 1; i <= 3; i += 1) await page.getByRole("img", { name: new RegExp(`^Pratinjau halaman ${i} `) }).scrollIntoViewIfNeeded();
  await expect(page.getByText("3 dari 3 halaman sudah dilihat")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("checkbox", { name: /Saya sudah memeriksa/ }).check();
  const [pdf] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByRole("button", { name: "Ekspor PDF" }).click()]);
  expect(readFileSync(await pdf.path()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.goto(`${BASE}/verify.html`);
  await expect(page.locator("#hashes")).toContainText("Mode offline aktif");
  await page.getByRole("button", { name: /Hitung ulang hash/ }).click();
  await expect(page.locator("#hashes")).toContainText(/Semua \d+ berkas yang disajikan cocok/, { timeout: 30_000 });
  expect(bad).toEqual([]);
});

/** Publish a "new version" into the served directory, the way a redeploy would. */
function deploy() {
  appendFileSync(join(dir, "index.html"), "<!-- v2 -->\n");
  writeOfflineFiles(dir, readFileSync(join(WEB, "src/offline/sw.js"), "utf8"));
}
const checkForUpdate = (page: Page) => page.evaluate(async () => void (await (await navigator.serviceWorker.ready).update()));
const banner = (page: Page) => page.getByRole("button", { name: "Muat ulang sekarang" });
const mark = (page: Page) => page.evaluate(() => void ((window as unknown as { __same?: boolean }).__same = true));
const sameDocument = (page: Page) => page.evaluate(() => (window as unknown as { __same?: boolean }).__same === true);

test("a new version waits for consent: banner, no reload, session kept until the button is pressed", async ({ context }) => {
  const bad = watch(context);
  const page = await context.newPage();
  await page.goto(`${BASE}/`);
  await controlled(page);
  await expect(banner(page)).toHaveCount(0);
  const [before] = await cacheNames(page);
  await page.getByRole("textbox").fill("teks sesi sintetis");
  await mark(page);

  deploy();
  await checkForUpdate(page);
  await expect(banner(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Memuat ulang menghapus dokumen, temuan, dan peta di sesi ini.")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await sameDocument(page)).toBe(true);
  await expect(page.getByRole("textbox")).toHaveValue("teks sesi sintetis");
  expect(await cacheNames(page)).toHaveLength(2); // old version still serves, new one waits
  await page.screenshot({ path: "test-results/screenshots/update.png" });

  await Promise.all([page.waitForEvent("load"), banner(page).click()]);
  expect(await sameDocument(page)).toBe(false);
  await expect.poll(() => cacheNames(page)).toHaveLength(1);
  expect((await cacheNames(page))[0]).not.toBe(before);
  await expect(banner(page)).toHaveCount(0);
  expect(await page.evaluate(async () => (await caches.match(`${location.origin}/index.html`))!.text())).toContain("<!-- v2 -->");
  expect(bad).toEqual([]);
});

test("accepting in one tab never reloads another tab; 'Nanti' only hides the banner", async ({ context }) => {
  const a = await context.newPage();
  await a.goto(`${BASE}/`);
  await controlled(a);
  const b = await context.newPage();
  await b.goto(`${BASE}/`);
  await controlled(b);
  await mark(b);
  deploy();
  await checkForUpdate(a);
  await expect(banner(a)).toBeVisible({ timeout: 30_000 });
  await expect(banner(b)).toBeVisible({ timeout: 30_000 });
  await Promise.all([a.waitForEvent("load"), banner(a).click()]);
  await b.waitForTimeout(1500);
  expect(await sameDocument(b)).toBe(true);
  expect(await cacheNames(b)).toHaveLength(2); // kept for the tab still on the old version
  await b.getByRole("button", { name: "Nanti" }).click();
  await expect(banner(b)).toHaveCount(0);
  expect(await sameDocument(b)).toBe(true);
});

test("verify.html reports a file that differs from the manifest", async ({ browser }) => {
  appendFileSync(join(dir, "favicon.svg"), "<!-- changed -->");
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto(`${BASE}/verify.html`);
  await page.getByRole("button", { name: /Hitung ulang hash/ }).click();
  await expect(page.locator("#hashes")).toContainText("1 berkas berbeda dan 0 tidak bisa dibaca", { timeout: 30_000 });
  await expect(page.locator("#hashes")).toContainText("Mode offline belum aktif");
  await context.close();
});
