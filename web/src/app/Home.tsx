// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { useRef, useState, type DragEvent } from "react";
import { VIRTUAL_OVER } from "../flow/DocView";
import { FileReadError, isPdf, PDF_WARN_BYTES, readTextFile, type FileLike } from "../flow/files";
import { useSession, type Mode } from "../flow/session";
import { usePdf } from "../pdf/session";
import { id } from "../i18n/id";
import { Button, ChoiceGroup, Field, Progress, Switch, Textarea } from "../ui";
import { cx } from "../ui/cx";
import { LoadError } from "./States";

type Pick = Mode | "restore";
const MODES: Pick[] = ["mask", "tokenize", "restore"];

export function Home({ cleared = false }: { cleared?: boolean }) {
  const s = useSession();
  const pdf = usePdf();
  const { state } = s;
  const [pick, setPick] = useState<Pick>(state.mode);
  const [drag, setDrag] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const pdfBusy = pdf.state.phase === "loading";
  const scanning = state.phase === "scanning" || pdfBusy;
  const big = state.text.length > VIRTUAL_OVER;

  const open = async (f: FileLike) => {
    setProblem(null);
    setNote(null);
    if (isPdf(f.name)) {
      // A PDF is processed at once (text per page, then detection per page); the result is always an image PDF.
      s.setText("", null);
      setNote(f.size > PDF_WARN_BYTES ? id.pdf.sizeWarn(Math.round(f.size / 1048576)) : pick === "restore" ? null : id.home.pdfChosen(f.name));
      if (await pdf.open(f)) location.hash = "#/pdf";
      return;
    }
    pdf.clear();
    try {
      const r = await readTextFile(f);
      s.setText(r.text, f.name);
      setNote(r.large ? id.home.sizeWarn(Math.round(f.size / 1048576)) : id.home.loaded(f.name, r.text.length));
    } catch (e) {
      setProblem(id.fileErrors[e instanceof FileReadError ? e.code : "READ_FAILED"]);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) void open(f);
  };
  const go = async () => {
    setProblem(null);
    if (pick === "restore") {
      location.hash = "#/pulihkan";
      return;
    }
    if (!state.text.trim()) return setProblem(id.home.emptyText);
    pdf.clear();
    s.setMode(pick);
    if (await s.scan()) location.hash = "#/ruang-kerja";
  };
  const scanError = state.phase === "idle" && state.error === "CANCELLED" ? id.progress.cancelled : state.error && state.error !== "CANCELLED" ? (id.engineErrors[state.error as keyof typeof id.engineErrors] ?? id.states.errorGeneric) : null;
  const pct = state.progress.total > 0 ? (state.progress.done / state.progress.total) * 100 : undefined;

  return (
    <div className="landing-glow flex-1">
      <div className="mx-auto flex w-full max-w-[var(--size-readable)] flex-col gap-8 px-4 py-16">
        <div className="flex flex-col gap-4">
          <h1 className="text-title-1 font-semibold tracking-title">{id.home.title}</h1>
          <p className="text-title-3 text-fg-muted tracking-subtitle">{id.tagline}</p>
        </div>

        {cleared && <p role="status" className="rounded-control border border-border p-3 text-small text-fg-muted">{id.result.cleared}</p>}

        {s.engineState === "error" ? (
          <LoadError onRetry={() => location.reload()} />
        ) : (
          <section aria-labelledby="start-title" className="flex flex-col gap-6 rounded-panel border border-border bg-surface p-6">
            <h2 id="start-title" className="text-title-3 font-semibold tracking-subtitle">{id.home.cardTitle}</h2>
            {pick !== "restore" && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
                className={cx("flex flex-col gap-3 rounded-panel border border-dashed p-4 transition-colors", drag ? "border-accent bg-accent-subtle" : "border-border-strong")}
              >
                {big ? (
                  <p role="status" className="text-body">{note ?? id.home.loaded(state.fileName ?? "", state.text.length)}</p>
                ) : (
                  <Field label={drag ? id.home.dropActive : id.home.pasteLabel} hint={id.home.pasteHint}>
                    {(p) => (
                      <Textarea
                        {...p}
                        rows={6}
                        value={state.text}
                        disabled={scanning}
                        placeholder={id.home.pastePlaceholder}
                        onChange={(e) => {
                          setNote(null);
                          s.setText(e.target.value, null);
                        }}
                      />
                    )}
                  </Field>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={file}
                    type="file"
                    accept=".txt,.md,.csv,.pdf"
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void open(f);
                    }}
                  />
                  <Button variant="secondary" size={32} disabled={scanning} onClick={() => file.current?.click()}>{id.home.chooseFile}</Button>
                  {state.text && (
                    <Button variant="ghost" size={32} disabled={scanning} onClick={() => (s.setText("", null), setNote(null), setProblem(null))}>{id.home.clearText}</Button>
                  )}
                  {note && !big && <span role="status" className="text-small text-fg-muted">{note}</span>}
                </div>
              </div>
            )}
            {problem && (
              <p role="alert" className="text-small text-danger">
                <span aria-hidden="true">! </span>
                {problem}
              </p>
            )}

            <ChoiceGroup
              legend={id.home.modeLegend}
              value={pick}
              onChange={setPick}
              disabled={scanning}
              columns={3}
              options={MODES.map((m) => ({ value: m, label: id.modes[m].name, description: id.modes[m].desc }))}
            />

            {pick !== "restore" && (
              <div className="flex flex-col gap-2">
                <Switch
                  checked={state.sensitivity === "HATI_HATI"}
                  onCheckedChange={(v) => s.setSensitivity(v ? "HATI_HATI" : "SEIMBANG")}
                  label={id.home.sensitivityCareful}
                  disabled={scanning}
                />
                <p className="text-small text-fg-muted">{id.home.sensitivityHint}</p>
              </div>
            )}

            {pdfBusy && (
              <div role="status" className="flex items-center gap-4 rounded-panel border border-border p-4">
                <div className="flex flex-1 flex-col gap-2">
                  <Progress label={id.states.pdfLoading} value={pdf.state.progress.total > 0 ? (pdf.state.progress.done / pdf.state.progress.total) * 100 : undefined} />
                  <span className="text-small text-fg-muted">
                    {pdf.state.stage === "read" ? id.pdf.stage.read : pdf.state.stage === "extract" ? id.pdf.stage.extract(pdf.state.progress.done + 1, pdf.state.progress.total) : id.pdf.stage.scan(pdf.state.progress.done + 1, pdf.state.progress.total)}
                  </span>
                </div>
                <Button variant="secondary" size={32} onClick={pdf.cancel}>{id.progress.cancel}</Button>
              </div>
            )}
            {pdf.state.phase === "error" && pdf.state.error && !pdfBusy && (
              <p role="alert" className="text-small text-danger">
                <span aria-hidden="true">! </span>
                {id.pdf.errors[pdf.state.error] ?? id.engineErrors[pdf.state.error as keyof typeof id.engineErrors] ?? id.states.errorGeneric}
              </p>
            )}
            {state.phase === "scanning" && (
              <div role="status" className="flex items-center gap-4 rounded-panel border border-border p-4">
                <div className="flex flex-1 flex-col gap-2">
                  <Progress label={id.progress.detecting} value={pct} />
                  <span className="text-small text-fg-muted">
                    {id.progress.detecting}
                    {state.progress.total > 1 && `. ${id.progress.step(state.progress.done, state.progress.total)}`}
                  </span>
                </div>
                <Button variant="secondary" size={32} onClick={s.cancelScan}>{id.progress.cancel}</Button>
              </div>
            )}
            {scanError && !scanning && (
              <p role={state.error === "CANCELLED" ? "status" : "alert"} className="text-small text-fg-muted">
                {state.error !== "CANCELLED" && <span aria-hidden="true">! </span>}
                {scanError}
              </p>
            )}
            {s.engineState === "loading" && <p role="status" className="text-small text-fg-muted">{id.states.wasmLoadingTitle}</p>}

            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-small text-fg-muted">{id.home.stays}</p>
              <Button variant="primary" onClick={() => void go()} disabled={scanning}>
                {pick === "restore" ? id.home.openRestore : id.home.scan}
              </Button>
            </div>
          </section>
        )}

        <p className="border-l-2 border-border-strong pl-4 text-small text-fg-muted">
          {id.honest.short} <a href="./#/bantuan" className="text-fg underline underline-offset-4">{id.nav.help}</a>.
        </p>
      </div>
    </div>
  );
}

