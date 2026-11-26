// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Final preview and export. Export is locked until every page was seen with the boxes as they are now
// (any edit resets it, see pdf/state.ts) and the user said so.
import { useEffect, useMemo, useRef, useState } from "react";
import { downloadBlob } from "../flow/download";
import { downloadName } from "../flow/files";
import { wipeSession } from "../flow/session";
import { id } from "../i18n/id";
import { ExportError, exportRedacted, type ExportResult } from "../pdf/export";
import { usePdf } from "../pdf/session";
import { allBoxes, allPageBoxes, counts, DPI_CHOICES } from "../pdf/state";
import { Button, Checkbox, Field, Progress, Select } from "../ui";
import { PdfPageView } from "./PdfPage";
import { useWidth } from "./useWidth";

const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

type Phase = { t: "idle" } | { t: "busy"; done: number; total: number } | { t: "done"; r: ExportResult; at: string } | { t: "error"; code: string };

export function PdfFinal({ onBack }: { onBack: () => void }) {
  const pdf = usePdf();
  const { state, doc } = pdf;
  const t = id.pdf.final;
  const [measured, holder] = useWidth();
  const width = Math.min(measured, 900);
  const [phase, setPhase] = useState<Phase>({ t: "idle" });
  const ac = useRef<AbortController | null>(null);
  const total = state.pages.length;
  const seen = state.viewed.size;
  const allSeen = seen >= total;
  const { pages, off, manual, mode } = state;
  const byPage = useMemo(() => allPageBoxes({ pages, off, manual, mode }), [pages, off, manual, mode]);
  const sums = useMemo(() => counts({ pages, off, manual, mode }), [pages, off, manual, mode]);
  const busy = phase.t === "busy";
  // Leaving this step (or the page) stops a running export: nothing is written for boxes that are no longer on screen.
  useEffect(() => () => ac.current?.abort(), []);

  const run = async () => {
    if (!doc) return;
    const c = new AbortController();
    ac.current = c;
    setPhase({ t: "busy", done: 0, total });
    try {
      const r = await exportRedacted(doc, allBoxes(state), {
        dpi: state.dpi,
        format: state.format,
        signal: c.signal,
        onProgress: (done, tot) => setPhase({ t: "busy", done, total: tot }),
      });
      const name = downloadName("samar", "pdf");
      downloadBlob(name, r.blob);
      setPhase({ t: "done", r, at: name });
    } catch (e) {
      setPhase({ t: "error", code: e instanceof ExportError ? e.code : "FAILED" });
    } finally {
      ac.current = null;
    }
  };

  return (
    <section aria-labelledby="pdf-final-title" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="pdf-final-title" className="text-title-3 font-semibold tracking-subtitle">{t.title}</h2>
        <Button variant="ghost" size={32} onClick={onBack} disabled={busy}>{id.workspace.backToReview}</Button>
      </div>
      <p className="text-body text-fg-muted">{t.lead}</p>
      <p aria-live="polite" className="font-mono text-small text-fg-muted">{t.summary(sums.boxes, sums.findings)}</p>
      {sums.boxes === 0 && <p role="status" className="rounded-control border border-border p-3 text-small text-warning"><span aria-hidden="true">! </span>{t.noBoxes}</p>}

      <div className="flex flex-col gap-4 rounded-panel border border-border p-4">
        <h3 className="text-small font-medium text-fg-muted">{t.options}</h3>
        <div className="flex flex-wrap items-end gap-6">
          <Field label={t.dpi}>
            {(p) => (
              <Select {...p} value={state.dpi} disabled={busy} onChange={(e) => pdf.setDpi(Number(e.target.value))}>
                {DPI_CHOICES.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t.format}>
            {(p) => (
              <Select {...p} value={state.format} disabled={busy} onChange={(e) => pdf.setFormat(e.target.value === "JPEG" ? "JPEG" : "LOSSLESS")}>
                <option value="LOSSLESS">{t.formatLossless}</option>
                <option value="JPEG">{t.formatJpeg}</option>
              </Select>
            )}
          </Field>
        </div>
        <p aria-live="polite" className="text-small text-fg-muted">{t.checked(Math.min(seen, total), total)}</p>
        <Checkbox
          checked={state.confirmed}
          disabled={!allSeen || busy}
          onChange={(e) => pdf.confirm(e.target.checked)}
          label={<span>{t.confirm}{!allSeen && <span className="text-fg-subtle"> ({t.confirmLocked})</span>}</span>}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => void run()} disabled={!state.confirmed || busy}>{t.export}</Button>
          {busy && <Button variant="secondary" onClick={() => ac.current?.abort()}>{t.cancel}</Button>}
          <Button variant="ghost" onClick={wipeSession}>{id.result.clearSession}</Button>
        </div>
        {phase.t === "busy" && (
          <div role="status" className="flex flex-col gap-2">
            <Progress label={t.exporting(phase.done, phase.total)} value={(phase.done / Math.max(1, phase.total)) * 100} />
            <span className="text-small text-fg-muted">{t.exporting(phase.done + 1 > phase.total ? phase.total : phase.done + 1, phase.total)}</span>
          </div>
        )}
        {phase.t === "done" && (
          <div role="status" className="flex flex-col gap-2">
            <p className="text-body">{t.done(phase.r.pages, mb(phase.r.bytes), phase.r.minDpi)}</p>
            {phase.r.minDpi < state.dpi && <p className="text-small text-warning">{t.lowered(phase.r.minDpi)}</p>}
            <div>
              <Button variant="secondary" size={32} onClick={() => downloadBlob(phase.at, phase.r.blob)}>{t.download}</Button>
            </div>
          </div>
        )}
        {phase.t === "error" && (
          <p role={phase.code === "CANCELLED" ? "status" : "alert"} className={phase.code === "CANCELLED" ? "text-small text-fg-muted" : "text-small text-danger"}>
            {phase.code !== "CANCELLED" && <span aria-hidden="true">! </span>}
            {phase.code === "CANCELLED" ? t.cancelled : phase.code === "VERIFY_FAILED" ? t.verifyFailed : t.failed}
          </p>
        )}
        <ul className="flex list-disc flex-col gap-1 pl-6 text-small text-fg-muted">
          {t.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </div>

      <div ref={holder} className="flex min-w-0 flex-col items-center gap-6">
        {doc && width > 0 &&
          state.pages.map((p, i) => (
            <div key={i} className="flex w-full flex-col items-center gap-2">
              <span className="font-mono text-small text-fg-muted">{id.pdf.review.page(i + 1, total)}</span>
              <PdfPageView doc={doc} index={i} size={{ w: p.data.width, h: p.data.height }} boxes={byPage[i] ?? []} width={width} mode="final" onSeen={pdf.markViewed} />
            </div>
          ))}
      </div>
    </section>
  );
}
