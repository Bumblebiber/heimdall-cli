import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "./store.js"
import { write } from "./write.js"
import { bulkReadV2 } from "./bulk-read.js"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"

describe("bulkReadV2", () => {
  let store: Store
  let cleanup: () => void

  beforeEach(async () => {
    const dir = join(tmpdir(), `hmem-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, "test.hmem")
    store = await Store.open(path)
    cleanup = () => {
      store.close()
      try { rmSync(dir, { recursive: true }) } catch {}
    }
  })

  afterEach(() => cleanup())

  it("returns empty array for empty store", () => {
    const result = bulkReadV2(store, {})
    expect(result).toEqual([])
  })

  it("loads L2 children for all selected entries", () => {
    write(store, "L", "Test lesson learned\n\tDetailed explanation of the lesson", {
      tags: ["#test"],
    })

    const result = bulkReadV2(store, {})
    expect(result).toHaveLength(1)
    expect(result[0].level1).toBe("Test lesson learned")
    expect(result[0].children.length).toBeGreaterThan(0)
    expect(result[0].children[0].content).toBe("Detailed explanation of the lesson")
  })

  it("session-recency boost loads L2-L4 for entries < 24h", () => {
    write(store, "P", "Project milestone reached\n\tImplemented feature X\n\t\tUsed pattern Y for Z\n\t\t\tFull implementation details with code references", {
      tags: ["#project"],
    })

    const result = bulkReadV2(store, {})
    expect(result).toHaveLength(1)
    expect(result[0].children.length).toBeGreaterThan(0)
    const l2 = result[0].children[0]
    expect(l2.children.length).toBeGreaterThan(0)
    const l3 = l2.children[0]
    expect(l3.children.length).toBeGreaterThan(0)
  })

  it("old entries get only L2 children (no deep expansion)", () => {
    write(store, "P", "Old project\n\tOld detail\n\t\tOld deep\n\t\t\tOld deeper", {
      tags: ["#old"],
    })

    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    store.database.prepare("UPDATE memories SET created_at = ?").run(oldDate)

    const result = bulkReadV2(store, {})
    expect(result).toHaveLength(1)
    expect(result[0].children.length).toBeGreaterThan(0)
    const l2 = result[0].children[0]
    expect(l2.children).toEqual([])
  })

  it("always includes favorites regardless of selection", () => {
    for (let i = 0; i < 10; i++) {
      write(store, "L", `Lesson ${i}`)
    }
    store.database.prepare("UPDATE memories SET favorite = 1 WHERE seq = 1").run()

    const result = bulkReadV2(store, {})
    const favEntry = result.find((e) => e.favorite)
    expect(favEntry).toBeDefined()
  })

  it("write() accepts L2 content up to 300 chars (updated limit)", () => {
    const l2Content = "A".repeat(290)
    write(store, "L", `Short title\n\t${l2Content}`)

    const result = bulkReadV2(store, {})
    expect(result).toHaveLength(1)
    expect(result[0].children[0].content).toBe(l2Content)
  })
})
