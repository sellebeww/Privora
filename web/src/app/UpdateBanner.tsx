// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { useSyncExternalStore } from "react";
import { id } from "../i18n/id";
import { updateStore } from "../offline/register";
import { Button } from "../ui";

/** Shown when a new version is installed and waiting. Nothing reloads unless the user presses the button. */
export function UpdateBanner() {
  const apply = useSyncExternalStore(updateStore.subscribe, updateStore.get, () => null);
  return (
    <div role="status" aria-live="polite">
      {apply && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-accent-border bg-accent-subtle px-4 py-3">
          <p className="min-w-0 text-body text-fg">
            <strong className="font-semibold">{id.update.title}.</strong> {id.update.warn}
          </p>
          <div className="flex gap-2">
            <Button variant="primary" size={32} onClick={apply}>
              {id.update.apply}
            </Button>
            <Button variant="ghost" size={32} onClick={updateStore.dismiss}>
              {id.update.later}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
