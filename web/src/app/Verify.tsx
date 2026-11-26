// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// verify.html. It is run by the same code as the app and says so.
import { useEffect, useState, type ReactNode } from "react";
import { id } from "../i18n/id";
import { Badge, Button, CodeBlock, Progress, Table } from "../ui";
import {
  checkFiles, classifyUrl, confinesConnections, metaCsp, parseManifest, PROBE_URL, runProbe, sha256Hex,
  type FileRow, type ManifestFile, type ProbeResult, type UrlKind,
} from "../verify/logic";
import { readBuildFile, sendProbe } from "../verify/net";
import { HonestList } from "./HonestList";

const t = id.verify;
const policy = (csp: string) => csp.split(/;\s*/).join(";\n");

function Section({ name, title, children }: { name: string; title: string; children: ReactNode }) {
  return (
    <section id={name} aria-labelledby={`${name}-h`} className="flex flex-col gap-4">
      <h2 id={`${name}-h`} className="text-title-3 font-semibold tracking-subtitle">{title}</h2>
      {children}
    </section>
  );
}
const Text = ({ children }: { children: ReactNode }) => <p className="text-body text-fg-muted">{children}</p>;
const Steps = ({ items }: { items: readonly string[] }) => (
  <ol className="flex list-decimal flex-col gap-2 pl-6 text-body text-fg-muted">
    {items.map((s) => <li key={s}>{s}</li>)}
  </ol>
);

interface Build {
  files: ManifestFile[];
  hash: string;
}

/** undefined while loading, null when this is not a production build. */
function useBuild() {
  const [build, setBuild] = useState<Build | null | undefined>(undefined);
  useEffect(() => {
    void (async () => {
      const bytes = await (await readBuildFile("hashes.json")).arrayBuffer();
      const files = parseManifest(JSON.parse(new TextDecoder().decode(bytes)));
      setBuild(files ? { files, hash: await sha256Hex(bytes) } : null);
    })().catch(() => setBuild(null));
  }, []);
  return build;
}

function Csp({ build }: { build: Build | null | undefined }) {
  // Absent when rendered outside a browser (tests).
  const [own] = useState(() => (typeof document === "undefined" ? null : (document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? null)));
  const [app, setApp] = useState<string | null>(null);
  /** undefined: not read yet or unreadable; null: the server sends no header. */
  const [header, setHeader] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void readBuildFile("index.html")
      .then(async (r) => setApp(metaCsp(await r.text())))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const worker = build?.files.find((f) => /^assets\/worker-[\w-]+\.js$/.test(f.path));
    if (!worker) return;
    void readBuildFile(worker.path)
      .then((r) => setHeader(r.headers.get("content-security-policy")))
      .catch(() => undefined);
  }, [build]);
  return (
    <Section name="csp" title={t.csp.title}>
      <Text>{t.csp.lead}</Text>
      <CodeBlock label={t.csp.thisPage}>{own ? policy(own) : t.unavailable}</CodeBlock>
      <CodeBlock label={t.csp.appPage}>{app ? policy(app) : t.unavailable}</CodeBlock>
      <CodeBlock label={t.csp.worker}>{header ? policy(header) : t.unavailable}</CodeBlock>
      <p role="status" className="flex flex-wrap items-center gap-2 text-body text-fg-muted">
        {header === undefined ? t.csp.workerUnknown : header === null ? <><Badge tone="danger">!</Badge>{t.csp.workerMissing}</>
          : confinesConnections(header) ? t.csp.workerOk : <><Badge tone="danger">!</Badge>{t.csp.workerWeak}</>}
      </p>
    </Section>
  );
}

function Probe() {
  const [state, setState] = useState<ProbeResult | "running" | null>(null);
  const run = async () => {
    setState("running");
    setState(await runProbe(document, sendProbe));
  };
  return (
    <Section name="probe" title={t.probe.title}>
      <Text>{t.probe.lead}</Text>
      <div>
        <Button variant="primary" onClick={() => void run()} disabled={state === "running"}>{t.probe.run}</Button>
      </div>
      <p role="status" className="flex flex-wrap items-center gap-2 text-body text-fg">
        {state === "running" ? t.probe.running : state && (
          state.blockedByCsp
            ? <><Badge tone="accent">OK</Badge>{t.probe.blocked(state.directive ?? "")}</>
            : <><Badge tone="danger">!</Badge>{t.probe.notBlocked}</>
        )}
      </p>
      <Text>{t.probe.scope}</Text>
    </Section>
  );
}

interface Entry {
  url: string;
  type: string;
  kind: UrlKind;
}
const readEntries = (): Entry[] =>
  [...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")].map((e) => ({
    url: e.name,
    type: (e as PerformanceResourceTiming).initiatorType || e.entryType,
    kind: classifyUrl(e.name, location.origin),
  }));

function Resources() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const refresh = () => setEntries(readEntries());
  useEffect(() => {
    // The default buffer (250) is smaller than a full hash run.
    performance.setResourceTimingBufferSize(2000);
    // `buffered` replays what loaded before this effect; later requests show up by themselves.
    const observer = new PerformanceObserver(() => setEntries(readEntries()));
    observer.observe({ type: "resource", buffered: true });
    return () => observer.disconnect();
  }, []);
  const external = entries.filter((e) => e.kind === "LUAR").length;
  return (
    <Section name="resources" title={t.resources.title}>
      <Text>{t.resources.lead}</Text>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={refresh}>{t.resources.refresh}</Button>
        <p role="status" className="text-body text-fg tabular-nums">{t.resources.summary(entries.length, external)}</p>
      </div>
      <Table label={t.resources.tableLabel} head={[t.resources.url, t.resources.type, t.resources.origin]}>
        {entries.map((e, i) => (
          <tr key={i}>
            <td className="font-mono break-all text-fg">{e.url}{e.url === PROBE_URL && ` (${t.resources.probeEntry})`}</td>
            <td className="text-fg-muted">{e.type}</td>
            <td><Badge tone={e.kind === "LUAR" ? "danger" : "neutral"}>{t.resources.kinds[e.kind]}</Badge></td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

const TONE = { SAMA: "accent", BEDA: "danger", TIDAK_TERBACA: "danger", TIDAK_DISAJIKAN: "neutral" } as const;

function Hashes({ build }: { build: Build | null | undefined }) {
  const [rows, setRows] = useState<FileRow[] | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [cached, setCached] = useState(false);
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const update = () => setCached(sw.controller !== null);
    update();
    sw.addEventListener("controllerchange", update);
    return () => sw.removeEventListener("controllerchange", update);
  }, []);
  if (!build) {
    return (
      <Section name="hashes" title={t.hashes.title}>
        <Text>{t.hashes.lead}</Text>
        <p role="status" className="text-body text-fg-muted">{build === null ? t.hashes.noManifest : t.loading}</p>
      </Section>
    );
  }
  const run = async () => {
    setRows(null);
    setDone(0);
    setRows(await checkFiles(build.files, async (p) => (await readBuildFile(p)).arrayBuffer(), setDone));
    setDone(null);
  };
  const count = (s: FileRow["status"]) => rows?.filter((r) => r.status === s).length ?? 0;
  const bad = count("BEDA") + count("TIDAK_TERBACA");
  const size = `${(build.files.reduce((n, f) => n + f.bytes, 0) / 1048576).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB`;
  const shown = rows ?? build.files.map((f) => ({ path: f.path, expected: f.sha256, actual: null, status: null }));
  // Anything that does not match comes first.
  const ordered = [...shown].sort((a, b) => Number(b.status === "BEDA" || b.status === "TIDAK_TERBACA") - Number(a.status === "BEDA" || a.status === "TIDAK_TERBACA"));
  return (
    <Section name="hashes" title={t.hashes.title}>
      <Text>{t.hashes.lead}</Text>
      <p className="text-body text-fg tabular-nums">{t.hashes.files(build.files.length, size)}</p>
      <CodeBlock label={t.hashes.manifestHash}>{build.hash}</CodeBlock>
      <Text>{cached ? t.hashes.fromCache : t.hashes.fromServer}</Text>
      <div>
        <Button variant="primary" onClick={() => void run()} disabled={done !== null}>{t.hashes.run}</Button>
      </div>
      {done !== null && <Progress label={t.hashes.running(done, build.files.length)} value={(done / build.files.length) * 100} />}
      <div role="status" className="flex flex-col gap-2 text-body text-fg">
        {rows && (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={bad ? "danger" : "accent"}>{bad ? "!" : "OK"}</Badge>
              {bad ? t.hashes.mismatch(count("BEDA"), count("TIDAK_TERBACA")) : t.hashes.allSame(count("SAMA"))}
            </p>
            {count("TIDAK_DISAJIKAN") > 0 && <Text>{t.hashes.skipped(count("TIDAK_DISAJIKAN"))}</Text>}
          </>
        )}
      </div>
      <Text>{t.hashes.caveat}</Text>
      <details>
        <summary className="flex h-8 cursor-pointer items-center rounded-control text-body text-fg">{t.hashes.all}</summary>
        <Table label={t.hashes.tableLabel} head={[t.hashes.path, t.hashes.hash, t.hashes.status]}>
          {ordered.map((r) => (
            <tr key={r.path}>
              <td className="font-mono break-all text-fg">{r.path}</td>
              <td className="font-mono break-all text-fg-muted">{r.actual ?? r.expected}</td>
              <td>{r.status && <Badge tone={TONE[r.status]}>{t.hashes.statuses[r.status]}</Badge>}</td>
            </tr>
          ))}
        </Table>
      </details>
    </Section>
  );
}

export function Verify() {
  const build = useBuild();
  return (
    <div className="mx-auto flex w-full max-w-[var(--size-readable)] flex-col gap-12 px-4 py-16">
      <header className="flex flex-col gap-4">
        <h1 className="text-title-1 font-semibold tracking-title">{t.title}</h1>
        <Text>{t.intro}</Text>
        <p className="border-l-2 border-warning pl-4 text-body text-fg">{t.honestNote}</p>
      </header>
      <Csp build={build} />
      <Probe />
      <Resources />
      <Hashes build={build} />
      <Section name="repro" title={t.repro.title}>
        <Steps items={t.repro.steps} />
        <CodeBlock label={t.repro.commandsLabel}>{t.repro.commands}</CodeBlock>
        <Text>{t.repro.limit}</Text>
      </Section>
      <Section name="manual" title={t.manual.title}>
        <h3 className="text-body font-semibold">{t.manual.networkTitle}</h3>
        <Steps items={t.manual.network} />
        <h3 className="text-body font-semibold">{t.manual.offlineTitle}</h3>
        <Steps items={t.manual.offline} />
      </Section>
      <HonestList />
      <p className="flex flex-wrap gap-6">
        <a href="./#/" className="inline-flex h-8 items-center text-body text-fg underline underline-offset-4">{t.back}</a>
        <a href="licenses.txt" className="inline-flex h-8 items-center text-body text-fg underline underline-offset-4">{t.licences}</a>
      </p>
    </div>
  );
}
