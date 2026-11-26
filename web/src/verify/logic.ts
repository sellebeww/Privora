// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Logic of verify.html. No network calls here: readers are passed in (see net.ts).

export interface ManifestFile {
  path: string;
  sha256: string;
  bytes: number;
  served: boolean;
}
export type FileStatus = "SAMA" | "BEDA" | "TIDAK_TERBACA" | "TIDAK_DISAJIKAN";
export interface FileRow {
  path: string;
  expected: string;
  actual: string | null;
  status: FileStatus;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A relative path inside the build: no scheme, no leading slash, no backslash, no "..". */
const insideBuild = (p: string) => !/^[a-z][a-z0-9+.-]*:|^\/|\\|(^|\/)\.\.(\/|$)/i.test(p) && p.length > 0;

export function parseManifest(value: unknown): ManifestFile[] | null {
  const files = (value as { files?: unknown } | null)?.files;
  if (!Array.isArray(files) || files.length === 0) return null;
  const ok = files.every((f: Partial<ManifestFile> | null) =>
    typeof f?.path === "string" && insideBuild(f.path) && typeof f.sha256 === "string" && /^[0-9a-f]{64}$/.test(f.sha256) &&
    typeof f.bytes === "number" && typeof f.served === "boolean",
  );
  return ok ? (files as ManifestFile[]) : null;
}

/** One file at a time, so progress is real and memory stays small. */
export async function checkFiles(
  files: ManifestFile[],
  read: (path: string) => Promise<ArrayBuffer>,
  onProgress: (done: number) => void = () => undefined,
): Promise<FileRow[]> {
  const rows: FileRow[] = [];
  for (const f of files) {
    let actual: string | null = null;
    let status: FileStatus = "TIDAK_DISAJIKAN";
    if (f.served) {
      try {
        actual = await sha256Hex(await read(f.path));
        status = actual === f.sha256 ? "SAMA" : "BEDA";
      } catch {
        status = "TIDAK_TERBACA";
      }
    }
    rows.push({ path: f.path, expected: f.sha256, actual, status });
    onProgress(rows.length);
  }
  return rows;
}

export type UrlKind = "SAMA_ORIGIN" | "LOKAL" | "LUAR";

/** data: and same-origin blob: never leave the device. Everything unknown counts as external. */
export function classifyUrl(url: string, origin: string): UrlKind {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "LUAR";
  }
  if (u.protocol === "data:") return "LOKAL";
  if (u.protocol === "blob:") return u.origin === origin ? "LOKAL" : "LUAR";
  return u.origin === origin ? "SAMA_ORIGIN" : "LUAR";
}

export function metaCsp(html: string): string | null {
  return /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html)?.[1] ?? null;
}

/** True when at least one of the (comma joined) policies allows connections to this origin only, or none. */
export function confinesConnections(csp: string): boolean {
  return csp.split(",").some((policy) => {
    const directives = new Map(
      policy.split(";").map((d) => {
        const [name = "", ...sources] = d.trim().split(/\s+/);
        return [name.toLowerCase(), sources] as const;
      }),
    );
    const sources = directives.get("connect-src") ?? directives.get("default-src");
    return sources !== undefined && sources.every((s) => s === "'self'" || s === "'none'");
  });
}

/** `.invalid` is reserved and never resolves (RFC 2606): even without CSP nothing could receive the request. */
export const PROBE_URL = "https://privora-probe.invalid/";

export interface ProbeResult {
  blockedByCsp: boolean;
  directive: string | null;
  requestFailed: boolean;
}

/** Only a `securitypolicyviolation` event proves CSP blocked the request: a failed request alone does not. */
export async function runProbe(target: EventTarget, send: () => Promise<unknown>, waitMs = 1000): Promise<ProbeResult> {
  let directive: string | null = null;
  let seen: () => void = () => undefined;
  const violation = new Promise<void>((resolve) => (seen = resolve));
  const listen = (e: Event) => {
    const v = e as Event & { blockedURI?: string; effectiveDirective?: string };
    if (!v.blockedURI?.startsWith(new URL(PROBE_URL).origin)) return;
    directive = v.effectiveDirective ?? "";
    seen();
  };
  target.addEventListener("securitypolicyviolation", listen);
  const requestFailed = await send().then(
    () => false,
    () => true,
  );
  // The event is queued and may arrive after the request has already failed.
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([violation, new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs)))]);
  clearTimeout(timer);
  target.removeEventListener("securitypolicyviolation", listen);
  return { blockedByCsp: directive !== null, directive, requestFailed };
}
