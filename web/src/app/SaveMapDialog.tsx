// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
import { useId, useState } from "react";
import { encryptTokenMap, MIN_PASSPHRASE_CHARS, passphraseLength } from "../crypto/tokenMap";
import type { TokenEntry } from "../engine/types";
import { downloadText } from "../flow/download";
import { id } from "../i18n/id";
import { Button, Dialog, Field, Input, useToast } from "../ui";

/** Passphrase dialog. The map is encrypted in the browser and downloaded; it never reaches the clipboard. */
export function SaveMapDialog({ open, onClose, map, fileName }: { open: boolean; onClose: () => void; map: TokenEntry[]; fileName: string }) {
  const toast = useToast();
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const t = id.result;
  const form = useId();
  const error = !touched ? undefined : passphraseLength(pass) < MIN_PASSPHRASE_CHARS ? t.mapShort : pass !== again ? t.mapMismatch : undefined;

  const close = () => {
    setPass("");
    setAgain("");
    setTouched(false);
    onClose();
  };
  const save = async () => {
    setTouched(true);
    if (passphraseLength(pass) < MIN_PASSPHRASE_CHARS || pass !== again) return;
    setBusy(true);
    try {
      downloadText(fileName, await encryptTokenMap(map, pass), "application/json");
      toast(t.mapSaved);
      close();
    } catch {
      toast(t.mapFailed, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={t.mapTitle}
      description={t.mapWarn}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t.cancel}</Button>
          {/* A submit button of the form (outside it), so Enter in a field saves. */}
          <Button variant="primary" type="submit" form={form} disabled={busy}>{busy ? t.mapSaving : t.mapSave}</Button>
        </>
      }
    >
      <form
        id={form}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={t.mapPass} hint={t.mapPassHint} error={error}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />}
        </Field>
        <Field label={t.mapConfirm}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />}
        </Field>
        <p className="text-small text-fg-muted">{t.mapNote}</p>
      </form>
    </Dialog>
  );
}
