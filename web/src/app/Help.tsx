// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { id } from "../i18n/id";
import { Kbd } from "../ui";
import { HonestList } from "./HonestList";

const SECTIONS = ["how", "limits", "tokens", "pdf", "offline", "keys"] as const;

export function Help() {
  return (
    <div className="mx-auto grid w-full max-w-[calc(var(--size-readable)+var(--size-nav)+48px)] gap-8 px-4 py-16 lg:grid-cols-[var(--size-nav)_minmax(0,1fr)]">
      <nav aria-label={id.help.toc} className="lg:sticky lg:top-[calc(var(--size-topbar)+32px)] lg:self-start">
        <h2 className="pb-3 text-small font-medium text-fg-muted">{id.help.toc}</h2>
        <ul className="flex flex-col gap-1">
          {[{ key: "honest", title: id.honest.title }, ...SECTIONS.map((k) => ({ key: k, title: id.help.sections[k].title }))].map(({ key: s, title }) => (
            <li key={s}>
              <a href={`#/bantuan/${s}`} onClick={(e) => { e.preventDefault(); document.getElementById(s)?.scrollIntoView(); }} className="inline-flex h-8 items-center rounded-control px-2 text-body text-fg-muted transition-colors hover:text-fg">
                {title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <article className="flex min-w-0 flex-col gap-12">
        <header className="flex flex-col gap-2">
          <h1 className="text-title-1 font-semibold tracking-title">{id.help.title}</h1>
          <p className="text-body text-fg-muted">{id.help.intro}</p>
        </header>
        <HonestList />
        {SECTIONS.map((s) => {
          const sec = id.help.sections[s];
          return (
            <section key={s} id={s} aria-labelledby={`${s}-h`} className="flex scroll-mt-[calc(var(--size-topbar)+16px)] flex-col gap-4">
              <h2 id={`${s}-h`} className="text-title-3 font-semibold tracking-subtitle">{sec.title}</h2>
              {sec.body.map((p) => (
                <p key={p} className="text-body text-fg-muted">{p}</p>
              ))}
              {"rows" in sec && (
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3">
                  {sec.rows.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt><Kbd>{k}</Kbd></dt>
                      <dd className="text-body text-fg-muted">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          );
        })}
      </article>
    </div>
  );
}
