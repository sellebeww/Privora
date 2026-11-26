// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { id } from "../i18n/id";
import { Button, Dialog, Kbd } from "../ui";

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title={id.shortcutsDialog.title} description={id.shortcutsDialog.hint} footer={<Button variant="secondary" onClick={onClose}>{id.shortcutsDialog.close}</Button>}>
      <ul className="flex flex-col divide-y divide-border rounded-panel border border-border">
        {id.help.sections.keys.rows.map(([k, d]) => (
          <li key={k} className="flex items-center justify-between gap-4 px-4 py-2">
            <span className="text-body">{d}</span>
            <Kbd>{k}</Kbd>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
