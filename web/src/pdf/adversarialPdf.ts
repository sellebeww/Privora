// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// A hostile synthetic PDF for the export audit (SINTETIS): embedded TrueType font, shifted MediaBox,
// CropBox with /Rotate, vertical writing, invisible and off page text, annotations, AcroForm fields,
// an embedded file, XMP, /Info, outlines, JavaScript, a thumbnail and a hidden layer, each carrying
// its own marker string. Built independently of testPdf.ts. Imported by tests only, never by the app.
// The caller passes the TrueType bytes (pdfjs-dist ships LiberationSans), so nothing is committed.

export const ADV = {
  nik: "3171011505900001",
  nikVertical: "3273014107950002",
  mail: "budi.contoh@example.test",
} as const;

/** Strings that live only in places an export must never copy. */
export const HIDDEN_MARKERS = [
  "MARKINFO", "MARKXMP", "MARKATTACH", "MARKNOTE", "MARKFREE", "MARKLINK", "MARKFIELD", "MARKNOAP",
  "MARKJS", "MARKOUTLINE", "MARKPIECE", "MARKPAGEMETA", "MARKLAYER", "MARKOFFPAGE", "MARKINVISIBLE",
] as const;

/** Page 2: the vertical column. Baseline origin in user space, font size, and the digits' glyph offset. */
export const VERTICAL = { x: 300, y: 740, size: 20, prefix: "NIK: ", pageHeight: 792 } as const;

const latin = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Character code to glyph id from the (3,1) format 4 cmap, ASCII only. */
function glyphMap(ttf: Uint8Array): Map<number, number> {
  const v = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const u16 = (o: number) => v.getUint16(o);
  let cmap = 0;
  for (let i = 0; i < u16(4); i += 1) {
    const rec = 12 + i * 16;
    if (String.fromCharCode(...ttf.subarray(rec, rec + 4)) === "cmap") cmap = v.getUint32(rec + 8);
  }
  let sub = 0;
  for (let i = 0; i < u16(cmap + 2); i += 1) {
    const rec = cmap + 4 + i * 8;
    if (u16(rec) === 3 && u16(rec + 2) === 1) sub = cmap + v.getUint32(rec + 4);
  }
  if (!sub) throw new Error("no unicode cmap");
  const segs = u16(sub + 6) / 2;
  const map = new Map<number, number>();
  for (let s = 0; s < segs; s += 1) {
    const end = u16(sub + 14 + s * 2);
    const start = u16(sub + 16 + segs * 2 + s * 2);
    const delta = u16(sub + 16 + segs * 4 + s * 2);
    const at = sub + 16 + segs * 6 + s * 2;
    const range = u16(at);
    for (let c = start; c <= end && c < 127; c += 1) {
      map.set(c, range === 0 ? (c + delta) & 0xffff : (u16(at + range + (c - start) * 2) + delta) & 0xffff);
    }
  }
  return map;
}

export function makeAdversarialPdf(ttf: Uint8Array): Uint8Array {
  const glyphs = glyphMap(ttf);
  const hex = (s: string) => [...s].map((c) => (glyphs.get(c.charCodeAt(0)) ?? 0).toString(16).padStart(4, "0")).join("");
  const used = [...new Set([...` !#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz`])];
  const bf = used.map((c) => `<${hex(c)}> <${c.charCodeAt(0).toString(16).padStart(4, "0")}>`);
  const chunks: string[] = [];
  for (let i = 0; i < bf.length; i += 90) chunks.push(`${Math.min(90, bf.length - i)} beginbfchar ${bf.slice(i, i + 90).join(" ")} endbfchar`);
  const toUnicode = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Adv def 1 begincodespacerange <0000> <ffff> endcodespacerange ${chunks.join(" ")} endcmap end end`;

  const objs: Uint8Array[] = [];
  const reserve = () => objs.push(new Uint8Array()); // returns the object number
  const set = (n: number, body: string) => (objs[n - 1] = latin(body));
  const add = (body: string) => {
    const n = reserve();
    set(n, body);
    return n;
  };
  const stream = (dict: string, data: string | Uint8Array) => {
    const bytes = typeof data === "string" ? latin(data) : data;
    const n = reserve();
    objs[n - 1] = concat([latin(`<< ${dict} /Length ${bytes.length} >>\nstream\n`), bytes, latin("\nendstream")]);
    return n;
  };

  const catalog = reserve();
  const tree = reserve();
  const page1 = reserve();
  const page2 = reserve();

  const fontFile = stream(`/Length1 ${ttf.length}`, ttf);
  const descriptor = add(
    `<< /Type /FontDescriptor /FontName /LiberationSans /Flags 32 /FontBBox [-203 -303 1050 910] /ItalicAngle 0 /Ascent 905 /Descent -212 /CapHeight 700 /StemV 80 /FontFile2 ${fontFile} 0 R >>`,
  );
  const cidFont = add(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /LiberationSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 556 /CIDToGIDMap /Identity >>`,
  );
  const cmap = stream("", toUnicode);
  const font = (encoding: string) =>
    add(`<< /Type /Font /Subtype /Type0 /BaseFont /LiberationSans /Encoding /${encoding} /DescendantFonts [${cidFont} 0 R] /ToUnicode ${cmap} 0 R >>`);
  const across = font("Identity-H");
  const down = font("Identity-V");

  const layer = add("<< /Type /OCG /Name (MARKLAYER) >>");
  const show = (f: string, size: number, x: number, y: number, text: string, extra = "") => `BT ${extra} /${f} ${size} Tf ${x} ${y} Td <${hex(text)}> Tj ET\n`;
  const content1 = stream(
    "",
    show("H", 16, 100, 600, `NIK: ${ADV.nik}`) +
      show("H", 14, 100, 560, `Email: ${ADV.mail}`) +
      show("H", 12, 100, 520, "MARKINVISIBLE", "3 Tr") +
      show("H", 12, 2000, 2000, "MARKOFFPAGE") +
      `/OC /L BDC ${show("H", 12, 100, 480, "MARKLAYER")} EMC\n`,
  );
  const content2 = stream("", show("V", VERTICAL.size, VERTICAL.x, VERTICAL.y, `${VERTICAL.prefix}${ADV.nikVertical}`));

  const file = stream("/Type /EmbeddedFile", "isi lampiran MARKATTACH");
  const spec = add(`<< /Type /Filespec /F (MARKATTACH.txt) /UF (MARKATTACH.txt) /EF << /F ${file} 0 R >> >>`);
  const appearance = (text: string) =>
    stream(`/Type /XObject /Subtype /Form /BBox [0 0 220 20] /Resources << /Font << /H ${across} 0 R >> >>`, show("H", 10, 4, 6, text));
  const note = add(`<< /Type /Annot /Subtype /Text /Rect [400 650 420 670] /Contents (MARKNOTE ${ADV.nik}) /T (MARKNOTE) >>`);
  const free = add(`<< /Type /Annot /Subtype /FreeText /Rect [100 420 320 440] /Contents (MARKFREE) /DA (/H 10 Tf) /AP << /N ${appearance("catatan bebas")} 0 R >> >>`);
  const link = add("<< /Type /Annot /Subtype /Link /Rect [100 380 300 400] /A << /S /URI /URI (http://example.invalid/MARKLINK) >> >>");
  const clip = add(`<< /Type /Annot /Subtype /FileAttachment /Rect [440 650 460 670] /FS ${spec} 0 R /Contents (MARKATTACH) >>`);
  const filled = add(
    `<< /Type /Annot /Subtype /Widget /FT /Tx /T (MARKFIELD) /V (MARKFIELD ${ADV.nik}) /Rect [100 340 320 360] /P ${page1} 0 R /AP << /N ${appearance("isian formulir")} 0 R >> >>`,
  );
  const bare = add(`<< /Type /Annot /Subtype /Widget /FT /Tx /T (MARKNOAP) /V (MARKNOAP) /DA (/H 10 Tf 0 g) /Rect [100 300 320 320] /P ${page1} 0 R >>`);

  const thumb = stream("/Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8", "MARKTHUMBRGB");
  const xmp = (marker: string) =>
    stream("/Type /Metadata /Subtype /XML", `<?xpacket begin="" id="x"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><d>${marker} ${ADV.nik}</d></x:xmpmeta><?xpacket end="w"?>`);
  const pageMeta = xmp("MARKPAGEMETA");

  set(
    page1,
    `<< /Type /Page /Parent ${tree} 0 R /MediaBox [10 20 622 812] /CropBox [50 200 560 700] /Rotate 90 ` +
      `/Resources << /Font << /H ${across} 0 R >> /Properties << /L ${layer} 0 R >> >> /Contents ${content1} 0 R ` +
      `/Annots [${note} 0 R ${free} 0 R ${link} 0 R ${clip} 0 R ${filled} 0 R ${bare} 0 R] /Thumb ${thumb} 0 R /Metadata ${pageMeta} 0 R ` +
      `/PieceInfo << /Editor << /LastModified (D:20260101) /Private (MARKPIECE) >> >> >>`,
  );
  set(page2, `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 612 ${VERTICAL.pageHeight}] /Resources << /Font << /V ${down} 0 R >> >> /Contents ${content2} 0 R >>`);
  set(tree, `<< /Type /Pages /Kids [${page1} 0 R ${page2} 0 R] /Count 2 >>`);

  const script = add("<< /S /JavaScript /JS (app.alert\\('MARKJS'\\);) >>");
  const outlines = reserve();
  const item = add(`<< /Title (MARKOUTLINE) /Parent ${outlines} 0 R /Dest [${page1} 0 R /Fit] >>`);
  set(outlines, `<< /Type /Outlines /First ${item} 0 R /Last ${item} 0 R /Count 1 >>`);
  set(
    catalog,
    `<< /Type /Catalog /Pages ${tree} 0 R /Metadata ${xmp("MARKXMP")} 0 R /Outlines ${outlines} 0 R /OpenAction ${script} 0 R ` +
      `/Names << /EmbeddedFiles << /Names [(MARKATTACH.txt) ${spec} 0 R] >> /JavaScript << /Names [(MARKJS) ${script} 0 R] >> >> ` +
      `/AcroForm << /Fields [${filled} 0 R ${bare} 0 R] /NeedAppearances true /DR << /Font << /H ${across} 0 R >> >> >> ` +
      `/OCProperties << /OCGs [${layer} 0 R] /D << /OFF [${layer} 0 R] >> >> /Lang (id) >>`,
  );
  const info = add("<< /Author (MARKINFO) /Title (MARKINFO judul) /Producer (MARKINFO) >>");

  const parts: Uint8Array[] = [latin("%PDF-1.7\n%âãÏÓ\n")];
  let length = parts[0]!.length;
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(length);
    const obj = concat([latin(`${i + 1} 0 obj\n`), body, latin("\nendobj\n")]);
    parts.push(obj);
    length += obj.length;
  });
  const table = offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  parts.push(
    latin(
      `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${table}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R /ID [(MARKID) (MARKID)] >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return concat(parts);
}
