// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { id } from "../i18n/id";

/** Own mark: a redaction bar over a text line with one small lime dot. */
export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-fg">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <rect x="1.5" y="1.5" width="17" height="17" rx="4" className="fill-none stroke-fg-muted" strokeWidth="1.5" />
        <rect x="5" y="7" width="10" height="3" rx="1" className="fill-fg" />
        <circle cx="14" cy="14" r="1.75" className="fill-accent" />
      </svg>
      <span className="text-title-3 font-semibold tracking-title">{id.appName}</span>
    </span>
  );
}
