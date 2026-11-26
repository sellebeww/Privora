// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Reading a user file as UTF-8 text, locally. Nothing is uploaded; nothing is stored.

export const TEXT_WARN_BYTES = 25 * 1024 * 1024;
export const PDF_WARN_BYTES = 50 * 1024 * 1024;
export const TEXT_EXTENSIONS = [".txt", ".md", ".csv"] as const;

export type FileErrorCode = "UNSUPPORTED_TYPE" | "ENCODING" | "EMPTY" | "READ_FAILED";
export class FileReadError extends Error {
  readonly code: FileErrorCode;
  constructor(code: FileErrorCode) {
    super(code);
    this.name = "FileReadError";
    this.code = code;
  }
}

export interface LoadedText {
  text: string;
  /** True when the file is over the soft limit (a warning, not a block). */
  large: boolean;
}

const ext = (name: string) => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
};

export function isPdf(name: string): boolean {
  return ext(name) === ".pdf";
}

/** The part of `File` this module needs, so tests do not need a browser. */
export interface FileLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Decode as strict UTF-8 (a bad byte is an error, never silently replaced), drop a leading BOM,
 * and keep the text exactly as written otherwise (line endings included).
 */
export async function readTextFile(file: FileLike): Promise<LoadedText> {
  if (!(TEXT_EXTENSIONS as readonly string[]).includes(ext(file.name))) throw new FileReadError("UNSUPPORTED_TYPE");
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch {
    throw new FileReadError("READ_FAILED");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buf);
  } catch {
    throw new FileReadError("ENCODING");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // A NUL byte is valid UTF-8 but never text: a binary file with a text name.
  if (text.includes("\u0000")) throw new FileReadError("ENCODING");
  if (text.trim().length === 0) throw new FileReadError("EMPTY");
  return { text, large: file.size > TEXT_WARN_BYTES };
}

/**
 * The name of a downloaded file. Fixed on purpose: a source name such as "KTP Budi 3171....txt"
 * can itself hold the data the user is hiding, so nothing of it is reused.
 */
export function downloadName(suffix: string, extension: string): string {
  return `dokumen-${suffix}.${extension}`;
}
