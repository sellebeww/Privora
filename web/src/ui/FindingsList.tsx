// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { useEffect, useMemo, useRef, useState } from "react";
import { id } from "../i18n/id";
import type { Confidence } from "../engine/types";
import { ConfidenceBadge, KindBadge } from "./Badge";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";

export interface FindingRow {
  key: string;
  kind: string;
  /** Absent for ranges the user added by hand. */
  confidence?: Confidence;
  /** Short reason, already in Indonesian. */
  reason: string;
  /** The matched text, shown in mono. User data: never logged. */
  value: string;
  selected: boolean;
}
export interface FindingsListProps {
  rows: FindingRow[];
  onToggle: (key: string) => void;
  onToggleAll: () => void;
  onJump: (key: string) => void;
  /** Rows shown per kind before "show more". Keeps a very long list responsive. Default 100. */
  groupLimit?: number;
}

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "SUMMARY"]);
/** True when a key press belongs to something else: a field, a button, an open dialog, a modifier. */
function ignoreKey(e: globalThis.KeyboardEvent): boolean {
  const t = e.target;
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  if (document.querySelector("dialog[open]")) return true;
  return t instanceof HTMLElement && (TYPING.has(t.tagName) || t.isContentEditable);
}

/**
 * Findings grouped by kind. One tab stop for the list (roving focus): J/K move, Space toggles,
 * Enter jumps, A selects all. Keys are ignored while a control inside a row has focus.
 */
export function FindingsList({ rows, onToggle, onToggleAll, onJump, groupLimit = 100 }: FindingsListProps) {
  const groups = useMemo(() => {
    const m = new Map<string, FindingRow[]>();
    for (const r of rows) {
      const g = m.get(r.kind);
      if (g) g.push(r);
      else m.set(r.kind, [r]);
    }
    return [...m.entries()];
  }, [rows]);
  const [active, setActive] = useState(0);
  const [extra, setExtra] = useState<Record<string, number>>({});
  const refs = useRef(new Map<string, HTMLLIElement>());
  const selected = rows.filter((r) => r.selected).length;
  const shown = (kind: string, g: FindingRow[]) => g.slice(0, groupLimit + (extra[kind] ?? 0));
  const flat = groups.flatMap(([k, g]) => shown(k, g));

  const focusAt = (i: number) => {
    const row = flat[i];
    if (!row) return;
    setActive(i);
    refs.current.get(row.key)?.focus();
  };
  // Keys work from anywhere that is not a field or a button, so J/K also work after a jump into the document.
  const live = useRef({ flat, active, onToggle, onToggleAll, onJump });
  useEffect(() => {
    live.current = { flat, active, onToggle, onToggleAll, onJump };
  });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (ignoreKey(e)) return;
      const { flat: f, active: a, onToggle: tg, onToggleAll: all, onJump: jp } = live.current;
      const row = f[a];
      const k = e.key.toLowerCase();
      const onItem = e.target instanceof HTMLElement && e.target.tagName === "LI";
      if (k === "j") focusAt(Math.min(f.length - 1, a + (onItem ? 1 : 0)));
      else if (k === "k") focusAt(Math.max(0, a - (onItem ? 1 : 0)));
      else if (k === " " && row && onItem) tg(row.key);
      else if (k === "enter" && row && onItem) jp(row.key);
      else if (k === "a") all();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (rows.length === 0) {
    return (
      <p role="status" className="rounded-panel border border-border p-4 text-body text-fg-muted">
        {id.workspace.noFindings}
      </p>
    );
  }
  let index = -1;
  return (
    <div className="flex flex-col gap-4">
      <p aria-live="polite" className="text-small text-fg-muted">
        {id.workspace.selectedCount(selected, rows.length)}
      </p>
      <ul aria-label={id.workspace.findings} className="flex flex-col gap-4">
        {groups.map(([kind, items]) => (
          <li key={kind} className="list-none">
            <div className="flex items-center justify-between pb-2">
              <KindBadge kind={kind} />
              <span className="font-mono text-small text-fg-muted">{items.length}</span>
            </div>
            <ul className="flex flex-col divide-y divide-border rounded-panel border border-border">
              {shown(kind, items).map((r) => {
                index += 1;
                const i = index;
                return (
                  <li
                    key={r.key}
                    ref={(el) => {
                      if (el) refs.current.set(r.key, el);
                      else refs.current.delete(r.key);
                    }}
                    tabIndex={i === active ? 0 : -1}
                    onFocus={(e) => e.target === e.currentTarget && setActive(i)}
                    className="flex flex-col gap-2 p-3 transition-colors first:rounded-t-panel last:rounded-b-panel hover:bg-surface-hover"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Checkbox
                        checked={r.selected}
                        onChange={() => onToggle(r.key)}
                        label={<span className="font-mono text-small break-words">{r.value}</span>}
                      />
                      <Button variant="ghost" size={32} aria-label={id.workspace.jumpTo(r.kind)} onClick={() => onJump(r.key)}>
                        {id.workspace.jump}
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {r.confidence && <ConfidenceBadge confidence={r.confidence} />}
                      <span className="text-small text-fg-muted">{r.reason}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
            {items.length > groupLimit + (extra[kind] ?? 0) && (
              <div className="pt-2">
                <Button variant="ghost" size={32} onClick={() => setExtra((x) => ({ ...x, [kind]: (x[kind] ?? 0) + groupLimit }))}>
                  {id.workspace.more(items.length - groupLimit - (extra[kind] ?? 0))}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
