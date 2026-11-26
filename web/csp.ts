// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Single source of the Content-Security-Policy. Used for the
// <meta> tags, the generated _headers file and the preview server, so they can never drift apart.

export interface CspOptions {
  /** Keep `blob:` in worker-src and img-src. Not needed: the app passes false. */
  blob: boolean;
  /** Allow compiling WebAssembly. Off for verify.html, which runs no wasm. */
  wasm?: boolean;
}

export function buildCsp({ blob, wasm = true }: CspOptions): string {
  const b = blob ? " blob:" : "";
  return [
    "default-src 'none'",
    `script-src 'self'${wasm ? " 'wasm-unsafe-eval'" : ""}`,
    "style-src 'self'",
    "font-src 'self'",
    `img-src 'self'${b}`,
    "connect-src 'self'",
    `worker-src 'self'${b}`,
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** Browser features the app never uses. Clipboard write is not listed: the copy buttons need it. */
const UNUSED_FEATURES = [
  "accelerometer", "camera", "display-capture", "encrypted-media", "fullscreen", "geolocation", "gyroscope",
  "magnetometer", "microphone", "midi", "payment", "picture-in-picture", "publickey-credentials-get",
  "screen-wake-lock", "usb", "xr-spatial-tracking",
];

/** Response headers for every file. `frame-ancestors` only works as a header, never in <meta>. */
export function securityHeaders(opts: CspOptions): Record<string, string> {
  return {
    "Content-Security-Policy": `${buildCsp(opts)}; frame-ancestors 'none'`,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": UNUSED_FEATURES.map((f) => `${f}=()`).join(", "),
  };
}
