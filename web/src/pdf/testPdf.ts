// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Synthetic PDFs for tests (SINTETIS): hand written objects, standard fonts that are not embedded.
// Imported by tests and e2e only, never by the app.
import type { Box } from "./geometry.ts";

export type TestFont = "Helvetica" | "Courier" | "Times-Roman";

export interface TestPiece {
  text: string;
  /** Baseline origin in user space of the page (before the page's own `scale`). */
  x: number;
  y: number;
  size?: number;
  font?: TestFont;
  /** Break the text after this piece (sets hasEOL in pdf.js when the next piece is on another line). */
}

export interface TestPage {
  width: number;
  height: number;
  rotate?: 0 | 90 | 180 | 270;
  /** [x0, y0, x1, y1] */
  cropBox?: [number, number, number, number];
  /** Content is drawn through `q s 0 0 s 0 0 cm`. */
  scale?: number;
  pieces: TestPiece[];
  /** Paint a small image and no text on this page (a scanned page look). */
  imageOnly?: boolean;
  /** Add a text annotation, a thumbnail and an attachment (all carry SINTETIS data). */
  extras?: boolean;
  /** A filled in text field (AcroForm widget with an appearance stream), at this rectangle in user space. */
  widget?: { value: string; rect: [number, number, number, number] };
}

export interface TestDoc {
  pages: TestPage[];
  /** Adds /Info and an XMP stream with these invented values. */
  info?: { author: string; title: string };
  /** A standard security handler dictionary whose user password is not empty: opening needs a password. */
  encrypted?: boolean;
}

const FONT_OBJ: Record<TestFont, string> = {
  Helvetica: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  Courier: "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
  "Times-Roman": "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>",
};
const FONT_KEYS: TestFont[] = ["Helvetica", "Courier", "Times-Roman"];

const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
const n = (x: number) => String(Math.round(x * 1000) / 1000);

export function makeTestPdf(doc: TestDoc): Uint8Array {
  const objs: (string | Uint8Array)[] = [];
  const add = (body: string | Uint8Array) => {
    objs.push(body);
    return objs.length; // object number
  };
  // 1 catalog, 2 page tree: patched at the end.
  add("");
  add("");
  const fontRef: Record<string, number> = {};
  for (const f of FONT_KEYS) fontRef[f] = add(FONT_OBJ[f]);

  let infoRef = 0;
  let metaRef = 0;
  if (doc.info) {
    infoRef = add(`<< /Author (${esc(doc.info.author)}) /Title (${esc(doc.info.title)}) /Producer (SINTETIS producer) >>`);
    const xmp = `<?xpacket begin="\ufeff"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:creator>${doc.info.author}</dc:creator></x:xmpmeta><?xpacket end="w"?>`;
    metaRef = add(`<< /Type /Metadata /Subtype /XML /Length ${xmp.length} >>\nstream\n${xmp}\nendstream`);
  }

  const kids: number[] = [];
  const fields: number[] = [];
  for (const p of doc.pages) {
    const ops: string[] = [];
    if (p.scale && p.scale !== 1) ops.push(`q ${n(p.scale)} 0 0 ${n(p.scale)} 0 0 cm`);
    for (const t of p.pieces) {
      const key = FONT_KEYS.indexOf(t.font ?? "Helvetica") + 1;
      ops.push(`BT /F${key} ${n(t.size ?? 12)} Tf ${n(t.x)} ${n(t.y)} Td (${esc(t.text)}) Tj ET`);
    }
    if (p.scale && p.scale !== 1) ops.push("Q");
    let xobj = "";
    if (p.imageOnly) {
      const img = add(`<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 4 >>\nstream\n\x00\x80\x80\xff\nendstream`);
      xobj = `/XObject << /Im1 ${img} 0 R >>`;
      ops.push(`q ${n(p.width * 0.8)} 0 0 ${n(p.height * 0.8)} 20 20 cm /Im1 Do Q`);
    }
    const stream = ops.join("\n");
    const contents = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);

    let annots = "";
    let thumb = "";
    if (p.extras) {
      const thumbRef = add(`<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\x10\nendstream`);
      thumb = `/Thumb ${thumbRef} 0 R`;
      const file = "NIK 3171011505900001 (SINTETIS attachment)";
      const fileRef = add(`<< /Type /EmbeddedFile /Length ${file.length} >>\nstream\n${file}\nendstream`);
      const spec = add(`<< /Type /Filespec /F (lampiran.txt) /EF << /F ${fileRef} 0 R >> >>`);
      const note = add(`<< /Type /Annot /Subtype /Text /Rect [20 20 40 40] /Contents (Catatan: NIK 3171011505900001 SINTETIS) /T (Budi Contoh) >>`);
      const attach = add(`<< /Type /Annot /Subtype /FileAttachment /Rect [50 20 70 40] /FS ${spec} 0 R /Contents (lampiran) >>`);
      annots = `/Annots [${note} 0 R ${attach} 0 R]`;
    }
    if (p.widget) {
      const [wx0, wy0, wx1, wy1] = p.widget.rect;
      const ap = `BT /Helv 12 Tf 2 4 Td (${esc(p.widget.value)}) Tj ET`;
      const apRef = add(`<< /Type /XObject /Subtype /Form /BBox [0 0 ${n(wx1 - wx0)} ${n(wy1 - wy0)}] /Resources << /Font << /Helv ${fontRef["Helvetica"]} 0 R >> >> /Length ${ap.length} >>\nstream\n${ap}\nendstream`);
      const w = add(`<< /Type /Annot /Subtype /Widget /FT /Tx /T (nama) /V (${esc(p.widget.value)}) /Rect [${[wx0, wy0, wx1, wy1].map(n).join(" ")}] /F 4 /DA (/Helv 12 Tf 0 g) /AP << /N ${apRef} 0 R >> >>`);
      fields.push(w);
      annots = annots ? annots.replace("]", ` ${w} 0 R]`) : `/Annots [${w} 0 R]`;
    }
    const crop = p.cropBox ? `/CropBox [${p.cropBox.map(n).join(" ")}]` : "";
    const rot = p.rotate ? `/Rotate ${p.rotate}` : "";
    const page = add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(p.width)} ${n(p.height)}] ${crop} ${rot} ` +
        `/Resources << /Font << ${FONT_KEYS.map((f, i) => `/F${i + 1} ${fontRef[f]} 0 R`).join(" ")} >> ${xobj} >> /Contents ${contents} 0 R ${annots} ${thumb} >>`,
    );
    kids.push(page);
  }
  let encRef = 0;
  if (doc.encrypted) encRef = add(`<< /Filter /Standard /V 1 /R 2 /O <${"ab".repeat(32)}> /U <${"cd".repeat(32)}> /P -4 >>`);
  const acro = fields.length ? `/AcroForm << /Fields [${fields.map((f) => `${f} 0 R`).join(" ")}] /DA (/Helv 12 Tf 0 g) /DR << /Font << /Helv ${fontRef["Helvetica"]} 0 R >> >> >>` : "";
  objs[0] = `<< /Type /Catalog /Pages 2 0 R ${acro} ${metaRef ? `/Metadata ${metaRef} 0 R` : ""} >>`;
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  // Binary safe assembly: strings are latin1.
  const chunks: number[] = [];
  const put = (s: string | Uint8Array) => {
    if (typeof s === "string") for (let i = 0; i < s.length; i += 1) chunks.push(s.charCodeAt(i) & 0xff);
    else chunks.push(...s);
  };
  put("%PDF-1.4\n");
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(chunks.length);
    put(`${i + 1} 0 obj\n`);
    put(o);
    put("\nendobj\n");
  });
  const xref = chunks.length;
  put(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`);
  for (const o of offsets) put(`${String(o).padStart(10, "0")} 00000 n \n`);
  put(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R ${infoRef ? `/Info ${infoRef} 0 R` : ""} ${encRef ? `/Encrypt ${encRef} 0 R /ID [<${"01".repeat(16)}> <${"01".repeat(16)}>]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`);
  return Uint8Array.from(chunks);
}

/** Page space position of a user space point, computed from /Rotate and the CropBox without pdf.js. */
export function toPage(p: TestPage, x: number, y: number): [number, number] {
  const [x0, y0, x1, y1] = p.cropBox ?? [0, 0, p.width, p.height];
  switch (p.rotate ?? 0) {
    case 90:
      return [y - y0, x - x0];
    case 180:
      return [x1 - x, y - y0];
    case 270:
      return [y1 - y, x1 - x];
    default:
      return [x - x0, y1 - y];
  }
}

/**
 * Where the ink of characters `from..to` of a Courier piece really is, in page space. Courier advances
 * 0.6 em per character and digits, capitals and most lower case letters stay under 0.72 em above the baseline.
 */
export function courierInk(p: TestPage, t: TestPiece, from: number, to: number): Box {
  const s = p.scale ?? 1;
  const size = (t.size ?? 12) * s;
  const x0 = t.x * s + from * 0.6 * size;
  const x1 = t.x * s + to * 0.6 * size;
  const y0 = t.y * s;
  const y1 = t.y * s + 0.72 * size;
  const pts = [toPage(p, x0, y0), toPage(p, x1, y0), toPage(p, x0, y1), toPage(p, x1, y1)];
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
