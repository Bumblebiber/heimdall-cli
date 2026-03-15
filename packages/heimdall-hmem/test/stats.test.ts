import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { stats, healthCheck } from "../src/stats"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("stats", () => {
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

  it("returns zero for empty store", () => {
    const s = stats(store)
    expect(s.total).toBe(0)
  })

  it("counts by prefix and chars", () => {
    write(store, "L", "Learning entry")
    write(store, "P", "Project entry")
    write(store, "L", "Another learning")
    const s = stats(store)
    expect(s.total).toBe(3)
    expect(s.byPrefix["L"]).toBe(2)
    expect(s.byPrefix["P"]).toBe(1)
    expect(s.totalChars).toBeGreaterThan(0)
  })

  it("reports clean health on empty db", () => {
    const h = healthCheck(store)
    expect(h.brokenLinks).toHaveLength(0)
    expect(h.tagOrphans).toBe(0)
  })
})
