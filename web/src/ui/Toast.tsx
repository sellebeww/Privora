// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { id } from "../i18n/id";
import { Button } from "./Button";
import { cx } from "./cx";

export type ToastTone = "info" | "error";
export interface ToastItem {
  key: number;
  text: string;
  tone: ToastTone;
}
const Ctx = createContext<((text: string, tone?: ToastTone) => void) | null>(null);

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast needs <ToastProvider>");
  return c;
}

export const TOAST_MS = 5000;

/** Toasts live in an aria-live region; each one closes by itself or by its button. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((key: number) => setItems((l) => l.filter((t) => t.key !== key)), []);
  const push = useCallback((text: string, tone: ToastTone = "info") => {
    seq.current += 1;
    setItems((l) => [...l.slice(-3), { key: seq.current, text, tone }]);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div role="region" aria-label={id.toast.region} className="fixed right-4 bottom-4 z-50 flex w-[var(--size-panel)] max-w-[calc(100vw-var(--space-unit)*8)] flex-col gap-2">
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          {items.map((t) => (
            <ToastView key={t.key} item={t} onClose={dismiss} />
          ))}
        </div>
      </div>
    </Ctx.Provider>
  );
}

function ToastView({ item, onClose }: { item: ToastItem; onClose: (k: number) => void }) {
  useEffect(() => {
    const h = setTimeout(() => onClose(item.key), TOAST_MS);
    return () => clearTimeout(h);
  }, [item.key, onClose]);
  return (
    <div
      className={cx(
        "flex items-start justify-between gap-3 rounded-panel border bg-surface p-4 text-body text-fg",
        item.tone === "error" ? "border-danger" : "border-border-strong",
      )}
    >
      <p className="min-w-0">
        {item.tone === "error" && (
          <span className="text-danger">
            <span aria-hidden="true">! </span>
            {id.toast.errorPrefix}
          </span>
        )}
        {item.text}
      </p>
      <Button variant="ghost" size={32} className="-my-2 -mr-2" aria-label={id.toast.close} onClick={() => onClose(item.key)}>
        <span aria-hidden="true">x</span>
      </Button>
    </div>
  );
}
