// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { cloneElement, useEffect, useId, useState, type ReactElement } from "react";

/** Text tooltip for one focusable child: shown on hover and focus, hidden on Escape and blur. */
export function Tooltip({ text, children }: { text: string; children: ReactElement<Record<string, unknown>> }) {
  const [open, setOpen] = useState(false);
  const tid = useId();
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open]);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {cloneElement(children, { "aria-describedby": [children.props["aria-describedby"], tid].filter(Boolean).join(" ") })}
      <span
        id={tid}
        role="tooltip"
        hidden={!open}
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 rounded-chip border border-border-strong bg-surface px-2 py-1 text-small whitespace-nowrap text-fg"
      >
        {text}
      </span>
    </span>
  );
}
