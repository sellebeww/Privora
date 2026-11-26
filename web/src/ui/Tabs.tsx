// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export interface TabItem {
  value: string;
  label: string;
  panel: ReactNode;
}
export interface TabsProps {
  value: string;
  onValueChange: (v: string) => void;
  items: TabItem[];
  label: string;
  className?: string;
}

/** WAI-ARIA tabs with automatic activation: Left/Right/Home/End move focus and select. */
export function Tabs({ value, onValueChange, items, label, className }: TabsProps) {
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (e: KeyboardEvent, i: number) => {
    const n = items.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    const item = items[next];
    if (!item) return;
    e.preventDefault();
    onValueChange(item.value);
    refs.current[next]?.focus();
  };
  return (
    <div className={cx("flex min-h-0 flex-col", className)}>
      <div role="tablist" aria-label={label} className="flex shrink-0 gap-2 border-b border-border">
        {items.map((t, i) => {
          const on = t.value === value;
          return (
            <button
              key={t.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-t-${t.value}`}
              aria-selected={on}
              aria-controls={`${base}-p-${t.value}`}
              tabIndex={on ? 0 : -1}
              onClick={() => onValueChange(t.value)}
              onKeyDown={(e) => move(e, i)}
              className={cx(
                "-mb-px h-9 cursor-pointer border-b-2 px-3 text-body font-medium transition-colors",
                on ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {items.map((t) => (
        <div
          key={t.value}
          role="tabpanel"
          id={`${base}-p-${t.value}`}
          aria-labelledby={`${base}-t-${t.value}`}
          hidden={t.value !== value}
          className="min-h-0 flex-1 pt-4"
        >
          {t.value === value ? t.panel : null}
        </div>
      ))}
    </div>
  );
}
