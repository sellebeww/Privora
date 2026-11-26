// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// PDF review: page preview with boxes, findings of all pages, box mode, manual boxes, then the final preview.
import { useCallback, useMemo, useState } from "react";
import { PDF_WARN_BYTES } from "../flow/files";
import { reasonText } from "../flow/findingRows";
import { useSession } from "../flow/session";
import { id } from "../i18n/id";
import type { Box } from "../pdf/geometry";
import { PDF_WARN_PAGES, usePdf } from "../pdf/session";
import { allPageBoxes, fkey, pageOfKey, type PageBox } from "../pdf/state";
import { Button, ChoiceGroup, FindingsList, Input, StepNav, Switch, Tabs, type FindingRow } from "../ui";
import { cx } from "../ui/cx";
import { useMedia } from "./useMedia";
import { useWidth } from "./useWidth";
import { PdfFinal } from "./PdfFinal";
import { PdfPageView } from "./PdfPage";

type Step = "review" | "final";
const clip = (s: string) => (s.length > 120 ? `${s.slice(0, 120)}...` : s);

export function PdfWorkspace() {
  const wide = useMedia("(min-width: 1024px)");
  const pdf = usePdf();
  const text = useSession();
  const { state, doc } = pdf;
  const [step, setStep] = useState<Step>("review");
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState("doc");
  const [measured, holder] = useWidth();
  const width = Math.min(measured, 820);
  const { pages, off, manual, mode } = state;
  const byPage = useMemo(() => allPageBoxes({ pages, off, manual, mode }), [pages, off, manual, mode]);

  const rows = useMemo<FindingRow[]>(
    () =>
      pages.flatMap((p, i) =>
        p.findings.map((f) => ({
          key: fkey(i, f),
          kind: f.kind,
          confidence: f.confidence,
          reason: id.pdf.review.reasonPage(i + 1, reasonText(f)),
          value: clip(p.data.text.slice(f.start, f.end)),
          selected: !off.has(fkey(i, f)),
        })),
      ),
    [pages, off],
  );
  const sensitivity = text.state.sensitivity;
  const rescanNeeded = state.scannedWith !== sensitivity;

  const jump = useCallback((key: string) => {
    setPage(Math.max(0, pageOfKey(key)));
    setTab("doc");
  }, []);
  const onRemove = (b: PageBox) => {
    if (b.manualId !== undefined) pdf.removeManual(page, b.manualId);
    else pdf.toggle(b.sources, false);
  };
  const addCentered = () => {
    const p = pages[page];
    if (!p) return;
    const w = Math.min(160, p.data.width / 2);
    const h = 24;
    const box: Box = { x: (p.data.width - w) / 2, y: (p.data.height - h) / 2, w, h };
    pdf.addManual(page, box);
  };

  if (!doc || pages.length === 0) {
    return (
      <div className="p-6">
        <div className="mx-auto flex max-w-[var(--size-readable)] flex-col items-start gap-4 rounded-panel border border-border bg-surface p-6">
          <h1 className="text-title-3 font-semibold tracking-subtitle">{id.workspace.title}</h1>
          <p className="text-body text-fg-muted">{id.workspace.empty}</p>
          <Button variant="primary" onClick={() => (location.hash = "#/")}>{id.workspace.toHome}</Button>
        </div>
      </div>
    );
  }

  const cur = pages[page];
  const total = pages.length;
  const noTextAtAll = pages.every((p) => p.data.chars === 0);
  const steps = (
    <StepNav
      title={id.steps.title}
      steps={[
        { name: id.steps.source, go: () => (location.hash = "#/"), current: false },
        { name: id.steps.review, go: () => setStep("review"), current: step === "review" },
        { name: id.steps.result, go: () => setStep("final"), current: step === "final" },
      ]}
    />
  );
  const h1 = <h1 className="sr-only">{id.pdf.review.title}</h1>;

  if (step === "final") {
    return (
      <div className="p-4 lg:p-6">
        {h1}
        <div className={cx(wide ? "grid grid-cols-[var(--size-nav)_minmax(0,1fr)] gap-6" : "flex flex-col gap-6")}>
          <aside aria-label={id.steps.region}>{steps}</aside>
          <div className="min-w-0"><PdfFinal onBack={() => setStep("review")} /></div>
        </div>
      </div>
    );
  }

  const docPanel = (
    <section aria-label={id.workspace.document} className="flex min-h-0 flex-col gap-4">
      {(state.phase === "loading") && <p role="status" className="text-small text-fg-muted">{id.progress.detecting}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size={32} onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>{id.pdf.review.prev}</Button>
        <span aria-live="polite" className="font-mono text-small text-fg-muted">{id.pdf.review.page(page + 1, total)}</span>
        <Button variant="secondary" size={32} onClick={() => setPage(Math.min(total - 1, page + 1))} disabled={page >= total - 1}>{id.pdf.review.next}</Button>
        {total > 1 && (
          <label className="flex items-center gap-2 text-small text-fg-muted">
            {id.pdf.review.pages}
            <Input
              type="number"
              min={1}
              max={total}
              value={page + 1}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (Number.isFinite(n)) setPage(Math.min(total - 1, Math.max(0, n - 1)));
              }}
              className="w-20"
            />
          </label>
        )}
        <Button variant="secondary" size={32} onClick={addCentered}>{id.pdf.review.addBox}</Button>
      </div>
      {state.fileBytes > PDF_WARN_BYTES && <p role="status" className="rounded-control border border-border p-3 text-small text-warning"><span aria-hidden="true">! </span>{id.pdf.sizeWarn(Math.round(state.fileBytes / 1048576))}</p>}
      {total > PDF_WARN_PAGES && <p role="status" className="rounded-control border border-border p-3 text-small text-warning"><span aria-hidden="true">! </span>{id.pdf.pagesWarn(total)}</p>}
      {noTextAtAll && <p role="status" className="rounded-control border border-border p-3 text-small text-warning"><span aria-hidden="true">! </span>{id.pdf.noTextAtAll}</p>}
      {cur?.scannedLook && <p role="status" className="rounded-control border border-border p-3 text-small text-warning"><span aria-hidden="true">! </span>{id.pdf.scannedPage}</p>}
      {cur && cur.annotations > 0 && <p role="status" className="rounded-control border border-border p-3 text-small text-warning"><span aria-hidden="true">! </span>{id.pdf.annotations(cur.annotations)}</p>}
      <p className="text-small text-fg-muted">{id.pdf.review.drawHint}</p>
      <p aria-live="polite" className="font-mono text-small text-fg-muted">{id.pdf.review.boxes((byPage[page] ?? []).length)}</p>
      <div ref={holder} className="flex min-w-0 justify-center overflow-auto">
        {cur && width > 0 && (
          <PdfPageView
            key={page}
            doc={doc}
            index={page}
            size={{ w: cur.data.width, h: cur.data.height }}
            boxes={byPage[page] ?? []}
            width={width}
            mode="edit"
            onRemove={onRemove}
            onDraw={(box) => pdf.addManual(page, box)}
            onMove={(mid, box) => pdf.updateManual(page, mid, box)}
          />
        )}
      </div>
    </section>
  );

  const panel = (
    <section aria-label={id.workspace.findings} className="flex flex-col gap-4">
      <h2 aria-live="polite" className="text-title-3 font-semibold tracking-subtitle">{id.workspace.findingsCount(rows.length)}</h2>
      <div className="flex flex-col gap-3">
        <Switch checked={sensitivity === "HATI_HATI"} onCheckedChange={(v) => text.setSensitivity(v ? "HATI_HATI" : "SEIMBANG")} label={id.home.sensitivityCareful} />
        {rescanNeeded && (
          <div className="flex flex-col gap-2">
            <p className="text-small text-fg-muted">{id.workspace.rescanHint}</p>
            <div><Button variant="secondary" size={32} onClick={() => void pdf.rescan(sensitivity)} disabled={state.phase === "loading"}>{id.workspace.rescan}</Button></div>
          </div>
        )}
        {state.error && state.error !== "CANCELLED" && (
          <p role="alert" className="text-small text-danger"><span aria-hidden="true">! </span>{id.engineErrors[state.error as keyof typeof id.engineErrors] ?? id.states.errorGeneric}</p>
        )}
        <ChoiceGroup
          legend={id.pdf.review.boxMode}
          value={mode}
          onChange={pdf.setMode}
          options={[
            { value: "ITEM", label: id.pdf.review.modeItem, description: id.pdf.review.modeItemHint },
            { value: "PRECISE", label: id.pdf.review.modePrecise, description: id.pdf.review.modePreciseHint },
          ]}
        />
      </div>
      <FindingsList rows={rows} onToggle={(k) => pdf.toggle([k])} onToggleAll={() => pdf.setAll(rows.map((r) => r.key), !rows.every((r) => r.selected))} onJump={jump} />
      {rows.length === 0 && <p className="text-small text-fg-muted">{id.workspace.noFindingsHint}</p>}
      <div><Button variant="primary" onClick={() => setStep("final")}>{id.pdf.review.toFinal}</Button></div>
    </section>
  );

  if (wide) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {h1}
        <div className="grid min-h-0 flex-1 grid-cols-[var(--size-nav)_minmax(0,1fr)_var(--size-panel)]">
          <aside aria-label={id.steps.region} className="border-r border-border p-4">{steps}</aside>
          <div className="min-w-0 overflow-auto p-6">{docPanel}</div>
          <aside aria-label={id.workspace.findingsRegion} className="overflow-auto border-l border-border p-4">{panel}</aside>
        </div>
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
    </div>
  );
}
