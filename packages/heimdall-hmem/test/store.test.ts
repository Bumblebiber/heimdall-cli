import { describe, it, expect, afterEach } from "vitest"
import { Store } from "../src/store"
import { existsSync, mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("Store", () => {
  let store: Store
  let tempDir: string

  afterEach(() => {
    store?.close()
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  })

  it("creates .hmem file on open", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "hmem-"))
    const dbPath = join(tempDir, "test.hmem")
    store = await Store.open(dbPath)
    expect(existsSync(dbPath)).toBe(true)
  })

  it("is idempotent on multiple opens", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "hmem-"))
    const dbPath = join(tempDir, "test.hmem")
    const store1 = await Store.open(dbPath)
    store1.close()
    store = await Store.open(dbPath)
    expect(existsSync(dbPath)).toBe(true)
  })

  it("creates parent directories", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "hmem-"))
    const dbPath = join(tempDir, "nested", "deep", "test.hmem")
    store = await Store.open(dbPath)
    expect(existsSync(dbPath)).toBe(true)
  })
})
