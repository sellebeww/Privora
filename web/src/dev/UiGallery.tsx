// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Dev-only component gallery at /dev/ui. Imported only behind import.meta.env.DEV, so it never reaches dist/.
// Its labels are developer tooling, not product UI, so they are not part of the i18n catalogue (DECISIONS D-26).
import { useState, type ReactNode } from "react";
import { Badge, Button, Checkbox, ConfidenceBadge, Dialog, Field, FindingsList, Input, Kbd, KindBadge, Progress, Skeleton, StatusChip, Switch, Tabs, Textarea, ToastProvider, Tooltip, useToast, type FindingRow } from "../ui";
import { LoadError, PdfLoading, Unsupported, WasmLoading } from "../app/States";
import { Shell } from "../app/Shell";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 border-t border-border pt-6">
      <h2 className="text-title-3 font-semibold tracking-subtitle">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

const ROWS: FindingRow[] = [
  { key: "a", kind: "NIK", confidence: "TINGGI", reason: "Struktur valid dan kata kunci", value: "3171011505900001", selected: true },
  { key: "b", kind: "NAMA", confidence: "RENDAH", reason: "Mengikuti label Nama", value: "Budi Contoh Santoso", selected: false },
];

function ToastDemo() {
  const t = useToast();
  return (
    <>
      <Button onClick={() => t("Pesan biasa")}>Toast info</Button>
      <Button onClick={() => t("Sesuatu gagal", "error")}>Toast galat</Button>
    </>
  );
}

export function UiGallery() {
  const [sw, setSw] = useState(false);
  const [cb, setCb] = useState(true);
  const [tab, setTab] = useState("a");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(ROWS);
  const flip = (k: string) => setRows((r) => r.map((x) => (x.key === k ? { ...x, selected: !x.selected } : x)));
  return (
    <ToastProvider>
      <Shell>
        <div className="mx-auto flex w-full max-w-[var(--size-readable)] flex-col gap-8 px-4 py-16" data-testid="gallery">
          <h1 className="text-title-1 font-semibold tracking-title">Galeri komponen</h1>
          <Block title="Button">
            <Button variant="primary">Utama 36</Button>
            <Button variant="primary" size={32}>Utama 32</Button>
            <Button variant="secondary">Sekunder</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="primary" disabled>Nonaktif</Button>
            <Button variant="secondary" disabled>Nonaktif</Button>
          </Block>
          <Block title="Input dan Textarea">
            <div className="flex w-full flex-col gap-4">
              <Field label="Nama berkas" hint="Contoh petunjuk">{(p) => <Input {...p} placeholder="catatan.txt" />}</Field>
              <Field label="Frasa sandi" error="Minimal 12 karakter">{(p) => <Input {...p} defaultValue="pendek" />}</Field>
              <Field label="Catatan">{(p) => <Textarea {...p} />}</Field>
              <Field label="Nonaktif">{(p) => <Input {...p} disabled defaultValue="tidak bisa diubah" />}</Field>
            </div>
          </Block>
          <Block title="Tabs">
            <Tabs
              label="Contoh tab"
              value={tab}
              onValueChange={setTab}
              className="w-full"
              items={[
                { value: "a", label: "Satu", panel: <p>Isi satu</p> },
                { value: "b", label: "Dua", panel: <p>Isi dua</p> },
                { value: "c", label: "Tiga", panel: <p>Isi tiga</p> },
              ]}
            />
          </Block>
          <Block title="Badge dan Kbd">
            <KindBadge kind="NIK" />
            <ConfidenceBadge confidence="TINGGI" />
            <ConfidenceBadge confidence="SEDANG" />
            <ConfidenceBadge confidence="RENDAH" />
            <Badge tone="danger">Galat</Badge>
            <Kbd>J</Kbd>
            <Kbd>Spasi</Kbd>
          </Block>
          <Block title="Switch dan Checkbox">
            <Switch label="Mode toleran" checked={sw} onCheckedChange={setSw} />
            <Switch label="Nonaktif" checked disabled onCheckedChange={() => {}} />
            <Checkbox label="Pilih" checked={cb} onChange={() => setCb(!cb)} />
            <Checkbox label="Nonaktif" disabled />
          </Block>
          <Block title="Chip status">
            <StatusChip>Lokal. Tidak ada unggahan.</StatusChip>
            <StatusChip tone="warning">Peringatan</StatusChip>
            <StatusChip tone="danger">Galat</StatusChip>
          </Block>
          <Block title="Progress dan Skeleton">
            <div className="flex w-full flex-col gap-4">
              <Progress label="Contoh 60 persen" value={60} />
              <Progress label="Contoh tak tentu" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </Block>
          <Block title="Dialog, Tooltip, Toast">
            <Button onClick={() => setOpen(true)}>Buka dialog</Button>
            <Dialog
              open={open}
              onClose={() => setOpen(false)}
              title="Judul dialog"
              description="Deskripsi singkat."
              footer={<Button variant="primary" onClick={() => setOpen(false)}>Tutup</Button>}
            >
              <Field label="Isian">{(p) => <Input {...p} />}</Field>
            </Dialog>
            <Tooltip text="Teks bantuan"><Button variant="secondary">Dengan tooltip</Button></Tooltip>
            <ToastDemo />
          </Block>
          <Block title="Daftar temuan">
            <div className="w-full">
              <FindingsList rows={rows} onToggle={flip} onToggleAll={() => setRows((r) => r.map((x) => ({ ...x, selected: true })))} onJump={() => {}} />
            </div>
          </Block>
          <Block title="Keadaan">
            <div className="flex w-full flex-col gap-4">
              <WasmLoading />
              <PdfLoading />
              <LoadError onRetry={() => {}} />
              <Unsupported features={{ wasm: true, worker: false, crypto: true, blob: true }} />
            </div>
          </Block>
        </div>
      </Shell>
    </ToastProvider>
  );
}
