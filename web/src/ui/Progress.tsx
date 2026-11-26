// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { cx } from "./cx";

export interface ProgressProps {
  /** 0 to 100. Omit for an indeterminate bar. */
  value?: number;
  label: string;
}

export function Progress({ value, label }: ProgressProps) {
  const known = typeof value === "number" && Number.isFinite(value);
  const pct = known ? Math.min(100, Math.max(0, Math.round(value))) : undefined;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-2 w-full overflow-hidden rounded-chip border border-border bg-bg-elevated"
    >
      {pct === undefined ? (
        <div className="bar-indeterminate h-full w-1/3 bg-accent" />
      ) : (
        <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("rounded-control bg-surface motion-safe:animate-pulse", className)} />;
}
