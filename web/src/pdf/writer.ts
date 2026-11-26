// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// A deliberately tiny PDF writer: one image per page, nothing else. The output has no fonts, no text
// operators, no /Info, no XMP, no annotations, no thumbnails, no names tree, no attachments, no
// producer, no document id. Everything in the file is made here from numbers and encoded pixels;
// nothing is copied from the source document. Every byte is accounted for below.

export interface PagePicture {
  /** Page size in points (what the viewer shows). */
  widthPt: number;
  heightPt: number;
  /** Image size in pixels. */
  widthPx: number;
  heightPx: number;
  /** DCT: a baseline or progressive JPEG already stripped by `stripJpeg`. FLATE: zlib compressed samples. */
  filter: "DCT" | "FLATE";
  colors: 1 | 3;
  /** For FLATE with a PNG "Up" predictor in the data (see export.ts). */
  predictor?: boolean;
  data: Uint8Array;
}

const enc = new TextEncoder();
const num = (n: number) => {
  if (!Number.isFinite(n)) throw new RangeError("not a finite number");
  return String(Math.round(n * 100) / 100);
};

export class PdfWriter {
  private parts: Uint8Array[] = [];
  private length = 0;
  private offsets = new Map<number, number>();
  private pages = 0;

  constructor() {
    // Header plus the conventional binary comment (bytes above 127), so tools treat the file as binary.
    this.push(new Uint8Array([...enc.encode("%PDF-1.4\n%"), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  }

  private push(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.length;
  }
  private text(s: string) {
    this.push(enc.encode(s));
  }
  private begin(n: number) {
    this.offsets.set(n, this.length);
    this.text(`${n} 0 obj\n`);
  }

  /** Objects: 1 catalog, 2 page tree (written last), then page, contents and image per page. */
  addPage(p: PagePicture): void {
    const base = 3 + this.pages * 3;
    this.pages += 1;
    this.begin(base);
    this.text(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.widthPt)} ${num(p.heightPt)}] ` +
        `/Resources << /XObject << /Im0 ${base + 2} 0 R >> >> /Contents ${base + 1} 0 R >>\nendobj\n`,
    );
    const content = enc.encode(`q ${num(p.widthPt)} 0 0 ${num(p.heightPt)} 0 0 cm /Im0 Do Q\n`);
    this.begin(base + 1);
    this.text(`<< /Length ${content.length} >>\nstream\n`);
    this.push(content);
    this.text("\nendstream\nendobj\n");

    const parms = p.filter === "FLATE" && p.predictor ? ` /DecodeParms << /Predictor 15 /Colors ${p.colors} /BitsPerComponent 8 /Columns ${p.widthPx} >>` : "";
    this.begin(base + 2);
    this.text(
      `<< /Type /XObject /Subtype /Image /Width ${p.widthPx} /Height ${p.heightPx} ` +
        `/ColorSpace /${p.colors === 3 ? "DeviceRGB" : "DeviceGray"} /BitsPerComponent 8 ` +
        `/Filter /${p.filter === "DCT" ? "DCTDecode" : "FlateDecode"}${parms} /Length ${p.data.length} >>\nstream\n`,
    );
    this.push(p.data);
    this.text("\nendstream\nendobj\n");
  }

  /** Bytes of the finished file as parts (a Blob can take them without copying into one buffer). */
  finish(): Uint8Array[] {
    if (this.pages === 0) throw new RangeError("a PDF needs at least one page");
    this.begin(1);
    this.text("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    const kids = Array.from({ length: this.pages }, (_, i) => `${3 + i * 3} 0 R`).join(" ");
    this.begin(2);
    this.text(`<< /Type /Pages /Kids [${kids}] /Count ${this.pages} >>\nendobj\n`);
    const count = 3 + this.pages * 3;
    const xref = this.length;
    let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let n = 1; n < count; n += 1) {
      const off = this.offsets.get(n);
      if (off === undefined) throw new Error("missing object");
      table += `${String(off).padStart(10, "0")} 00000 n \n`;
    }
    this.text(`${table}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return this.parts;
  }
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export interface JpegInfo {
  width: number;
  height: number;
  components: number;
  /** The JPEG without any application (APPn) or comment (COM) segment. */
  bytes: Uint8Array;
}

/**
 * Keep only what decoding needs: SOI, quantisation and Huffman tables, the frame header, restart
 * interval, the scan(s) and EOI. EXIF (with its embedded thumbnail), ICC, XMP and comments are
 * dropped, so the image cannot carry anything but pixels. Throws on anything that is not a JPEG.
 */
export function stripJpeg(src: Uint8Array): JpegInfo {
  if (src.length < 4 || src[0] !== 0xff || src[1] !== 0xd8) throw new RangeError("not a JPEG");
  const out: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)];
  let i = 2;
  let width = 0;
  let height = 0;
  let components = 0;
  let scans = 0;
  while (i + 1 < src.length) {
    if (src[i] !== 0xff) throw new RangeError("bad JPEG marker");
    const m = src[i + 1] ?? 0;
    if (m === 0xff) {
      i += 1;
      continue;
    }
    if (m === 0xd9) break;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      out.push(src.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = ((src[i + 2] ?? 0) << 8) | (src[i + 3] ?? 0);
    if (len < 2 || i + 2 + len > src.length) throw new RangeError("truncated JPEG");
    const seg = src.subarray(i, i + 2 + len);
    const sof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (sof) {
      height = ((src[i + 5] ?? 0) << 8) | (src[i + 6] ?? 0);
      width = ((src[i + 7] ?? 0) << 8) | (src[i + 8] ?? 0);
      components = src[i + 9] ?? 0;
    }
    const drop = (m >= 0xe0 && m <= 0xef) || m === 0xfe;
    if (!drop) out.push(seg);
    i += 2 + len;
    if (m === 0xda) {
      // Entropy coded data runs to the next real marker (not a stuffed 0xFF00 and not a restart marker).
      scans += 1;
      const from = i;
      while (i + 1 < src.length && !(src[i] === 0xff && (src[i + 1] ?? 0) !== 0 && !((src[i + 1] ?? 0) >= 0xd0 && (src[i + 1] ?? 0) <= 0xd7))) i += 1;
      if (i + 1 >= src.length) i = src.length;
      out.push(src.subarray(from, i));
    }
  }
  if (scans === 0 || width === 0 || height === 0 || (components !== 1 && components !== 3)) throw new RangeError("unsupported JPEG");
  out.push(Uint8Array.of(0xff, 0xd9));
  return { width, height, components, bytes: concat(out) };
}
