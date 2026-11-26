// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Invented PDFs for the browser tests (SINTETIS), with the true ink rectangles of every finding.
import { courierInk, makeTestPdf, type TestDoc, type TestPage, type TestPiece } from "../src/pdf/testPdf";
import type { Box } from "../src/pdf/geometry";

export const NIK = "3171011505900001";
export const PHONE = "0812-5550-0101";
export const MAIL = "budi.contoh@example.test";
export const SECRETS = [NIK, PHONE, MAIL, "Budi Contoh Santoso", "Budi Contoh", "lampiran.txt"];

const line = (text: string, x: number, y: number, size = 12): TestPiece => ({ text, x, y, size, font: "Courier" });

/** Page 1 upright, page 2 rotated 90 with a CropBox, page 3 an image only page. */
export function fixturePages(): TestPage[] {
  return [
    {
      width: 612,
      height: 792,
      extras: true,
      pieces: [
        line("Nama: Budi Contoh Santoso", 72, 700),
        line(`NIK: ${NIK}`, 72, 670),
        line(`Telp: ${PHONE}`, 72, 640),
        line(`Email: ${MAIL}`, 72, 610),
        { text: "Catatan biasa tanpa data pribadi", x: 72, y: 560, size: 12, font: "Helvetica" },
      ],
    },
    {
      width: 612,
      height: 792,
      rotate: 90,
      cropBox: [50, 100, 450, 700],
      pieces: [line(`NIK: ${NIK}`, 100, 500), line(`Email: ${MAIL}`, 100, 300, 10), { text: "Halaman dua tanpa data", x: 100, y: 250, size: 12, font: "Times-Roman" }],
    },
    { width: 400, height: 300, pieces: [], imageOnly: true },
  ];
}

export function fixtureDoc(): TestDoc {
  return { pages: fixturePages(), info: { author: "Budi Contoh", title: "Dokumen uji SINTETIS" } };
}
export const fixtureBytes = () => makeTestPdf(fixtureDoc());

/** Ink rectangles (page space) of what must be black in the output. */
export function inkTargets(): { page: number; what: string; box: Box }[] {
  const [p1, p2] = fixturePages() as [TestPage, TestPage];
  const at = (p: TestPage, i: number) => p.pieces[i] as TestPiece;
  return [
    { page: 0, what: "NIK", box: courierInk(p1, at(p1, 1), 5, 21) },
    { page: 0, what: "telepon", box: courierInk(p1, at(p1, 2), 6, 20) },
    { page: 0, what: "email", box: courierInk(p1, at(p1, 3), 7, 7 + MAIL.length) },
    { page: 0, what: "nama", box: courierInk(p1, at(p1, 0), 6, 25) },
    { page: 1, what: "NIK rotated", box: courierInk(p2, at(p2, 0), 5, 21) },
    { page: 1, what: "email rotated", box: courierInk(p2, at(p2, 1), 7, 7 + MAIL.length) },
  ];
}

/** A region of plain text no finding touches: must stay as in the source render. */
export const plainRegion = { page: 0, box: { x: 72, y: 792 - 560 - 4, w: 200, h: 6 } as Box };

export function manyPages(n: number): Uint8Array {
  const pages: TestPage[] = Array.from({ length: n }, (_, i) => ({
    width: 595,
    height: 842,
    pieces: [line(`Halaman ${i + 1}`, 72, 780), line(`NIK: ${NIK}`, 72, 700), line(`Email: ${MAIL}`, 72, 660), { text: "Teks biasa yang cukup panjang untuk mengisi baris ini dengan huruf", x: 72, y: 600, size: 11, font: "Times-Roman" }],
  }));
  return makeTestPdf({ pages });
}
