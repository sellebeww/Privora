// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import type { ReactNode } from "react";

/** A scrolling data table. The wrapper is focusable so the keyboard can scroll it. */
export function Table({ label, head, children }: { label: string; head: readonly string[]; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="max-h-[var(--size-doc)] overflow-auto rounded-panel border border-border">
      <table className="w-full border-collapse text-left text-small">
        <thead className="sticky top-0 bg-bg-elevated">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="border-b border-border px-3 py-2 font-medium text-fg-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top">{children}</tbody>
      </table>
    </div>
  );
}

/** Machine text (commands, policies, hashes): mono, wraps instead of widening the page. */
export function CodeBlock({ label, children }: { label: string; children: string }) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-small text-fg-muted">{label}</figcaption>
      <pre className="rounded-control border border-border bg-surface p-3 font-mono text-small break-all whitespace-pre-wrap text-fg">{children}</pre>
    </figure>
  );
}
