import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { bulkReadV2 } from "../src/bulk-read"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("bulkReadV2", () => {
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

  it("includes favorites always", () => {
    write(store, "L", "Normal entry")
    write(store, "L", "Favorite entry", { favorite: true })
    store.cache.recordAll(["L0001", "L0002"])
    const entries = bulkReadV2(store, {})
    const ids = entries.map((e) => e.id)
    expect(ids).toContain("L0002")
  })

  it("filters obsolete entries", () => {
    write(store, "L", "Active entry")
    write(store, "L", "Obsolete entry")
    store.database.prepare("UPDATE memories SET obsolete = 1 WHERE id = ?").run("L0002")
    const entries = bulkReadV2(store, {})
    const ids = entries.map((e) => e.id)
    expect(ids).not.toContain("L0002")
  })

  it("hides irrelevant entries", () => {
    write(store, "L", "Relevant entry")
    write(store, "L", "Irrelevant entry")
    store.database.prepare("UPDATE memories SET irrelevant = 1 WHERE id = ?").run("L0002")
    const entries = bulkReadV2(store, {})
    const ids = entries.map((e) => e.id)
    expect(ids).not.toContain("L0002")
  })
})
