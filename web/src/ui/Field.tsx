// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";

const CONTROL =
  "w-full rounded-control border bg-bg-elevated px-3 text-body text-fg placeholder:text-fg-muted transition-colors " +
  "hover:border-fg-muted disabled:cursor-not-allowed disabled:opacity-50";

function border(invalid?: boolean) {
  return invalid ? "border-danger" : "border-fg-subtle";
}

export interface FieldProps {
  label: string;
  hint?: string;
  /** When set the control is marked invalid and the message is announced. */
  error?: string;
  children: (a: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
}

/** Label, hint and error text wired to one control through ids. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const described = [hint && hintId, error && errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-small font-medium text-fg">
        {label}
      </label>
      {children({ id, "aria-describedby": described, ...(error ? { "aria-invalid": true as const } : {}) })}
      {hint && (
        <p id={hintId} className="text-small text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-small text-danger">
          <span aria-hidden="true">! </span>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Defaults for every text field (a caller may override): no spell checker (some browsers send the
 * text to a vendor), no autofill or form restore (it can reach the disk), no automatic rewriting.
 */
const PRIVATE = { spellCheck: false, autoComplete: "off", autoCorrect: "off", autoCapitalize: "off" } as const;

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...PRIVATE}
      className={cx(CONTROL, "h-9", border(rest["aria-invalid"] === true || rest["aria-invalid"] === "true"), className)}
      {...rest}
    />
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...PRIVATE}
      className={cx(CONTROL, "min-h-24 resize-y py-2", border(rest["aria-invalid"] === true || rest["aria-invalid"] === "true"), className)}
      {...rest}
    />
  );
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(CONTROL, "h-9", border(rest["aria-invalid"] === true), className)} {...rest} />;
}
