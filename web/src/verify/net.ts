// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// The only network calls of verify.html. check-no-network.mjs allows exactly these two.
import { PROBE_URL } from "./logic.ts";

/** Read one file of this build. Anything outside this origin is refused before a request is made. */
export async function readBuildFile(path: string): Promise<Response> {
  const url = new URL(path, document.baseURI);
  if (url.origin !== location.origin) throw new Error("outside this origin");
  const res = await fetch(url);
  if (!res.ok) throw new Error("unreadable");
  return res;
}

/** The live test: ask for an external address on purpose. It carries nothing, and CSP must stop it. */
export const sendProbe = () => fetch(PROBE_URL, { credentials: "omit", referrerPolicy: "no-referrer" });
