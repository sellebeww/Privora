// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import type { ReactNode } from "react";
import { cx } from "./cx";

export interface StatusChipProps {
  tone?: "local" | "warning" | "danger";
  href?: string;
  children: ReactNode;
}

const TONE = {
  local: { box: "border-accent-border bg-accent-subtle text-accent", dot: "bg-accent" },
  warning: { box: "border-warning text-warning", dot: "bg-warning" },
  danger: { box: "border-danger text-danger", dot: "bg-danger" },
} as const;

/** Status with a dot and a text, so the state is readable without colour. */
export function StatusChip({ tone = "local", href, children }: StatusChipProps) {
  const t = TONE[tone];
  const cls = cx(
    "inline-flex h-8 items-center gap-2 rounded-chip border px-3 text-small transition-colors",
    t.box,
    href && "hover:bg-surface-hover",
  );
  const inner = (
    <>
      <span aria-hidden="true" className={cx("h-2 w-2 rounded-chip", t.dot)} />
      {children}
    </>
  );
  return href ? (
    <a href={href} className={cls}>
      {inner}
    </a>
  ) : (
    <span className={cls}>{inner}</span>
  );
}
