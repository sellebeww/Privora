// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { useEffect, useId, useRef, type ReactNode } from "react";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}

/**
 * Modal built on the native <dialog>: the browser traps focus, makes the page inert, closes on
 * Escape and returns focus to the opener. Clicking the backdrop also closes it.
 */
export function Dialog({ open, onClose, title, description, children, footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const tid = useId();
  const did = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={open ? tid : undefined}
      aria-describedby={open && description ? did : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-full max-w-[var(--size-readable)] rounded-panel border border-border-strong bg-surface p-0 text-fg"
    >
      {open && (
        <div className="flex flex-col gap-4 p-6">
          <h2 id={tid} className="text-title-3 font-semibold tracking-title">
            {title}
          </h2>
          {description && (
            <p id={did} className="text-body text-fg-muted">
              {description}
            </p>
          )}
          {children}
          {footer && <div className="flex justify-end gap-2 pt-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
