// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Encrypted map file: round trip, wrong passphrase, tampering, fixed vector checked against an
// independent implementation (node:crypto), input validation. WebCrypto runs from Node.
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PBKDF2_ITERATIONS,
  TokenMapError,
  decryptTokenMap,
  encryptTokenMap,
  encryptTokenMapWithParams,
  passphraseLength,
  type EncryptedMapFile,
} from "./tokenMap.ts";

const PASS = "kata sandi uji panjang";
const ENTRIES = [
  { token: "[[NIK_1]]", value: "3174051509900001" },
  { token: "[[NAMA_1]]", value: "Siti Nurhaliza \u{1F600} É" },
];
const SALT = Uint8Array.from({ length: 16 }, (_, i) => i);
const IV = Uint8Array.from({ length: 12 }, (_, i) => 100 + i);

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(TokenMapError);
    return (e as TokenMapError).code;
  }
  return "resolved";
};

const parse = (s: string) => JSON.parse(s) as EncryptedMapFile;
const flipByteOfB64 = (b64: string, at: number) => {
  const bytes = Buffer.from(b64, "base64");
  bytes[at] = (bytes[at] as number) ^ 1;
  return bytes.toString("base64");
};

describe("encrypted token map", () => {
  it("round trips, with fresh salt and IV every time", async () => {
    const a = await encryptTokenMap(ENTRIES, PASS);
    const b = await encryptTokenMap(ENTRIES, PASS);
    expect(await decryptTokenMap(a, PASS)).toEqual(ENTRIES);
    expect(parse(a).salt).not.toBe(parse(b).salt);
    expect(parse(a).iv).not.toBe(parse(b).iv);
    expect(Object.keys(parse(a))).toEqual(["v", "kdf", "iter", "salt", "iv", "ct"]);
    expect(parse(a)).toMatchObject({ v: 1, kdf: "PBKDF2-SHA256", iter: PBKDF2_ITERATIONS });
  });

  it("holds only token and value pairs, and no plaintext leaks into the file", async () => {
    const f = await encryptTokenMap(ENTRIES, PASS);
    expect(f).not.toContain("3174051509900001");
    expect(f).not.toContain("Siti");
    expect(await decryptTokenMap(await encryptTokenMap([], PASS), PASS)).toEqual([]);
  });

  it("matches a fixed vector computed independently with node:crypto", async () => {
    const file = parse(await encryptTokenMapWithParams(ENTRIES, PASS, { salt: SALT, iv: IV, iter: PBKDF2_ITERATIONS }));
    const key = pbkdf2Sync(PASS.normalize("NFKC"), SALT, PBKDF2_ITERATIONS, 32, "sha256");
    const c = createCipheriv("aes-256-gcm", key, IV);
    c.setAAD(Buffer.from(`privora-map|v=1|kdf=PBKDF2-SHA256|iter=${PBKDF2_ITERATIONS}`));
    const plain = JSON.stringify({ entries: ENTRIES.map((e) => [e.token, e.value]) });
    const expected = Buffer.concat([c.update(plain, "utf8"), c.final(), c.getAuthTag()]);
    expect(file.ct).toBe(expected.toString("base64"));
    expect(file.salt).toBe(Buffer.from(SALT).toString("base64"));
    expect(file.iv).toBe(Buffer.from(IV).toString("base64"));
  });

  it("pins the format: this literal file must keep decrypting (version 1)", async () => {
    // Produced once by encryptTokenMapWithParams with SALT, IV and iter 600000 for ENTRIES, and
    // cross-checked against node:crypto above. If it stops decrypting, the format changed.
    const pinned = await encryptTokenMapWithParams(ENTRIES, PASS, { salt: SALT, iv: IV, iter: PBKDF2_ITERATIONS });
    expect(pinned).toBe(PINNED);
    expect(await decryptTokenMap(PINNED, PASS)).toEqual(ENTRIES);
  });

  it("wrong passphrase and a damaged file are the same error", async () => {
    const f = await encryptTokenMap(ENTRIES, PASS);
    const wrong = await codeOf(decryptTokenMap(f, PASS + "x"));
    const damaged = parse(f);
    damaged.ct = flipByteOfB64(damaged.ct, 3);
    const flipped = await codeOf(decryptTokenMap(JSON.stringify(damaged), PASS));
    expect(wrong).toBe("DECRYPT_FAILED");
    expect(flipped).toBe(wrong);
  });

  it("a file modified by a single byte anywhere in the secret fields is rejected", async () => {
    const f = parse(await encryptTokenMap(ENTRIES, PASS));
    const ctLen = Buffer.from(f.ct, "base64").length;
    const variants: EncryptedMapFile[] = [
      { ...f, ct: flipByteOfB64(f.ct, 0) },
      { ...f, ct: flipByteOfB64(f.ct, ctLen - 1) }, // inside the tag
      { ...f, salt: flipByteOfB64(f.salt, 0) },
      { ...f, iv: flipByteOfB64(f.iv, 11) },
      { ...f, iter: f.iter + 1 }, // parameters are in the AAD
    ];
    for (const v of variants) expect(await codeOf(decryptTokenMap(JSON.stringify(v), PASS))).toBe("DECRYPT_FAILED");
  });

  it("the version is authenticated: a v2 label is refused before any key work", async () => {
    const f = parse(await encryptTokenMap(ENTRIES, PASS));
    expect(await codeOf(decryptTokenMap(JSON.stringify({ ...f, v: 2 }), PASS))).toBe("UNSUPPORTED_VERSION");
  });

  it("enforces the passphrase minimum (12 characters, NFKC, code points)", async () => {
    expect(await codeOf(encryptTokenMap(ENTRIES, "sebelas ksr"))).toBe("PASSPHRASE_TOO_SHORT");
    expect(passphraseLength("sebelas ksr")).toBe(11);
    expect(await codeOf(encryptTokenMap(ENTRIES, "\u{1F600}".repeat(11)))).toBe("PASSPHRASE_TOO_SHORT");
    expect(await codeOf(encryptTokenMap(ENTRIES, "dua belas ksr"))).toBe("resolved");
    // Composed and decomposed forms of the same text are the same passphrase.
    const f = await encryptTokenMap(ENTRIES, "café café café");
    expect(await decryptTokenMap(f, "café café café")).toEqual(ENTRIES);
  });

  it("validates the file before using it", async () => {
    const good = parse(await encryptTokenMapWithParams(ENTRIES, PASS, { salt: SALT, iv: IV, iter: 1000 }));
    const bad = async (x: unknown) => codeOf(decryptTokenMap(typeof x === "string" ? x : JSON.stringify(x), PASS));
    expect(await bad("")).toBe("INVALID_FILE");
    expect(await bad("not json")).toBe("INVALID_FILE");
    expect(await bad("[]")).toBe("INVALID_FILE");
    expect(await bad("null")).toBe("INVALID_FILE");
    expect(await bad({ ...good, extra: 1 })).toBe("INVALID_FILE");
    const { ct, ...noCt } = good;
    void ct;
    expect(await bad(noCt)).toBe("INVALID_FILE");
    expect(await bad({ ...good, v: "1" })).toBe("INVALID_FILE");
    expect(await bad({ ...good, v: 1.5 })).toBe("INVALID_FILE");
    expect(await bad({ ...good, kdf: "PBKDF2-SHA1" })).toBe("INVALID_FILE");
    expect(await bad({ ...good, iter: 0 })).toBe("INVALID_FILE");
    expect(await bad({ ...good, iter: 1e9 })).toBe("INVALID_FILE"); // hostile cost
    expect(await bad({ ...good, iter: 10.5 })).toBe("INVALID_FILE");
    expect(await bad({ ...good, salt: "AAAA" })).toBe("INVALID_FILE");
    expect(await bad({ ...good, iv: "***" })).toBe("INVALID_FILE");
    expect(await bad({ ...good, ct: "AAAA" })).toBe("INVALID_FILE"); // shorter than a tag
    expect(await bad({ ...good, ct: 5 })).toBe("INVALID_FILE");
    expect(await bad(good)).toBe("resolved"); // old files with fewer iterations still open (D-19)
  });

  it("a plaintext of the wrong shape inside valid ciphertext is DECRYPT_FAILED, not a crash", async () => {
    const key = pbkdf2Sync(PASS, SALT, 1000, 32, "sha256");
    const c = createCipheriv("aes-256-gcm", key, IV);
    c.setAAD(Buffer.from("privora-map|v=1|kdf=PBKDF2-SHA256|iter=1000"));
    const ct = Buffer.concat([c.update('{"entries":[["a",5]]}', "utf8"), c.final(), c.getAuthTag()]);
    const file = { v: 1, kdf: "PBKDF2-SHA256", iter: 1000, salt: Buffer.from(SALT).toString("base64"), iv: Buffer.from(IV).toString("base64"), ct: ct.toString("base64") };
    expect(await codeOf(decryptTokenMap(JSON.stringify(file), PASS))).toBe("DECRYPT_FAILED");
  });

  it("error messages are only the code", async () => {
    const f = await encryptTokenMap(ENTRIES, PASS);
    try {
      await decryptTokenMap(f, "salah salah salah");
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toBe("DECRYPT_FAILED");
    }
  });
});

const PINNED =
  '{"v":1,"kdf":"PBKDF2-SHA256","iter":600000,"salt":"AAECAwQFBgcICQoLDA0ODw==","iv":"ZGVmZ2hpamtsbW5v","ct":"yoFgTxtUISkZ8+2LOGpZNfBifGB//KEzhrNyradGKWKYha+05RxCx9YzqFdKvJRoIU38gHyFYvuUdZA9U6OEjiyqEqqtLkLg89EiBWgq6fafMB4XFv2T1XgTA4N+hBu1t8FkmXMQ"}';
