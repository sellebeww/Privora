// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { id } from "../i18n/id";

/** The five honest statements: Help, Verification and the landing page. */
export function HonestList({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <section id="honest" aria-labelledby="honest-title" className="flex scroll-mt-[calc(var(--size-topbar)+16px)] flex-col gap-4">
      <H id="honest-title" className="text-title-3 font-semibold tracking-subtitle">
        {id.honest.title}
      </H>
      <ol className="flex list-decimal flex-col gap-3 pl-6 text-body text-fg-muted marker:font-mono marker:text-fg-muted">
        {id.honest.items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
    </section>
  );
}
