// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Height in px: 32 or 36. */
  size?: 32 | 36;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent border border-transparent",
  secondary: "bg-surface text-fg border border-border-strong hover:bg-surface-hover active:bg-bg-elevated",
  ghost: "bg-transparent text-fg-muted border border-transparent hover:bg-surface-hover hover:text-fg active:bg-surface",
};

export function Button({ variant = "secondary", size = 36, type = "button", className, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-control px-4 text-body font-medium transition-colors select-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === 32 ? "h-8" : "h-9",
        VARIANT[variant],
        className,
      )}
      {...rest}
    />
  );
}
