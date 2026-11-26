// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { cx } from "./cx";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}

/** button[role=switch] whose content is the track and the label: one 32px high target, name from content. */
export function Switch({ checked, onCheckedChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className="inline-flex h-8 cursor-pointer items-center gap-3 rounded-control text-body text-fg disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={cx(
          "relative inline-flex h-6 w-10 shrink-0 items-center rounded-control border transition-colors",
          checked ? "border-accent-border bg-accent-subtle" : "border-fg-subtle bg-bg-elevated",
        )}
      >
        <span className={cx("absolute top-1 h-4 w-4 rounded-chip transition-all", checked ? "left-5 bg-accent" : "left-1 bg-fg-muted")} />
      </span>
      {label}
    </button>
  );
}
