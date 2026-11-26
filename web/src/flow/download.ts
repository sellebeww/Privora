// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Save a string as a file through a local Blob. No network, nothing stored.

export function downloadText(name: string, content: string, mime = "text/plain"): void {
  downloadBlob(name, new Blob([content], { type: `${mime};charset=utf-8` }));
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Copy text to the clipboard. Resolves false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
