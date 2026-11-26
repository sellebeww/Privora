// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Render and state tests on server-rendered markup (no DOM library is installed, see DECISIONS D-25).
// Keyboard and focus behaviour is covered in a real browser by e2e/ui.spec.ts.
import { renderToStaticMarkup as html } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { id } from "../i18n/id";
import { Badge, Button, Checkbox, ChoiceGroup, ConfidenceBadge, Dialog, Field, FindingsList, Input, Kbd, KindBadge, Progress, StatusChip, Switch, Tabs, Textarea, Tooltip, type FindingRow } from ".";

describe("Button", () => {
  it("renders the three variants and both heights", () => {
    expect(html(<Button variant="primary">x</Button>)).toContain("bg-accent");
    expect(html(<Button variant="secondary">x</Button>)).toContain("border-border-strong");
    expect(html(<Button variant="ghost">x</Button>)).toContain("bg-transparent");
    expect(html(<Button size={32}>x</Button>)).toContain("h-8");
    expect(html(<Button size={36}>x</Button>)).toContain("h-9");
  });
  it("is type=button by default (never submits by accident) and can be disabled", () => {
    expect(html(<Button>x</Button>)).toContain('type="button"');
    const d = html(<Button disabled>x</Button>);
    expect(d).toContain("disabled");
    expect(d).toContain("disabled:cursor-not-allowed");
  });
});

describe("Field, Input, Textarea", () => {
  it("wires label, hint and error to the control", () => {
    const m = html(<Field label="Nama" hint="Petunjuk" error="Salah">{(p) => <Input {...p} />}</Field>);
    const forId = /for="([^"]+)"/.exec(m)?.[1];
    expect(forId).toBeTruthy();
    expect(m).toContain(`id="${forId}"`);
    expect(m).toContain('aria-invalid="true"');
    expect(m).toMatch(/aria-describedby="[^"]+-hint [^"]+-err"/);
    expect(m).toContain('role="alert"');
  });
  // F-09: browser spell checkers can send field text to a vendor, and form restore can write it to disk.
  it("fields switch off spell checking, autofill and correction", () => {
    for (const m of [html(<Textarea />), html(<Input />)]) {
      expect(m).toContain('spellCheck="false"');
      expect(m).toContain('autoComplete="off"');
      expect(m).toContain('autoCorrect="off"');
      expect(m).toContain('autoCapitalize="off"');
    }
    expect(html(<Input type="password" autoComplete="new-password" />)).toContain('autoComplete="new-password"');
  });
  it("has no error markup when valid", () => {
    const m = html(<Field label="Nama">{(p) => <Textarea {...p} />}</Field>);
    expect(m).not.toContain("aria-invalid");
    expect(m).not.toContain('role="alert"');
  });
  it("shows the danger border for an invalid control", () => {
    expect(html(<Input aria-invalid="true" />)).toContain("border-danger");
    expect(html(<Input />)).not.toContain("border-danger");
    expect(html(<Input disabled />)).toContain("disabled");
  });
});

describe("Badge, Kbd, StatusChip", () => {
  it("kind badge is mono", () => expect(html(<KindBadge kind="NIK" />)).toContain("font-mono"));
  it("confidence badges carry text and a marker, not only a colour", () => {
    expect(html(<ConfidenceBadge confidence="TINGGI" />)).toContain("Tinggi");
    expect(html(<ConfidenceBadge confidence="SEDANG" />)).toContain("Sedang");
    const low = html(<ConfidenceBadge confidence="RENDAH" />);
    expect(low).toContain("Perkiraan");
    expect(low).toContain("●○○");
    expect(low).toContain('aria-hidden="true"');
  });
  it("tones", () => {
    expect(html(<Badge tone="danger">x</Badge>)).toContain("text-danger");
    expect(html(<Kbd>J</Kbd>)).toContain("<kbd");
  });
  it("status chip is a link only with href and always has a dot and text", () => {
    const a = html(<StatusChip href="verify.html">{id.status.local}</StatusChip>);
    expect(a).toContain('<a href="verify.html"');
    expect(a).toContain(id.status.local);
    expect(html(<StatusChip>x</StatusChip>)).toContain("<span");
  });
});

describe("Switch and Checkbox", () => {
  it("switch exposes role, state and name", () => {
    const on = html(<Switch label="Toleran" checked onCheckedChange={() => {}} />);
    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-checked="true"');
    expect(on).toMatch(/<\/span>Toleran<\/button>/); // the name comes from the button content
    expect(on).toContain("h-8"); // 32px target
    expect(html(<Switch label="x" checked={false} onCheckedChange={() => {}} />)).toContain('aria-checked="false"');
    expect(html(<Switch label="x" checked disabled onCheckedChange={() => {}} />)).toContain("disabled");
  });
  it("checkbox is a native input inside its label", () => {
    const m = html(<Checkbox label="Pilih" defaultChecked />);
    expect(m).toContain('type="checkbox"');
    expect(m).toContain("checked");
    expect(m.startsWith("<label")).toBe(true);
    expect(html(<Checkbox label="x" disabled />)).toContain("disabled");
  });
});

// One set of components. Native radios give arrow keys and a state that is not colour alone.
describe("ChoiceGroup", () => {
  it("is a fieldset of native radios with one checked, sharing one name", () => {
    const m = html(<ChoiceGroup legend="Gaya" value="b" onChange={() => {}} options={[{ value: "a", label: "A" }, { value: "b", label: "B", description: "dua" }]} />);
    expect(m).toContain("<legend");
    expect(m.match(/type="radio"/g)).toHaveLength(2);
    expect(m.match(/checked=""/g)).toHaveLength(1);
    expect(new Set(m.match(/name="[^"]+"/g)).size).toBe(1);
    expect(m).toContain("dua");
    expect(m).not.toContain("sr-only");
  });
});

describe("Progress", () => {
  it("determinate value is clamped and exposed", () => {
    expect(html(<Progress label="p" value={42} />)).toContain('aria-valuenow="42"');
    expect(html(<Progress label="p" value={250} />)).toContain('aria-valuenow="100"');
    expect(html(<Progress label="p" value={-4} />)).toContain('aria-valuenow="0"');
  });
  it("indeterminate has no valuenow", () => {
    const m = html(<Progress label="p" />);
    expect(m).not.toContain("aria-valuenow");
    expect(m).toContain("bar-indeterminate");
    expect(html(<Progress label="p" value={Number.NaN} />)).not.toContain("aria-valuenow");
  });
});

describe("Tabs", () => {
  const items = [
    { value: "a", label: "A", panel: <p>pa</p> },
    { value: "b", label: "B", panel: <p>pb</p> },
  ];
  it("roving tabindex, aria wiring, only the active panel has content", () => {
    const m = html(<Tabs label="t" value="b" onValueChange={() => {}} items={items} />);
    expect(m).toContain('role="tablist"');
    expect(m.match(/tabindex="0"/g)).toHaveLength(1);
    expect(m.match(/tabindex="-1"/g)).toHaveLength(1);
    expect(m).toMatch(/aria-selected="true"[^>]*>B</);
    expect(m).toContain("pb");
    expect(m).not.toContain("<p>pa</p>");
    const ctl = /aria-controls="([^"]+)"/.exec(m)?.[1];
    expect(m).toContain(`id="${ctl}"`);
  });
});

describe("Dialog and Tooltip", () => {
  it("dialog is labelled and its body only renders while open", () => {
    const closed = html(<Dialog open={false} onClose={() => {}} title="Judul">isi</Dialog>);
    expect(closed).toContain("<dialog");
    expect(closed).not.toContain("aria-labelledby"); // nothing to point to while closed
    expect(closed).not.toContain("isi");
    const open = html(<Dialog open onClose={() => {}} title="Judul" description="Desk">isi</Dialog>);
    expect(open).toContain("Judul");
    expect(open).toContain("isi");
    expect(open).toContain("aria-describedby");
    expect(open).toContain("aria-labelledby");
  });
  it("tooltip links the trigger and the bubble and starts hidden", () => {
    const m = html(<Tooltip text="Bantuan"><Button>x</Button></Tooltip>);
    const d = /aria-describedby="([^"]+)"/.exec(m)?.[1];
    expect(m).toContain(`id="${d}"`);
    expect(m).toContain('role="tooltip"');
    expect(m).toMatch(/role="tooltip"[^>]*hidden|hidden=""[^>]*role="tooltip"|<span[^>]*hidden[^>]*role="tooltip"/);
  });
});

const rows: FindingRow[] = [
  { key: "1", kind: "NIK", confidence: "TINGGI", reason: "Alasan", value: "111", selected: true },
  { key: "2", kind: "NIK", confidence: "SEDANG", reason: "Alasan", value: "222", selected: false },
  { key: "3", kind: "EMAIL", confidence: "RENDAH", reason: "Alasan", value: "a@b.test", selected: true },
];
describe("FindingsList", () => {
  const noop = () => {};
  it("groups by kind with counts, badges, checkboxes and jump buttons", () => {
    const m = html(<FindingsList rows={rows} onToggle={noop} onToggleAll={noop} onJump={noop} />);
    expect(m.match(/type="checkbox"/g)).toHaveLength(3);
    expect(m.match(/>Lompat</g)).toHaveLength(3);
    expect(m).toContain("2 dari 3 dipilih");
    expect(m).toContain("Perkiraan");
    expect(m.indexOf("NIK")).toBeLessThan(m.indexOf("EMAIL"));
  });
  it("only one row is a tab stop", () => {
    const m = html(<FindingsList rows={rows} onToggle={noop} onToggleAll={noop} onJump={noop} />);
    expect(m.match(/<li[^>]*tabindex="0"/g)).toHaveLength(1);
  });
  it("empty state says it is not a guarantee", () => {
    const m = html(<FindingsList rows={[]} onToggle={noop} onToggleAll={noop} onJump={noop} />);
    expect(m).toContain("Tidak ada data pribadi terdeteksi. Itu bukan jaminan; periksa sendiri.");
    expect(m).toContain('role="status"');
  });
});
