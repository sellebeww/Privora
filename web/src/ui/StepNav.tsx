// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { cx } from "./cx";

export interface Step {
  name: string;
  go: () => void;
  current: boolean;
  disabled?: boolean;
}

/** The numbered steps of a flow (Sumber, Tinjau, Hasil). */
export function StepNav({ title, steps }: { title: string; steps: readonly Step[] }) {
  return (
    <nav aria-label={title}>
      <h2 className="pb-3 text-small font-medium text-fg-muted">{title}</h2>
      <ol className="flex flex-col gap-2">
        {steps.map((it, i) => (
          <li key={it.name}>
            <button
              type="button"
              aria-current={it.current ? "step" : undefined}
              disabled={it.disabled}
              onClick={it.go}
              className={cx(
                "flex h-9 w-full cursor-pointer items-center gap-3 rounded-control px-3 text-left text-body transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                it.current ? "bg-accent-subtle text-fg" : "text-fg-muted hover:bg-surface-hover",
              )}
            >
              <span className="font-mono text-small">{i + 1}</span>
              {it.name}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
