// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DocView, type DocViewHandle } from "../flow/DocView";
import { findingRows } from "../flow/findingRows";
import { buildMarks, trimRange } from "../flow/marks";
import { MAX_OCCURRENCES, useSession } from "../flow/session";
import { id } from "../i18n/id";
import { Button, FindingsList, StepNav, Switch, Tabs, useToast } from "../ui";
import { cx } from "../ui/cx";
import { Result } from "./Result";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { useMedia } from "./useMedia";

type Step = "review" | "result";

export function Workspace() {
  const wide = useMedia("(min-width: 1024px)");
  const s = useSession();
  const toast = useToast();
  const { state, rows } = s;
  const [step, setStep] = useState<Step>("review");
  const [tab, setTab] = useState("doc");
  const [help, setHelp] = useState(false);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const doc = useRef<DocViewHandle>(null);
  const hasDoc = state.scannedWith !== null;

  const marks = useMemo(() => buildMarks(rows), [rows]);
  const list = useMemo(() => findingRows(state), [state]);
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const picked = useMemo(() => (sel ? trimRange(state.text, sel.start, sel.end) : null), [sel, state.text]);
  const rescanNeeded = state.scannedWith !== state.sensitivity;

  const jump = useCallback(
    (key: string) => {
      const r = byKey.get(key);
      if (!r) return;
      setTab("doc");
      doc.current?.jumpTo(r.start, key);
    },
    [byKey],
  );
  const toggleAll = () => {
    const keys = rows.map((r) => r.key);
    s.setAll(keys, !rows.every((r) => r.selected));
  };

  // "?" opens the shortcut list from anywhere that is not a field.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target;
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      setHelp(true);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  if (!hasDoc) {
    return (
      <Padded>
        <div className="mx-auto flex max-w-[var(--size-readable)] flex-col items-start gap-4 rounded-panel border border-border bg-surface p-6">
          <h1 className="text-title-3 font-semibold tracking-subtitle">{id.workspace.title}</h1>
          <p className="text-body text-fg-muted">{id.workspace.empty}</p>
          <Button variant="primary" onClick={() => (location.hash = "#/")}>{id.workspace.toHome}</Button>
        </div>
      </Padded>
    );
  }

  const clearSel = () => {
    document.getSelection()?.removeAllRanges();
    setSel(null);
  };
  const addOne = () => {
    if (!picked) return;
    s.addManual(picked.start, picked.end);
    toast(id.workspace.addedOne);
    clearSel();
  };
  const addAll = async () => {
    if (!picked) return;
    const n = await s.addAllOccurrences(picked.start, picked.end);
    toast(n < 0 ? id.workspace.tooMany(MAX_OCCURRENCES) : id.workspace.addedMany(n), n < 0 ? "error" : "info");
    clearSel();
  };
  const switchStep = (x: Step) => setStep(x);

  const bar = picked && (
    // mousedown is cancelled so pressing a button does not clear the text selection first.
    <div
      role="group"
      aria-label={id.workspace.selectionLabel}
      onMouseDown={(e) => e.preventDefault()}
      className="flex flex-wrap items-center gap-3 rounded-panel border border-accent-border bg-surface p-3"
    >
      <span className="min-w-0 flex-1 truncate font-mono text-small text-fg-muted">{state.text.slice(picked.start, Math.min(picked.end, picked.start + 80))}</span>
      <Button variant="primary" size={32} onClick={addOne}>{id.workspace.redactThis}</Button>
      <Button variant="secondary" size={32} onClick={() => void addAll()}>{id.workspace.redactAll}</Button>
    </div>
  );

  const docPanel = (
    <section aria-label={id.workspace.document} className="flex min-h-0 flex-col gap-4">
      {state.phase === "scanning" && <p role="status" className="text-small text-fg-muted">{id.progress.detecting}</p>}
      <p className="text-small text-fg-muted">{id.workspace.docHint}</p>
      {bar}
      <DocView
        text={state.text}
        marks={marks}
        label={id.workspace.docBody}
        handle={doc}
        onSelection={setSel}
        onMarkClick={(keys) => s.toggle(keys)}
        className="h-[var(--size-doc)] min-h-96"
      />
    </section>
  );
  const panel = (
    <section aria-label={id.workspace.findings} className="flex flex-col gap-4">
      <h2 aria-live="polite" className="text-title-3 font-semibold tracking-subtitle">
        {id.workspace.findingsCount(list.length)}
      </h2>
      <div className="flex flex-col gap-2">
        <Switch
          checked={state.sensitivity === "HATI_HATI"}
          onCheckedChange={(v) => s.setSensitivity(v ? "HATI_HATI" : "SEIMBANG")}
          label={id.home.sensitivityCareful}
        />
        {state.error && state.error !== "CANCELLED" && (
          <p role="alert" className="text-small text-danger">
            <span aria-hidden="true">! </span>
            {id.engineErrors[state.error as keyof typeof id.engineErrors] ?? id.states.errorGeneric}
          </p>
        )}
        {rescanNeeded && (
          <div className="flex flex-col gap-2">
            <p className="text-small text-fg-muted">{id.workspace.rescanHint}</p>
            <div>
              <Button variant="secondary" size={32} onClick={() => void s.scan()} disabled={state.phase === "scanning"}>{id.workspace.rescan}</Button>
            </div>
          </div>
        )}
      </div>
      <FindingsList rows={list} onToggle={(k) => s.toggle([k])} onToggleAll={toggleAll} onJump={jump} />
      {list.length === 0 && <p className="text-small text-fg-muted">{id.workspace.noFindingsHint}</p>}
      <div>
        <Button variant="primary" onClick={() => switchStep("result")}>{id.workspace.toResult}</Button>
      </div>
      <div>
        <Button variant="ghost" size={32} onClick={() => setHelp(true)}>{id.shortcutsDialog.title}</Button>
      </div>
    </section>
  );

  const h1 = <h1 className="sr-only">{id.workspace.title}</h1>;
  const dialog = <ShortcutsDialog open={help} onClose={() => setHelp(false)} />;
  const steps = (
    <StepNav
      title={id.steps.title}
      steps={[
        { name: id.steps.source, go: () => (location.hash = "#/"), current: false },
        { name: id.steps.review, go: () => switchStep("review"), current: step === "review" },
        { name: id.steps.result, go: () => switchStep("result"), current: step === "result" },
      ]}
    />
  );
  if (step === "result") {
    return (
      <div className="p-4 lg:p-6">
        {h1}
        <div className={cx(wide ? "grid grid-cols-[var(--size-nav)_minmax(0,1fr)] gap-6" : "flex flex-col gap-6")}>
          <aside aria-label={id.steps.region}>{steps}</aside>
          <div className="min-w-0"><Result onBack={() => switchStep("review")} /></div>
        </div>
        {dialog}
      </div>
    );
  }
  if (wide) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {h1}
        <div className="grid min-h-0 flex-1 grid-cols-[var(--size-nav)_minmax(0,1fr)_var(--size-panel)]">
          <aside aria-label={id.steps.region} className="border-r border-border p-4">{steps}</aside>
          <div className="min-w-0 p-6">{docPanel}</div>
          <aside aria-label={id.workspace.findingsRegion} className="overflow-auto border-l border-border p-4">{panel}</aside>
        </div>
        {dialog}
      </div>
    );
  }
  return (
    <div className="p-4">
      {h1}
      <Tabs
        label={id.workspace.tabs}
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "steps", label: id.steps.title, panel: steps },
          { value: "doc", label: id.workspace.document, panel: docPanel },
          { value: "findings", label: id.workspace.findings, panel },
        ]}
      />
      {dialog}
    </div>
  );
}

function Padded({ children }: { children: ReactNode }) {
  return <div className="p-6">{children}</div>;
}
