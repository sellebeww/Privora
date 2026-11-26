// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Try to get data out of the running app by every route the policy is
// meant to close, and watch the network. The attempts are made from inside the page, as injected code
// would make them. What CSP does NOT cover (navigation, WebRTC, resource hints) is left to the static
// check and to reading the code.
import { expect, test } from "@playwright/test";

const BASE = "http://localhost:4177";
const OUT = "https://privora-probe.invalid";

const ATTEMPTS = ["fetch", "xhr", "websocket", "eventsource", "beacon", "image", "script", "inline script", "stylesheet", "style attribute", "frame", "object", "form", "blob worker", "base"] as const;

test("every blocked route raises a violation and nothing leaves", async ({ context, page }) => {
  const reached: string[] = [];
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (!url.startsWith(`${BASE}/`)) reached.push(url);
    return url.startsWith(`${BASE}/`) ? route.continue() : route.abort();
  });
  await page.goto(`${BASE}/`);
  await page.locator("main").waitFor();
  const results = await page.evaluate(
    async ({ out, names }) => {
      const seen: string[] = [];
      document.addEventListener("securitypolicyviolation", (e) => seen.push(e.effectiveDirective));
      const add = (tag: string, set: (e: HTMLElement) => void) => {
        const e = document.createElement(tag);
        set(e);
        document.body.append(e);
      };
      const run: Record<string, () => unknown> = {
        fetch: () => fetch(`${out}/f`),
        xhr: () => {
          const x = new XMLHttpRequest();
          x.open("GET", `${out}/x`);
          x.send();
        },
        websocket: () => new WebSocket(out.replace("https", "wss")),
        eventsource: () => new EventSource(`${out}/e`),
        beacon: () => navigator.sendBeacon(`${out}/b`, "d"),
        image: () => add("img", (e) => e.setAttribute("src", `${out}/i.png`)),
        script: () => add("script", (e) => e.setAttribute("src", `${out}/s.js`)),
        "inline script": () => add("script", (e) => (e.textContent = "window.__ran = true")),
        stylesheet: () =>
          add("link", (e) => {
            e.setAttribute("rel", "stylesheet");
            e.setAttribute("href", `${out}/c.css`);
          }),
        "style attribute": () => add("div", (e) => e.setAttribute("style", `background:url(${out}/bg.png)`)),
        frame: () => add("iframe", (e) => e.setAttribute("src", `${out}/frame`)),
        object: () => add("object", (e) => e.setAttribute("data", `${out}/o`)),
        form: () => {
          const f = document.createElement("form");
          f.action = `${out}/form`;
          f.method = "post";
          document.body.append(f);
          f.submit();
        },
        "blob worker": () => new Worker(URL.createObjectURL(new Blob([`fetch("${out}/w")`], { type: "text/javascript" }))),
        base: () => add("base", (e) => e.setAttribute("href", `${out}/`)),
      };
      const got: Record<string, string> = {};
      for (const name of names) {
        const before = seen.length;
        try {
          const r = run[name]!();
          if (r instanceof Promise) await r.catch(() => undefined);
        } catch {
          // a synchronous refusal also counts; the violation event is what is checked
        }
        for (let i = 0; i < 40 && seen.length === before; i += 1) await new Promise((res) => setTimeout(res, 25));
        got[name] = seen[before] ?? "NOT BLOCKED";
      }
      return { got, ran: (window as unknown as { __ran?: boolean }).__ran === true, here: location.href };
    },
    { out: OUT, names: [...ATTEMPTS] },
  );
  expect(Object.entries(results.got).filter(([, d]) => d === "NOT BLOCKED")).toEqual([]);
  expect(results.ran).toBe(false);
  expect(results.here).toBe(`${BASE}/`);
  expect(reached).toEqual([]);
});
