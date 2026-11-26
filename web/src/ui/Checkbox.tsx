// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> {
  label?: ReactNode;
}

/** Native checkbox (keyboard and form behaviour for free), restyled with the tokens. */
export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={cx("inline-flex min-h-8 cursor-pointer items-center gap-3 text-body text-fg", rest.disabled && "cursor-not-allowed opacity-50", className)}>
      <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          className="peer h-5 w-5 cursor-[inherit] appearance-none rounded-chip border border-fg-subtle bg-bg-elevated transition-colors checked:border-accent checked:bg-accent hover:border-fg-muted"
          {...rest}
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="pointer-events-none absolute h-3 w-3 text-accent-ink opacity-0 peer-checked:opacity-100"
        >
          <path d="M2.5 6.5l2.5 2.5 4.5-5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {label}
    </label>
  );
}
