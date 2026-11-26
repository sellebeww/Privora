// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Encrypted token map file. Format, version 1:
//   { "v": 1, "kdf": "PBKDF2-SHA256", "iter": 600000, "salt": b64(16), "iv": b64(12), "ct": b64 }
// Key: PBKDF2-HMAC-SHA-256(NFKC(passphrase) as UTF-8, salt, iter) -> 256 bit key.
// Cipher: AES-256-GCM, 96 bit random IV, 128 bit tag appended to `ct`.
// AAD: UTF-8 of `privora-map|v=<v>|kdf=<kdf>|iter=<iter>`, so the version and parameters are
// authenticated. Plaintext: JSON `{"entries": [[token, value], ...]}` (no document text).
// WebCrypto only. A map is personal data (pseudonymisation): it is never written anywhere here.
import type { TokenEntry } from "../engine/types.ts";

export const TOKEN_MAP_VERSION = 1;
export const KDF_NAME = "PBKDF2-SHA256";
/** OWASP minimum for PBKDF2-HMAC-SHA256 (D-19). New files always use this. */
export const PBKDF2_ITERATIONS = 600_000;
/** Upper bound on `iter` read from a file, so a hostile file cannot hang the tab. */
export const MAX_ITERATIONS = 10_000_000;
export const MIN_PASSPHRASE_CHARS = 12;
export const MAX_FILE_CHARS = 64 * 1024 * 1024;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type TokenMapErrorCode =
  | "PASSPHRASE_TOO_SHORT"
  | "UNSUPPORTED_VERSION"
  | "INVALID_FILE"
  /** Wrong passphrase and damaged file look the same on purpose. */
  | "DECRYPT_FAILED"
  | "CRYPTO_UNAVAILABLE";

export class TokenMapError extends Error {
  readonly code: TokenMapErrorCode;
  constructor(code: TokenMapErrorCode) {
    super(code);
    this.name = "TokenMapError";
    this.code = code;
  }
}

export interface EncryptedMapFile {
  v: number;
  kdf: string;
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new TokenMapError("CRYPTO_UNAVAILABLE");
  return s;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function b64decode(s: string): Bytes {
  if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new TokenMapError("INVALID_FILE");
  const bin = atob(s);
  const out: Bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const aad = (v: number, kdf: string, iter: number) => enc.encode(`privora-map|v=${v}|kdf=${kdf}|iter=${iter}`);

/** Code point count of the normalised passphrase. */
export function passphraseLength(passphrase: string): number {
  return [...passphrase.normalize("NFKC")].length;
}

async function deriveKey(passphrase: string, salt: Bytes, iter: number): Promise<CryptoKey> {
  const raw = enc.encode(passphrase.normalize("NFKC"));
  try {
    const base = await subtle().importKey("raw", raw, "PBKDF2", false, ["deriveKey"]);
    return await subtle().deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: iter },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    raw.fill(0);
  }
}

export interface Params {
  salt: Bytes;
  iv: Bytes;
  iter: number;
}

/**
 * Encrypt with explicit parameters. TESTS ONLY: reusing a (key, iv) pair breaks AES-GCM, so
 * application code must call [`encryptTokenMap`], which draws a fresh salt and IV every time.
 */
export async function encryptTokenMapWithParams(
  entries: readonly TokenEntry[],
  passphrase: string,
  p: Params,
): Promise<string> {
  if (passphraseLength(passphrase) < MIN_PASSPHRASE_CHARS) throw new TokenMapError("PASSPHRASE_TOO_SHORT");
  const key = await deriveKey(passphrase, p.salt, p.iter);
  const plain = enc.encode(JSON.stringify({ entries: entries.map((e) => [e.token, e.value]) }));
  try {
    const ct = new Uint8Array(
      await subtle().encrypt(
        { name: "AES-GCM", iv: p.iv, additionalData: aad(TOKEN_MAP_VERSION, KDF_NAME, p.iter), tagLength: 128 },
        key,
        plain,
      ),
    );
    const file: EncryptedMapFile = {
      v: TOKEN_MAP_VERSION,
      kdf: KDF_NAME,
      iter: p.iter,
      salt: b64encode(p.salt),
      iv: b64encode(p.iv),
      ct: b64encode(ct),
    };
    return JSON.stringify(file);
  } finally {
    plain.fill(0);
  }
}

/** Encrypt a token map into the text of a `.json` file. Needs a passphrase of 12+ characters. */
export function encryptTokenMap(entries: readonly TokenEntry[], passphrase: string): Promise<string> {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) return Promise.reject(new TokenMapError("CRYPTO_UNAVAILABLE"));
  return encryptTokenMapWithParams(entries, passphrase, {
    salt: c.getRandomValues(new Uint8Array(SALT_BYTES)),
    iv: c.getRandomValues(new Uint8Array(IV_BYTES)),
    iter: PBKDF2_ITERATIONS,
  });
}

const FILE_KEYS = ["ct", "iter", "iv", "kdf", "salt", "v"];

function parseFile(text: string): { file: EncryptedMapFile; salt: Bytes; iv: Bytes; ct: Bytes } {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_FILE_CHARS) throw new TokenMapError("INVALID_FILE");
  let f: unknown;
  try {
    f = JSON.parse(text);
  } catch {
    throw new TokenMapError("INVALID_FILE");
  }
  if (typeof f !== "object" || f === null || Array.isArray(f)) throw new TokenMapError("INVALID_FILE");
  const o = f as Record<string, unknown>;
  if (Object.keys(o).sort().join() !== FILE_KEYS.join()) throw new TokenMapError("INVALID_FILE");
  if (typeof o["v"] !== "number" || !Number.isInteger(o["v"])) throw new TokenMapError("INVALID_FILE");
  if (o["v"] !== TOKEN_MAP_VERSION) throw new TokenMapError("UNSUPPORTED_VERSION");
  if (o["kdf"] !== KDF_NAME) throw new TokenMapError("INVALID_FILE");
  const iter = o["iter"];
  // D-19: old files must stay readable, so there is no lower bound beyond 1 when reading.
  if (typeof iter !== "number" || !Number.isInteger(iter) || iter < 1 || iter > MAX_ITERATIONS) throw new TokenMapError("INVALID_FILE");
  if (typeof o["salt"] !== "string" || typeof o["iv"] !== "string" || typeof o["ct"] !== "string") throw new TokenMapError("INVALID_FILE");
  const salt = b64decode(o["salt"]);
  const iv = b64decode(o["iv"]);
  const ct = b64decode(o["ct"]);
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || ct.length < TAG_BYTES) throw new TokenMapError("INVALID_FILE");
  return { file: o as unknown as EncryptedMapFile, salt, iv, ct };
}

function toEntries(plain: Uint8Array): TokenEntry[] {
  const j: unknown = JSON.parse(dec.decode(plain));
  const list = (j as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(list)) throw new Error("shape");
  return list.map((p: unknown) => {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== "string" || typeof p[1] !== "string") throw new Error("shape");
    return { token: p[0], value: p[1] };
  });
}

/**
 * Decrypt the text of a map file. Throws `TokenMapError`: `INVALID_FILE` and
 * `UNSUPPORTED_VERSION` depend on the file alone; every failure that involves the key or the
 * ciphertext is `DECRYPT_FAILED`, so a wrong passphrase cannot be told from a damaged file.
 */
export async function decryptTokenMap(fileText: string, passphrase: string): Promise<TokenEntry[]> {
  const { file, salt, iv, ct } = parseFile(fileText);
  let plain: Uint8Array | null = null;
  try {
    const key = await deriveKey(passphrase, salt, file.iter);
    plain = new Uint8Array(
      await subtle().decrypt(
        { name: "AES-GCM", iv, additionalData: aad(file.v, file.kdf, file.iter), tagLength: 128 },
        key,
        ct,
      ),
    );
    return toEntries(plain);
  } catch (e) {
    if (e instanceof TokenMapError && e.code === "CRYPTO_UNAVAILABLE") throw e;
    throw new TokenMapError("DECRYPT_FAILED");
  } finally {
    plain?.fill(0);
  }
}
