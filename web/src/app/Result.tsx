// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { useEffect, useMemo, useState } from "react";
import { EngineError, type TokenEntry } from "../engine/types";
import { DocView } from "../flow/DocView";
import { copyText, downloadText } from "../flow/download";
import { downloadName } from "../flow/files";
import { buildMarks, spansOf } from "../flow/marks";
import { useSession, wipeSession } from "../flow/session";
import { id } from "../i18n/id";
import { Badge, Button, ChoiceGroup, KindBadge, Progress, useToast } from "../ui";
import { SaveMapDialog } from "./SaveMapDialog";

interface Out {
  text: string;
  map: TokenEntry[];
}

export function Result({ onBack }: { onBack: () => void }) {
  const s = useSession();
  const toast = useToast();
  const { state, rows, engine } = s;
  const t = id.result;
  const spans = useMemo(() => spansOf(rows), [rows]);
  const [done, setDone] = useState<{ for: object; out?: Out; err?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // One object per set of inputs: an answer only counts while it belongs to the current inputs.
  // The dependencies are the point: a new object whenever any of them changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inputs = useMemo(() => ({}), [engine, state.text, state.mode, state.style, spans]);
  const current = done?.for === inputs ? done : null;
  const out = current?.out ?? null;
  const err = current?.err ?? null;
  const { setTokenMap } = s;

  // Rebuild whenever the text, the selection, the style or the mode changes. A stale answer is dropped.
  useEffect(() => {
    let stale = false;
    const run =
      state.mode === "mask"
        ? engine.redact(state.text, spans, state.style).then((text) => ({ text, map: [] as TokenEntry[] }))
        : engine.tokenize(state.text, spans).then((r) => ({ text: r.text, map: r.map }));
    run.then(
      (o) => {
        if (stale) return;
        setDone({ for: inputs, out: o });
        setTokenMap(state.mode === "tokenize" ? o.map : null);
      },
      (e: unknown) => !stale && setDone({ for: inputs, err: e instanceof EngineError ? e.code : "INTERNAL" }),
    );
    return () => {
      stale = true;
    };
  }, [engine, inputs, state.text, state.mode, state.style, spans, setTokenMap]);

  const marks = useMemo(() => buildMarks(rows), [rows]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.selected) m.set(r.kind ?? id.workspace.manualKind, (m.get(r.kind ?? id.workspace.manualKind) ?? 0) + 1);
    return [...m.entries()];
  }, [rows]);
  const tokenize = state.mode === "tokenize";

  const copy = async () => {
    if (!out) return;
    toast((await copyText(out.text)) ? t.copied : t.copyFailed);
  };
  const download = () => out && downloadText(downloadName(tokenize ? "bertoken" : "samar", "txt"), out.text);

  return (
    <section aria-labelledby="result-title" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="result-title" className="text-title-3 font-semibold tracking-subtitle">{t.title}</h2>
        <Button variant="ghost" size={32} onClick={onBack}>{id.workspace.backToReview}</Button>
      </div>

      <div className="flex flex-col gap-3 rounded-panel border border-border p-4">
        <h3 className="text-small font-medium text-fg-muted">{t.summary}</h3>
        <p aria-live="polite" className="text-body">{counts.length === 0 ? t.nothingSelected : t.count(spans.length)}</p>
        {counts.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {counts.map(([k, n]) => (
              <li key={k} className="flex items-center gap-2 rounded-control border border-border px-2 py-1">
                <KindBadge kind={k} />
                <span className="font-mono text-small">{n}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!tokenize && (
        <ChoiceGroup
          legend={t.style}
          value={state.style}
          onChange={s.setStyle}
          columns={2}
          options={[
            { value: "LABEL", label: t.styleLabel },
            { value: "BLOK", label: t.styleBlock },
          ]}
        />
      )}

      {err ? (
        <p role="alert" className="rounded-panel border border-danger p-4 text-body text-danger">
          <span aria-hidden="true">! </span>
          {id.engineErrors[err as keyof typeof id.engineErrors] ?? id.states.errorGeneric}
        </p>
      ) : !out ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="text-small text-fg-muted">{t.working}</p>
          <Progress label={t.working} />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="text-small font-medium text-fg-muted">{t.before}</h3>
              <DocView text={state.text} marks={marks} label={t.before} className="h-96" />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="text-small font-medium text-fg-muted">{t.after}</h3>
              <DocView text={out.text} marks={[]} label={t.after} className="h-96" />
            </div>
          </div>
          <p className="text-small text-fg-muted">{t.previewCap}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={copy}>{t.copy}</Button>
            <Button variant="secondary" onClick={download}>{t.download}</Button>
            {tokenize && (
              <Button variant="secondary" onClick={() => setSaving(true)} disabled={out.map.length === 0}>{t.saveMap}</Button>
            )}
            <Button variant="ghost" onClick={wipeSession}>{t.clearSession}</Button>
          </div>
          {tokenize ? (
            <div className="flex flex-col gap-3 rounded-panel border border-border p-4">
              <h3 className="text-small font-medium">{t.llmTitle}</h3>
              <ol className="flex list-decimal flex-col gap-1 pl-6 text-body text-fg-muted">
                {t.llmSteps.map((x) => <li key={x}>{x}</li>)}
              </ol>
              <p className="flex items-start gap-2 text-small text-warning">
                <Badge tone="warning">!</Badge>
                {t.mapNote}
              </p>
            </div>
          ) : (
            <p className="border-l-2 border-border-strong pl-4 text-small text-fg-muted">{t.maskNote}</p>
          )}
          <SaveMapDialog open={saving} onClose={() => setSaving(false)} map={out.map} fileName={downloadName("peta", "json")} />
        </>
      )}
    </section>
  );
}
