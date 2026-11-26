// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-chip border border-border-strong bg-bg-elevated px-2 font-mono text-small text-fg-muted">
      {children}
    </kbd>
  );
}
