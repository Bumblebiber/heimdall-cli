import { describe, test, expect } from "bun:test"
import {
  deriveKey,
  encrypt,
  decrypt,
  encryptEntry,
  decryptEntry,
  hashId,
  generateKeyMaterial,
  base58Encode,
  base58Decode,
} from "../../src/hmem/sync/crypto"

describe("encrypt / decrypt round-trip", () => {
  test("decrypts to original plaintext", () => {
    const { salt } = generateKeyMaterial()
    const key = deriveKey("my-passphrase", salt)
    const plaintext = "Hello, hmem sync!"
    const blob = encrypt(plaintext, key)
    expect(decrypt(blob, key)).toBe(plaintext)
  })

  test("each encrypt call produces a distinct blob (random IV)", () => {
    const { salt } = generateKeyMaterial()
    const key = deriveKey("passphrase", salt)
    const a = encrypt("same text", key)
    const b = encrypt("same text", key)
    expect(a).not.toBe(b)
  })

  test("wrong key throws on decrypt", () => {
    const { salt } = generateKeyMaterial()
    const key1 = deriveKey("correct-pass", salt)
    const key2 = deriveKey("wrong-pass", salt)
    const blob = encrypt("secret", key1)
    expect(() => decrypt(blob, key2)).toThrow()
  })

  test("truncated blob throws", () => {
    const { salt } = generateKeyMaterial()
    const key = deriveKey("passphrase", salt)
    expect(() => decrypt("dG9vc2hvcnQ=", key)).toThrow("too short")
  })
})

describe("encryptEntry / decryptEntry round-trip", () => {
  test("decrypts payload back to original object", () => {
    const { salt } = generateKeyMaterial()
    const key = deriveKey("passphrase", salt)
    const payload = {
      id: "L0001",
      level_1: "Top-level entry",
      tags: ["typescript", "testing"],
      obsolete: 0,
    }
    const blob = encryptEntry("L0001", payload, key, "2026-03-15T00:00:00Z")
    const result = decryptEntry(blob, key)
    expect(result).toEqual(payload)
  })

  test("blob contains updated_at in plaintext", () => {
    const { salt } = generateKeyMaterial()
    const key = deriveKey("passphrase", salt)
    const ts = "2026-03-15T12:00:00Z"
    const blob = encryptEntry("L0002", { data: 42 }, key, ts)
    expect(blob.updated_at).toBe(ts)
  })

  test("wrong key fails to decrypt entry", () => {
    const { salt } = generateKeyMaterial()
    const key1 = deriveKey("correct", salt)
    const key2 = deriveKey("incorrect", salt)
    const blob = encryptEntry("L0003", { secret: true }, key1, "2026-01-01T00:00:00Z")
    expect(() => decryptEntry(blob, key2)).toThrow()
  })
})

describe("hashId", () => {
  test("returns 32 hex characters", () => {
    const hash = hashId("L0001", "default", "somesalt==")
    expect(hash).toHaveLength(32)
    expect(hash).toMatch(/^[0-9a-f]{32}$/)
  })

  test("includes dbName for namespacing — different db, same entry ID → different hash", () => {
    const salt = "saltvalue=="
    const hashA = hashId("L0001", "dbA", salt)
    const hashB = hashId("L0001", "dbB", salt)
    expect(hashA).not.toBe(hashB)
  })

  test("same inputs always produce same hash (deterministic)", () => {
    const h1 = hashId("P0042", "mydb", "fixedsalt==")
    const h2 = hashId("P0042", "mydb", "fixedsalt==")
    expect(h1).toBe(h2)
  })

  test("different entry IDs produce different hashes", () => {
    const h1 = hashId("L0001", "db", "salt==")
    const h2 = hashId("L0002", "db", "salt==")
    expect(h1).not.toBe(h2)
  })
})

describe("generateKeyMaterial", () => {
  test("returns a non-empty base64 salt", () => {
    const { salt } = generateKeyMaterial()
    expect(salt.length).toBeGreaterThan(0)
    // Should be valid base64
    expect(() => Buffer.from(salt, "base64")).not.toThrow()
  })

  test("returns a recovery key with dashes (grouped)", () => {
    const { recoveryKey } = generateKeyMaterial()
    expect(recoveryKey).toContain("-")
  })

  test("generates unique material on each call", () => {
    const a = generateKeyMaterial()
    const b = generateKeyMaterial()
    expect(a.salt).not.toBe(b.salt)
    expect(a.recoveryKey).not.toBe(b.recoveryKey)
  })
})

describe("base58 encode / decode", () => {
  test("round-trips a 16-byte buffer (recovery key size)", () => {
    // base58Decode always pads to 16 bytes (RECOVERY_KEY_BYTES), so use a full 16-byte buffer
    const buf = Buffer.from("deadbeefcafe0102030405060708090a", "hex")
    const encoded = base58Encode(buf)
    const decoded = base58Decode(encoded)
    expect(decoded.toString("hex")).toBe(buf.toString("hex"))
  })

  test("decode strips dashes (recovery key format)", () => {
    const buf = Buffer.from("aabbccdd11223344aabbccdd11223344", "hex")
    const encoded = base58Encode(buf)
    // Simulate grouped format
    const grouped = (encoded.match(/.{1,5}/g) ?? [encoded]).join("-")
    const decoded = base58Decode(grouped)
    expect(decoded.toString("hex")).toBe(buf.toString("hex"))
  })

  test("invalid character throws", () => {
    expect(() => base58Decode("0invalid")).toThrow("Invalid Base58 character")
  })
})
