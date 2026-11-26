// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { renderToStaticMarkup as html } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionProvider } from "../flow/session";
import { PdfProvider } from "../pdf/session";
import { id } from "../i18n/id";
import { ToastProvider } from "../ui";
import { detectFeatures, isSupported } from "./features";
import { Help } from "./Help";
import { Home } from "./Home";
import { Shell } from "./Shell";
import { LoadError, PdfLoading, Unsupported, WasmLoading } from "./States";
import { Verify } from "./Verify";
import { Restore } from "./Restore";
import { Workspace } from "./Workspace";

const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);

describe("i18n catalogue", () => {
  const all = strings(id);
  it("has no em dash", () => expect(all.filter((s) => s.includes(String.fromCharCode(0x2014)))).toEqual([]));
  it("has no forbidden claims", () => {
    const bad = /100 ?persen|\banonim\b|dijamin|sesuai UU PDP/i;
    expect(all.filter((s) => bad.test(s))).toEqual([]);
  });
  it("has the five honest statements with their key points", () => {
    const t = id.honest.items;
    expect(t).toHaveLength(5);
    expect(t[0]).toMatch(/tidak sempurna/);
    expect(t[1]).toMatch(/pseudonimisasi/);
    expect(t[2]).toMatch(/ekstensi browser, malware, atau riwayat clipboard/);
    expect(t[3]).toMatch(/SINTETIS/);
    expect(t[4]).toMatch(/OCR/);
  });
});

describe("pages", () => {
  const page = (n: React.ReactNode) => html(<ToastProvider><SessionProvider><PdfProvider><Shell>{n}</Shell></PdfProvider></SessionProvider></ToastProvider>);
  it("shell: top bar landmarks, skip link, status chip links to verify.html, help link", () => {
    const m = page(<p>x</p>);
    expect(m).toContain("<header");
    expect(m).toContain('href="verify.html"');
    expect(m).toContain(id.status.local);
    expect(m).toContain('href="./#/bantuan"');
    expect(m).toContain('id="main"');
    expect(m).toContain(id.skipToContent);
    expect(m).toContain("<svg");
  });
  it("home: tagline, paste area, three modes, honest note, glow", () => {
    const m = page(<Home />);
    expect(m).toContain(id.tagline);
    expect(m).toContain("<textarea");
    for (const k of ["mask", "tokenize", "restore"] as const) expect(m).toContain(id.modes[k].name);
    expect(m.match(/type="radio"/g)).toHaveLength(3);
    expect(m).toContain(id.honest.short);
    expect(m).toContain("landing-glow");
    expect(m).toContain('<h1');
  });
  it("help: all five honest statements and the shortcut table", () => {
    const m = html(<Help />).replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
    for (const s of id.honest.items) expect(m).toContain(s);
    expect(m).toContain("<kbd");
    expect(m).toContain("Nama tanpa label tidak terdeteksi");
  });
  it("verify: honest statements, independence note and its six parts", () => {
    const m = html(<Verify />).replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
    expect(m).toContain(id.verify.honestNote);
    for (const s of id.honest.items) expect(m).toContain(s);
    for (const k of ["csp", "probe", "resources", "hashes", "repro", "manual"] as const) expect(m).toContain(id.verify[k].title);
    expect(m).toContain(id.verify.probe.run);
    expect(m).toContain("node scripts/hash-dist.mjs web/dist");
  });
  it("no update banner until a new version is waiting", () => {
    expect(page(<p>x</p>)).not.toContain(id.update.title);
  });
  it("workspace without a document: empty state with a way back, no sample data", () => {
    const m = page(<Workspace />);
    expect(m).toContain(id.workspace.empty);
    expect(m).toContain(id.workspace.toHome);
    expect(m).not.toContain('role="tab"');
  });
  it("restore page: reply field, map source, both modes, honest sensitivity note", () => {
    const m = page(<Restore />);
    expect(m).toContain("<textarea");
    expect(m).toContain(id.restore.fromFile);
    expect(m).toContain(id.restore.strict);
    expect(m).toContain(id.restore.tolerant);
    expect(m).toContain(id.restore.noSessionMap);
  });
});

describe("states", () => {
  it("wasm and pdf loading are live regions with a progress bar", () => {
    for (const m of [html(<WasmLoading />), html(<PdfLoading />)]) {
      expect(m).toContain('role="status"');
      expect(m).toContain('role="progressbar"');
    }
  });
  it("load error is an alert with a retry button", () => {
    const m = html(<LoadError onRetry={() => {}} />);
    expect(m).toContain('role="alert"');
    expect(m).toContain(id.states.retry);
  });
  it("unsupported lists every feature with a text status", () => {
    const m = html(<Unsupported features={{ wasm: true, worker: false, crypto: true, blob: true }} />);
    expect(m).toContain(id.states.missing);
    expect(m.match(new RegExp(id.states.present, "g"))).toHaveLength(3);
  });
});

describe("feature detection", () => {
  class OkWorker {
    onerror: unknown;
    constructor(u: string, o: { type?: string }) {
      void u;
      void o.type;
    }
    terminate() {}
  }
  const full = { WebAssembly: {}, Worker: OkWorker, crypto: { subtle: {} }, Blob: function Blob() {}, URL: { createObjectURL() {} } };
  it("accepts a complete environment", () => {
    const f = detectFeatures(full);
    expect(f).toEqual({ wasm: true, worker: true, crypto: true, blob: true });
    expect(isSupported(f)).toBe(true);
  });
  it("reports each missing piece", () => {
    expect(detectFeatures({ ...full, WebAssembly: undefined }).wasm).toBe(false);
    expect(detectFeatures({ ...full, crypto: {} }).crypto).toBe(false);
    expect(detectFeatures({ ...full, Worker: undefined }).worker).toBe(false);
    expect(detectFeatures({}).blob).toBe(false);
    expect(isSupported(detectFeatures({}))).toBe(false);
  });
  it("a Worker that ignores the module option counts as unsupported", () => {
    class Old {
      constructor(u: string) {
        void u;
      }
      terminate() {}
    }
    expect(detectFeatures({ ...full, Worker: Old }).worker).toBe(false);
  });
  it("a Worker constructor that throws after reading the option still counts", () => {
    class Throws {
      constructor(u: string, o: { type?: string }) {
        void u;
        void o.type;
        throw new Error("csp");
      }
    }
    expect(detectFeatures({ ...full, Worker: Throws }).worker).toBe(true);
  });
});
