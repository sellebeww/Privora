// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// A small structural accessibility audit run inside the page: names, ids, references, headings, landmarks
// and the project's own 32 px target rule. axe-core runs separately (audit-a11y.spec.ts).
import type { Page } from "@playwright/test";

export async function audit(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const vis = (e: Element) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const text = (e: Element | null) => (e?.textContent ?? "").trim();
    const name = (e: Element): string => {
      const lb = e.getAttribute("aria-labelledby");
      if (lb) return lb.split(/\s+/).map((i) => text(document.getElementById(i))).join(" ").trim();
      const al = e.getAttribute("aria-label");
      if (al) return al.trim();
      if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) {
        const l = e.labels?.[0];
        if (l) return text(l);
      }
      return text(e) || (e.getAttribute("title") ?? "").trim();
    };
    if (!document.documentElement.lang) problems.push("html has no lang");
    if (!document.title) problems.push("no <title>");
    if (document.querySelectorAll("main").length !== 1) problems.push("expected exactly one <main>");
    const hs = [...document.querySelectorAll("h1,h2,h3,h4")].filter(vis).map((h) => +h.tagName[1]!);
    if (hs.filter((l) => l === 1).length !== 1) problems.push(`expected one h1, found ${hs.filter((l) => l === 1).length}`);
    hs.forEach((l, i) => {
      if (i > 0 && l - hs[i - 1]! > 1) problems.push(`heading level jumps ${hs[i - 1]} -> ${l}`);
    });
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    for (const d of new Set(ids.filter((v, i) => ids.indexOf(v) !== i))) problems.push(`duplicate id ${d}`);
    for (const e of document.querySelectorAll("[aria-labelledby],[aria-describedby],[aria-controls]")) {
      for (const a of ["aria-labelledby", "aria-describedby", "aria-controls"]) {
        for (const i of (e.getAttribute(a) ?? "").split(/\s+/).filter(Boolean)) {
          if (!document.getElementById(i)) problems.push(`${a} points to missing #${i}`);
        }
      }
    }
    for (const e of document.querySelectorAll("button,a[href],input,textarea,select,[role=tab],[role=switch]")) {
      const hidden = e.getAttribute("aria-hidden") === "true" || (e as HTMLElement).tabIndex < 0 && e.classList.contains("sr-only");
      if (hidden) continue;
      if (!name(e)) problems.push(`no accessible name: <${e.tagName.toLowerCase()} class="${e.className.toString().slice(0, 40)}">`);
      if (vis(e) && !e.classList.contains("sr-only") && e.tagName !== "A") {
        // A native checkbox or radio is only as tall as its box; its label is the target.
        const box = e instanceof HTMLInputElement && (e.type === "checkbox" || e.type === "radio");
        const r = (box ? e.closest("label") : null)?.getBoundingClientRect() ?? e.getBoundingClientRect();
        if (r.height < 32) problems.push(`target under 32px high: ${name(e)} (${Math.round(r.height)})`);
      }
    }
    for (const e of document.querySelectorAll("img")) if (!e.hasAttribute("alt")) problems.push("img without alt");
    for (const e of document.querySelectorAll("svg:not([aria-hidden])")) if (!name(e)) problems.push("svg neither hidden nor named");
    return problems;
  });
}
