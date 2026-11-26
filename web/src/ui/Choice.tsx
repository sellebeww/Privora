// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { useId } from "react";
import { cx } from "./cx";

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}
export interface ChoiceGroupProps<T extends string> {
  legend: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly Choice<T>[];
  /** Columns on wide screens; one column otherwise. */
  columns?: 1 | 2 | 3;
  disabled?: boolean;
}

const COLUMNS = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" };

/**
 * One choice out of a few, as cards around native radios: arrow keys, one tab stop and a selected
 * state that does not rest on colour all come from the browser.
 */
export function ChoiceGroup<T extends string>({ legend, value, onChange, options, columns = 1, disabled }: ChoiceGroupProps<T>) {
  const name = useId();
  return (
    <fieldset className="flex flex-col border-0 p-0" disabled={disabled}>
      <legend className="pb-2 text-small font-medium">{legend}</legend>
      <div className={cx("grid gap-3", COLUMNS[columns])}>
        {options.map((o) => (
          <label
            key={o.value}
            className="flex min-h-9 cursor-pointer items-start gap-3 rounded-control border border-border-strong bg-bg-elevated p-3 transition-colors hover:bg-surface-hover has-checked:border-accent-border has-checked:bg-accent-subtle has-disabled:cursor-not-allowed has-disabled:opacity-50"
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} className="mt-1 h-4 w-4 shrink-0 accent-accent" />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-body font-medium">{o.label}</span>
              {o.description && <span className="text-small text-fg-muted">{o.description}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
