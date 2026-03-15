import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { read } from "../src/read"
import { deleteEntry } from "../src/delete"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("deleteEntry", () => {
  let store: Store
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "hmem-"))
    store = await Store.open(join(tempDir, "test.hmem"))
  })

  afterEach(() => {
    store.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("removes entry and children", () => {
    write(store, "L", "Root\n\tChild\n\t\tGrandchild")
    const deleted = deleteEntry(store, "L0001")
    expect(deleted).toBe(true)
    const entries = read(store, { id: "L0001" })
    expect(entries).toHaveLength(0)
  })

  it("returns false for non-existent", () => {
    expect(deleteEntry(store, "L9999")).toBe(false)
  })
})
