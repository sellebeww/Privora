// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Component behaviour in real Chromium against the dev-only gallery at /dev/ui: keyboard, focus, states, token usage.
import { expect, test, type Page } from "@playwright/test";
import { audit } from "./audit";

const URL = "http://localhost:4176/dev/ui";
const sec = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await page.goto(URL);
  await page.getByTestId("gallery").waitFor();
});

test("tabs: arrows, Home and End move focus and selection", async ({ page }) => {
  const tabs = sec(page, "Tabs");
  const [a, b, c] = [tabs.getByRole("tab", { name: "Satu" }), tabs.getByRole("tab", { name: "Dua" }), tabs.getByRole("tab", { name: "Tiga" })];
  await a.focus();
  await page.keyboard.press("ArrowRight");
  await expect(b).toBeFocused();
  await expect(b).toHaveAttribute("aria-selected", "true");
  await expect(tabs.getByRole("tabpanel")).toHaveText("Isi dua");
  await page.keyboard.press("End");
  await expect(c).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(a).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(c).toBeFocused();
  await page.keyboard.press("Home");
  await expect(a).toBeFocused();
  await expect(tabs.getByRole("tab", { selected: false })).toHaveCount(2);
});

test("dialog: modal, focus stays inside, Escape closes, focus returns to the opener", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Buka dialog" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dlg = page.getByRole("dialog", { name: "Judul dialog" });
  await expect(dlg).toBeVisible();
  await expect(dlg).toHaveAccessibleDescription("Deskripsi singkat.");
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    // Native modal: the page behind is inert. Focus may reach the browser UI (activeElement is body), never the page.
    expect(await page.evaluate(() => !!document.activeElement?.closest("dialog") || document.activeElement === document.body)).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(opener).toBeFocused();
  // Backdrop click closes too.
  await opener.click();
  await expect(dlg).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dlg).toBeHidden();
});

test("tooltip: shows on focus and hover, hides on Escape, is described-by", async ({ page }) => {
  const btn = page.getByRole("button", { name: "Dengan tooltip" });
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeHidden();
  await btn.focus();
  await expect(tip).toBeVisible();
  await expect(btn).toHaveAccessibleDescription("Teks bantuan");
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await page.getByRole("heading", { name: "Galeri komponen" }).hover();
  await btn.hover();
  await expect(tip).toBeVisible();
});

test("switch and checkbox toggle with the keyboard; disabled ones are skipped", async ({ page }) => {
  const sw = page.getByRole("switch", { name: "Mode toleran" });
  await sw.focus();
  await page.keyboard.press("Space");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Enter");
  await expect(sw).toHaveAttribute("aria-checked", "false");
  const cb = sec(page, "Switch dan Checkbox").getByRole("checkbox", { name: "Pilih" });
  await cb.focus();
  await expect(cb).toBeChecked();
  await page.keyboard.press("Space");
  await expect(cb).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "Nonaktif" })).toBeDisabled();
  await expect(sec(page, "Switch dan Checkbox").getByRole("checkbox", { name: "Nonaktif" })).toBeDisabled();
});

test("focus ring is a 2px accent outline with a 2px offset", async ({ page }) => {
  const b = page.getByRole("button", { name: "Utama 36" });
  await page.keyboard.press("Tab"); // move into the page by keyboard so :focus-visible applies
  await b.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  // The outline colour transitions (140ms), so poll until it settles.
  await expect
    .poll(() =>
      b.evaluate((e) => {
        const s = getComputedStyle(e);
        return { w: s.outlineWidth, st: s.outlineStyle, c: s.outlineColor, o: s.outlineOffset };
      }),
    )
    .toEqual({ w: "2px", st: "solid", c: "rgb(163, 230, 53)", o: "2px" });
});

test("button heights are 32 and 36, disabled buttons cannot take focus", async ({ page }) => {
  const h = (n: string) => page.getByRole("button", { name: n, exact: true }).first().evaluate((e) => e.getBoundingClientRect().height);
  expect(await h("Utama 36")).toBe(36);
  expect(await h("Utama 32")).toBe(32);
  const dis = sec(page, "Button").getByRole("button", { name: "Nonaktif" }).first();
  await expect(dis).toBeDisabled();
  await dis.focus();
  await expect(dis).not.toBeFocused();
});

test("field: invalid input is announced and has a danger border", async ({ page }) => {
  const inp = page.getByLabel("Frasa sandi");
  await expect(inp).toHaveAttribute("aria-invalid", "true");
  await expect(inp).toHaveAccessibleDescription(/Minimal 12 karakter/);
  expect(await inp.evaluate((e) => getComputedStyle(e).borderTopColor)).toBe("rgb(248, 113, 113)");
  await expect(page.getByLabel("Nonaktif", { exact: true }).first()).toBeDisabled();
});

test("findings list: J/K, Space, Enter and A work from the keyboard", async ({ page }) => {
  const list = sec(page, "Daftar temuan");
  const rows = list.locator("li[tabindex]");
  await expect(list.getByText("1 dari 2 dipilih")).toBeVisible();
  await rows.first().focus();
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(list.getByText("2 dari 2 dipilih")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(list.getByText("1 dari 2 dipilih")).toBeVisible();
  await page.keyboard.press("k");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("a");
  await expect(list.getByText("2 dari 2 dipilih")).toBeVisible();
  // A key typed inside a control must not trigger list shortcuts.
  await rows.first().getByRole("checkbox").focus();
  await page.keyboard.press("j");
  await expect(rows.first().getByRole("checkbox")).toBeFocused();
});

test("toast appears in a polite live region and closes by button", async ({ page }) => {
  await page.getByRole("button", { name: "Toast galat" }).click();
  const live = page.getByRole("status").filter({ hasText: "Sesuatu gagal" });
  await expect(live).toBeVisible();
  await expect(live).toContainText("Galat:");
  await live.getByRole("button", { name: "Tutup pesan" }).click();
  await expect(live).toBeHidden();
});

test("reduced motion switches transitions off", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const d = await page.getByRole("button", { name: "Utama 36" }).evaluate((e) => getComputedStyle(e).transitionDuration);
  expect(d).toBe("0s");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await page.getByRole("button", { name: "Utama 36" }).evaluate((e) => getComputedStyle(e).transitionDuration)).toBe("0.14s");
});

test("rendered styles stay inside the tokens: radii, shadows and colours", async ({ page }) => {
  const r = await page.evaluate(() => {
    const probe = (v: string) => {
      const e = document.createElement("i");
      e.style.color = `var(${v})`;
      document.body.append(e);
      const c = getComputedStyle(e).color;
      e.remove();
      return c;
    };
    const tokens = ["--bg", "--bg-elevated", "--surface", "--surface-hover", "--border", "--border-strong", "--text", "--text-muted", "--text-subtle", "--accent", "--accent-hover", "--accent-ink", "--accent-subtle", "--accent-border", "--danger", "--warning"];
    const ok = new Set(tokens.map(probe));
    ok.add("rgba(0, 0, 0, 0)");
    const radii = new Set<string>();
    const shadows = new Set<string>();
    const bad = new Set<string>();
    for (const e of document.querySelectorAll("body *")) {
      const s = getComputedStyle(e);
      for (const p of ["borderTopLeftRadius", "borderBottomRightRadius"] as const) radii.add(s[p]);
      if (s.boxShadow !== "none") shadows.add(s.boxShadow);
      for (const p of ["color", "backgroundColor", "borderTopColor", "outlineColor"] as const) {
        const hasBorder = p !== "borderTopColor" || s.borderTopWidth !== "0px";
        const hasOutline = p !== "outlineColor" || s.outlineStyle !== "none";
        // The ::backdrop and SVG paints are outside this walk; fill is checked below.
        if (hasBorder && hasOutline && !ok.has(s[p])) bad.add(`${p}=${s[p]}`);
      }
      for (const p of ["fill", "stroke"] as const) if (e instanceof SVGElement && e.tagName !== "svg" && s[p] !== "none" && s[p].startsWith("rgb") && !ok.has(s[p])) bad.add(`${p}=${s[p]}`);
    }
    return { radii: [...radii].sort(), shadows: [...shadows], bad: [...bad] };
  });
  expect(r.shadows).toEqual([]);
  expect(r.radii).toEqual(["0px", "12px", "6px", "8px"].sort());
  expect(r.bad).toEqual([]);
});

test("gallery structural a11y audit has no findings", async ({ page }) => {
  expect(await audit(page)).toEqual([]);
});
