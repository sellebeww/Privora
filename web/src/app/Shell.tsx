// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import type { ReactNode } from "react";
import { id } from "../i18n/id";
import { StatusChip } from "../ui";
import { UpdateBanner } from "./UpdateBanner";
import { Wordmark } from "./Wordmark";

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-[var(--size-topbar)] shrink-0 items-center justify-between border-b border-border bg-bg px-4">
      <a href="./#/" className="inline-flex h-8 items-center rounded-control" aria-label={`${id.appName}, ${id.nav.home}`}>
        <Wordmark />
      </a>
      <nav aria-label={id.nav.main} className="flex items-center gap-3">
        <a href="verify.html" aria-label={`${id.status.local} ${id.status.verifyHint}`} className="rounded-chip">
          <StatusChip>
            <span className="sm:hidden">{id.status.localShort}</span>
            <span className="hidden sm:inline">{id.status.local}</span>
          </StatusChip>
        </a>
        <a href="./#/pulihkan" className="inline-flex h-8 items-center rounded-control px-2 text-body text-fg-muted transition-colors hover:text-fg">
          {id.nav.restore}
        </a>
        <a href="./#/bantuan" className="inline-flex h-8 items-center rounded-control px-2 text-body text-fg-muted transition-colors hover:text-fg">
          {id.nav.help}
        </a>
      </nav>
    </header>
  );
}

/** Skip link, 56px top bar and the main landmark. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink">
        {id.skipToContent}
      </a>
      <TopBar />
      <UpdateBanner />
      <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
        {children}
      </main>
    </div>
  );
}
