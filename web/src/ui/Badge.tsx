// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import type { ReactNode } from "react";
import { cx } from "./cx";
import { id } from "../i18n/id";
import type { Confidence } from "../engine/types";

export type BadgeTone = "neutral" | "accent" | "warning" | "danger";
const TONE: Record<BadgeTone, string> = {
  neutral: "border-border-strong text-fg-muted",
  accent: "border-accent-border bg-accent-subtle text-accent",
  warning: "border-warning text-warning",
  danger: "border-danger text-danger",
};

export function Badge({ tone = "neutral", mono = false, children }: { tone?: BadgeTone; mono?: boolean; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1 rounded-chip border px-2 text-small whitespace-nowrap",
        mono && "font-mono",
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Kind of finding, in mono type (colour is not the only differentiator). */
export function KindBadge({ kind }: { kind: string }) {
  return <Badge mono>{kind}</Badge>;
}

const CONF: Record<Confidence, { tone: BadgeTone; mark: string; label: string }> = {
  TINGGI: { tone: "accent", mark: "●●●", label: id.confidence.TINGGI },
  SEDANG: { tone: "neutral", mark: "●●○", label: id.confidence.SEDANG },
  RENDAH: { tone: "warning", mark: "●○○", label: id.confidence.RENDAH },
};

/** Confidence badge: text plus a marker, so state never relies on colour alone. */
export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const c = CONF[confidence];
  return (
    <Badge tone={c.tone}>
      <span aria-hidden="true">
        {c.mark}
      </span>
      {c.label}
    </Badge>
  );
}
