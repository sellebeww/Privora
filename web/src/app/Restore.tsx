// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { useMemo, useRef, useState } from "react";
import { decryptTokenMap, TokenMapError } from "../crypto/tokenMap";
import { EngineError, type RestoreMode, type RestoreReport, type TokenEntry } from "../engine/types";
import { DocView } from "../flow/DocView";
import { copyText, downloadText } from "../flow/download";
import { downloadName } from "../flow/files";
import type { Mark } from "../flow/marks";
import { useSession, wipeSession } from "../flow/session";
import { id } from "../i18n/id";
import { Button, ChoiceGroup, Field, Input, Textarea, useToast } from "../ui";

// Private use characters wrap every restored value so its position in the output is exact.
const OPEN = "";
const CLOSE = "";

export interface Restoration {
  text: string;
  marks: Mark[];
  report: RestoreReport;
}

/**
 * Restore with the engine and locate each restored value in the output. The map values are wrapped in
 * sentinels for one engine call; the result is then unwrapped. Falls back to no highlight when a
 * sentinel already occurs in the input or in a value.
 */
export async function restoreWithMarks(
  engine: { restore(text: string, map: TokenEntry[], mode: RestoreMode): Promise<{ text: string; report: RestoreReport }> },
  text: string,
  map: TokenEntry[],
  mode: RestoreMode,
): Promise<Restoration> {
  const clash = (s: string) => s.includes(OPEN) || s.includes(CLOSE);
  if (clash(text) || map.some((e) => clash(e.value))) {
    const r = await engine.restore(text, map, mode);
    return { text: r.text, marks: [], report: r.report };
  }
  const r = await engine.restore(text, map.map((e) => ({ token: e.token, value: OPEN + e.value + CLOSE })), mode);
  let out = "";
  const marks: Mark[] = [];
  let at = 0;
  let start = -1;
  for (let i = 0; i < r.text.length; i++) {
    const c = r.text[i];
    if (c === OPEN) {
      out += r.text.slice(at, i);
      start = out.length;
      at = i + 1;
    } else if (c === CLOSE && start >= 0) {
      out += r.text.slice(at, i);
      marks.push({ start, end: out.length, selected: true, keys: [`r${marks.length}`] });
      start = -1;
      at = i + 1;
    }
  }
  out += r.text.slice(at);
  return { text: out, marks, report: r.report };
}

export function Restore() {
  const s = useSession();
  const toast = useToast();
  const t = id.restore;
  const sessionMap = s.state.tokenMap;
  const [reply, setReply] = useState("");
  const [source, setSource] = useState<"session" | "file">(sessionMap && sessionMap.length > 0 ? "session" : "file");
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [pass, setPass] = useState("");
  const [opened, setOpened] = useState<TokenEntry[] | null>(null);
  const [mapErr, setMapErr] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [mode, setMode] = useState<RestoreMode>("STRICT");
  const [result, setResult] = useState<Restoration | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const map = source === "session" ? sessionMap : opened;
  const ready = reply.length > 0 && !!map && map.length > 0;

  const chooseFile = async (f: File) => {
    setOpened(null);
    setMapErr(null);
    setResult(null);
    setFileName(f.name);
    try {
      setFileText(await f.text());
    } catch {
      setFileText(null);
      setMapErr(t.fileInvalid);
    }
  };
  const openMap = async () => {
    if (fileText === null) return;
    setOpening(true);
    setMapErr(null);
    try {
      setOpened(await decryptTokenMap(fileText, pass));
      setPass("");
    } catch (e) {
      const code = e instanceof TokenMapError ? e.code : "DECRYPT_FAILED";
      setMapErr(code === "INVALID_FILE" ? t.fileInvalid : code === "UNSUPPORTED_VERSION" ? t.fileVersion : t.openFailed);
    } finally {
      setOpening(false);
    }
  };
  const run = async () => {
    if (!map) return;
    setBusy(true);
    setErr(null);
    try {
      setResult(await restoreWithMarks(s.engine, reply, map, mode));
    } catch (e) {
      setResult(null);
      setErr(e instanceof EngineError ? (id.engineErrors[e.code] ?? t.failed) : t.failed);
    } finally {
      setBusy(false);
    }
  };
  const report = result?.report;
  const lines = useMemo(
    () =>
      report
        ? [
            t.restored(report.restored),
            ...(report.flagged.length ? [t.flagged(report.flagged.length)] : []),
            report.unused.length ? t.unused(report.unused.length) : null,
            report.unknown.length ? t.unknown(report.unknown.length) : null,
          ].filter((x): x is string => x !== null)
        : [],
    [report, t],
  );

  return (
    <div className="mx-auto flex w-full max-w-[var(--size-readable)] flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-title-2 font-semibold tracking-title">{t.title}</h1>
        <p className="text-body text-fg-muted">{t.intro}</p>
      </div>

      <Field label={t.reply} hint={t.replyHint}>
        {(p) => (
          <Textarea
            {...p}
            rows={8}
            value={reply}
            placeholder={t.replyPlaceholder}
            onChange={(e) => {
              setReply(e.target.value);
              setResult(null);
            }}
          />
        )}
      </Field>

      <div className="flex flex-col gap-3">
        <ChoiceGroup
          legend={t.mapSource}
          value={source}
          onChange={setSource}
          columns={2}
          options={[
            { value: "session", label: sessionMap && sessionMap.length > 0 ? t.fromSession(sessionMap.length) : t.noSessionMap, disabled: !sessionMap || sessionMap.length === 0 },
            { value: "file", label: t.fromFile },
          ]}
        />
        {source === "file" && (
          <div className="flex flex-col gap-3">
            <input ref={picker} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void chooseFile(f); }} />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size={32} onClick={() => picker.current?.click()}>{t.chooseFile}</Button>
              {fileName && <span className="font-mono text-small text-fg-muted">{fileName}</span>}
            </div>
            {fileText !== null && !opened && (
              <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void openMap(); }}>
                <Field label={t.pass} error={mapErr ?? undefined}>
                  {(p) => <Input {...p} type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} />}
                </Field>
                <div>
                  <Button variant="secondary" size={32} type="submit" disabled={opening || pass.length === 0}>{opening ? t.opening : t.open}</Button>
                </div>
              </form>
            )}
            {opened && <p role="status" className="text-small text-accent">{t.opened(opened.length)}</p>}
            {fileText === null && mapErr && <p role="alert" className="text-small text-danger"><span aria-hidden="true">! </span>{mapErr}</p>}
          </div>
        )}
      </div>

      <ChoiceGroup
        legend={t.mode}
        value={mode}
        onChange={(m) => (setMode(m), setResult(null))}
        columns={2}
        options={[
          { value: "STRICT", label: t.strict, description: t.strictDesc },
          { value: "TOLERANT", label: t.tolerant, description: t.tolerantDesc },
        ]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => void run()} disabled={!ready || busy}>{busy ? t.running : t.run}</Button>
        <Button variant="ghost" onClick={wipeSession}>{t.clear}</Button>
        {!ready && <span className="text-small text-fg-muted">{t.needBoth}</span>}
      </div>
      {err && <p role="alert" className="text-small text-danger"><span aria-hidden="true">! </span>{err}</p>}

      {result && report && (
        <section aria-labelledby="restore-title" className="flex flex-col gap-4">
          <h2 id="restore-title" className="text-title-3 font-semibold tracking-subtitle">{t.resultTitle}</h2>
          <div aria-live="polite" className="flex flex-col gap-2 rounded-panel border border-border p-4">
            <h3 className="text-small font-medium text-fg-muted">{t.report}</h3>
            <ul className="flex flex-col gap-1 text-body">
              {lines.map((l) => <li key={l}>{l}</li>)}
            </ul>
            {report.unused.length > 0 && <p className="font-mono text-small text-fg-muted">{report.unused.join(" ")}</p>}
            {report.unknown.length > 0 && <p className="font-mono text-small text-warning">{report.unknown.join(" ")}</p>}
          </div>
          <p className="text-small text-fg-muted">{result.marks.length > 0 ? t.highlightNote : ""}</p>
          <DocView text={result.text} marks={result.marks} label={t.textLabel} className="h-96" />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={async () => toast((await copyText(result.text)) ? id.result.copied : id.result.copyFailed)}>{t.copy}</Button>
            <Button variant="secondary" onClick={() => downloadText(downloadName("dipulihkan", "txt"), result.text)}>{t.download}</Button>
          </div>
          <p className="border-l-2 border-border-strong pl-4 text-small text-fg-muted">{t.sensitiveNote}</p>
        </section>
      )}
    </div>
  );
}
