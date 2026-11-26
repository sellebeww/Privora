// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { id } from "../i18n/id";
import { Button, Progress, Skeleton } from "../ui";
import { FEATURE_KEYS, type Features } from "./features";

const box = "mx-auto flex w-full max-w-[var(--size-readable)] flex-col gap-4 rounded-panel border border-border bg-surface p-6";

/** Loading the WASM engine: skeleton of the workspace plus an indeterminate bar. */
export function WasmLoading() {
  return (
    <div role="status" aria-live="polite" className={box}>
      <h2 className="text-title-3 font-semibold tracking-subtitle">{id.states.wasmLoadingTitle}</h2>
      <p className="text-body text-fg-muted">{id.states.wasmLoadingBody}</p>
      <Progress label={id.states.wasmLoadingTitle} />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function PdfLoading() {
  return (
    <div role="status" aria-live="polite" className={box}>
      <p className="text-body text-fg">{id.states.pdfLoading}</p>
      <Progress label={id.states.pdfLoading} />
    </div>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className={box}>
      <h2 className="text-title-3 font-semibold tracking-subtitle text-danger">
        <span aria-hidden="true">! </span>
        {id.states.loadErrorTitle}
      </h2>
      <p className="text-body text-fg-muted">{id.states.loadErrorBody}</p>
      <div>
        <Button variant="secondary" onClick={onRetry}>
          {id.states.retry}
        </Button>
      </div>
    </div>
  );
}

export function Unsupported({ features }: { features: Features }) {
  return (
    <div role="alert" className={box}>
      <h2 className="text-title-3 font-semibold tracking-subtitle">{id.states.unsupportedTitle}</h2>
      <p className="text-body text-fg-muted">{id.states.unsupportedBody}</p>
      <ul className="flex flex-col gap-2">
        {FEATURE_KEYS.map((k) => (
          <li key={k} className="flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2">
            <span className="text-body">{id.states.features[k]}</span>
            <span className={features[k] ? "font-mono text-small text-accent" : "font-mono text-small text-danger"}>
              <span aria-hidden="true">{features[k] ? "+ " : "x "}</span>
              {features[k] ? id.states.present : id.states.missing}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
