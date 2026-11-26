// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Test-only auditor for the PDF files Privora writes (never imported by the app). It does not trust
// the writer: it parses the bytes and accepts ONLY the exact object shapes below. Anything else
// (a font, /Info, XMP, an annotation, a name tree, an attachment, an id, a producer, a text
// operator) is reported, because the file would then be able to carry something besides pixels.
import { inflateSync } from "node:zlib";

export interface AuditImage {
  width: number;
  height: number;
  filter: "DCT" | "FLATE";
  predictor: boolean;
  colors: 1 | 3;
  data: Uint8Array;
}
export interface AuditPage {
  width: number;
  height: number;
  image: AuditImage;
}
export interface AuditReport {
  problems: string[];
  pages: AuditPage[];
}

const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

const CATALOG = /^<< \/Type \/Catalog \/Pages 2 0 R >>$/;
const PAGES = /^<< \/Type \/Pages \/Kids \[((?:\d+ 0 R ?)+)\] \/Count (\d+) >>$/;
const PAGE = /^<< \/Type \/Page \/Parent 2 0 R \/MediaBox \[0 0 ([\d.]+) ([\d.]+)\] \/Resources << \/XObject << \/Im0 (\d+) 0 R >> >> \/Contents (\d+) 0 R >>$/;
const CONTENTS = /^<< \/Length (\d+) >>$/;
const CONTENT_OPS = /^q [\d.]+ 0 0 [\d.]+ 0 0 cm \/Im0 Do Q\n$/;
const IMAGE =
  /^<< \/Type \/XObject \/Subtype \/Image \/Width (\d+) \/Height (\d+) \/ColorSpace \/Device(RGB|Gray) \/BitsPerComponent 8 \/Filter \/(DCTDecode|FlateDecode)( \/DecodeParms << \/Predictor 15 \/Colors (\d) \/BitsPerComponent 8 \/Columns (\d+) >>)? \/Length (\d+) >>$/;

interface Obj {
  num: number;
  dict: string;
  stream: Uint8Array | null;
}

function parseObjects(bytes: Uint8Array, problems: string[]): { objs: Obj[]; tail: string } {
  const objs: Obj[] = [];
  const head = latin1(bytes.subarray(0, 16));
  if (!head.startsWith("%PDF-1.4\n%")) problems.push("bad header");
  let i = head.indexOf("\n", 9) + 1;
  for (;;) {
    const probe = latin1(bytes.subarray(i, i + 24));
    const m = /^(\d+) 0 obj\n/.exec(probe);
    if (!m) break;
    const num = Number(m[1]);
    i += m[0].length;
    // The dictionary is one line; a stream follows on the next line.
    let j = i;
    while (j < bytes.length && bytes[j] !== 0x0a) j += 1;
    const dict = latin1(bytes.subarray(i, j));
    i = j + 1;
    let stream: Uint8Array | null = null;
    if (latin1(bytes.subarray(i, i + 7)) === "stream\n") {
      i += 7;
      const len = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? -1);
      if (len < 0 || i + len > bytes.length) {
        problems.push(`object ${num}: bad stream length`);
        break;
      }
      stream = bytes.subarray(i, i + len);
      i += len;
      if (latin1(bytes.subarray(i, i + 10)) !== "\nendstream") problems.push(`object ${num}: no endstream after the declared length`);
      i += 10 + 1; // "\nendstream" then "\n"
    }
    if (latin1(bytes.subarray(i, i + 7)) !== "endobj\n") problems.push(`object ${num}: no endobj`);
    i += 7;
    objs.push({ num, dict, stream });
  }
  return { objs, tail: latin1(bytes.subarray(i)) };
}

export function auditPdf(bytes: Uint8Array): AuditReport {
  const problems: string[] = [];
  const { objs, tail } = parseObjects(bytes, problems);
  const byNum = new Map(objs.map((o) => [o.num, o]));
  const pages: AuditPage[] = [];

  const catalog = byNum.get(1);
  if (!catalog || !CATALOG.test(catalog.dict) || catalog.stream) problems.push("object 1 is not the plain catalog");
  const tree = byNum.get(2);
  const treeM = tree ? PAGES.exec(tree.dict) : null;
  if (!tree || !treeM || tree.stream) problems.push("object 2 is not the plain page tree");
  const kids = (treeM?.[1] ?? "").trim().split(/ 0 R ?/).filter(Boolean).map(Number);
  if (treeM && Number(treeM[2]) !== kids.length) problems.push("page count differs from the kids");

  const used = new Set<number>([1, 2]);
  for (const k of kids) {
    used.add(k);
    const page = byNum.get(k);
    const pm = page ? PAGE.exec(page.dict) : null;
    if (!page || !pm || page.stream) {
      problems.push(`object ${k} is not a plain page`);
      continue;
    }
    const imgNum = Number(pm[3]);
    const conNum = Number(pm[4]);
    used.add(imgNum);
    used.add(conNum);
    const con = byNum.get(conNum);
    if (!con || !con.stream || !CONTENTS.test(con.dict) || !CONTENT_OPS.test(latin1(con.stream))) problems.push(`page ${k}: content is not just "draw one image"`);
    const img = byNum.get(imgNum);
    const im = img ? IMAGE.exec(img.dict) : null;
    if (!img || !im || !img.stream) {
      problems.push(`object ${imgNum} is not a plain image`);
      continue;
    }
    const filter = im[4] === "DCTDecode" ? "DCT" : "FLATE";
    const predictor = Boolean(im[5]);
    if (predictor && filter !== "FLATE") problems.push(`image ${imgNum}: predictor on a non Flate image`);
    pages.push({
      width: Number(pm[1]),
      height: Number(pm[2]),
      image: { width: Number(im[1]), height: Number(im[2]), filter, predictor, colors: im[3] === "RGB" ? 3 : 1, data: img.stream },
    });
  }
  for (const o of objs) if (!used.has(o.num)) problems.push(`object ${o.num} is not part of any page (unexpected)`);
  if (!/^xref\n0 \d+\n0000000000 65535 f \n(?:\d{10} 00000 n \n)+trailer\n<< \/Size \d+ \/Root 1 0 R >>\nstartxref\n\d+\n%%EOF\n$/.test(tail)) {
    problems.push("trailer is not the plain trailer (no /Info, no /ID, no /Encrypt)");
  }
  // Every xref offset must land on its own object, and startxref on the table.
  const entries = [...tail.matchAll(/(\d{10}) 00000 n \n/g)].map((m) => Number(m[1]));
  entries.forEach((off, k) => {
    if (latin1(bytes.subarray(off, off + 16)).startsWith(`${k + 1} 0 obj\n`)) return;
    problems.push(`xref entry ${k + 1} does not point at its object`);
  });
  const sx = Number(/startxref\n(\d+)\n/.exec(tail)?.[1] ?? -1);
  if (latin1(bytes.subarray(sx, sx + 5)) !== "xref\n") problems.push("startxref does not point at the table");
  return { problems, pages };
}

/** Raw RGB samples of a lossless image written by `encodeLossless`. Throws if the filter bytes are not "Up". */
export function decodeLossless(img: AuditImage): Uint8Array {
  if (img.filter !== "FLATE" || !img.predictor || img.colors !== 3) throw new RangeError("not a lossless Privora image");
  const raw = inflateSync(img.data);
  const stride = img.width * 3;
  if (raw.length !== (stride + 1) * img.height) throw new RangeError("unexpected decoded size");
  const out = new Uint8Array(stride * img.height);
  for (let y = 0; y < img.height; y += 1) {
    if (raw[y * (stride + 1)] !== 2) throw new RangeError("unexpected PNG filter");
    for (let i = 0; i < stride; i += 1) {
      const above = y === 0 ? 0 : (out[(y - 1) * stride + i] ?? 0);
      out[y * stride + i] = ((raw[y * (stride + 1) + 1 + i] ?? 0) + above) & 0xff;
    }
  }
  return out;
}

/** Strings found in the raw bytes in any of: UTF-8/latin1, UTF-16 LE, UTF-16 BE, hex (PDF hex strings), reversed. */
export function secretsInBytes(bytes: Uint8Array, secrets: readonly string[]): string[] {
  const hay = latin1(bytes);
  const hits: string[] = [];
  for (const s of secrets) {
    const utf16le = [...s].map((c) => c + "\0").join("");
    const utf16be = [...s].map((c) => "\0" + c).join("");
    const hex = [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    const variants = [s, utf16le, utf16be, hex, hex.toUpperCase()];
    if (variants.some((v) => hay.includes(v))) hits.push(s);
  }
  return hits;
}

/** Darkest-to-lightest check: the largest channel value inside the rectangle (0 means pure black). */
export function maxInside(rgb: Uint8Array, width: number, rect: { x: number; y: number; w: number; h: number }): number {
  let max = 0;
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const o = (y * width + x) * 3;
      max = Math.max(max, rgb[o] ?? 255, rgb[o + 1] ?? 255, rgb[o + 2] ?? 255);
    }
  }
  return max;
}
