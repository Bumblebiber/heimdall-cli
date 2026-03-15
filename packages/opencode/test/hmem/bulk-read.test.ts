import { describe, test, expect } from "bun:test"
import { Store } from "../../src/hmem/store"
import { write } from "../../src/hmem/write"
import { bulkReadV2 } from "../../src/hmem/bulk-read"
import { rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

function makeDbPath(tag: string): string {
  return join(tmpdir(), `hmem-bulk-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
}

async function withStore(fn: (store: Store) => Promise<void> | void): Promise<void> {
  const path = makeDbPath("test")
  const store = await Store.open(path)
  try {
    await fn(store)
  } finally {
    store.close()
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = path + suffix
      if (existsSync(p)) try { rmSync(p) } catch {}
    }
  }
}

describe("bulkReadV2", () => {
  test("empty store returns empty array", async () => {
    await withStore((store) => {
      const result = bulkReadV2(store, {})
      expect(result).toHaveLength(0)
    })
  })

  test("returns entries with L2 children loaded", async () => {
    await withStore((store) => {
      // Write an entry with a child node (L2)
      write(store, "L", "Parent entry\n\tChild node content")

      const result = bulkReadV2(store, {})
      expect(result.length).toBeGreaterThan(0)

      const entry = result.find((e) => e.id === "L0001")
      expect(entry).toBeDefined()
      // Entry was written recently (< 24h), so loadChildrenToDepth(3) is used
      // but there is at least the direct L2 child
      expect(entry!.children.length).toBeGreaterThan(0)
      expect(entry!.children[0].content).toBe("Child node content")
    })
  })

  test("obsolete entries are excluded from selection", async () => {
    await withStore((store) => {
      const { id } = write(store, "L", "Normal entry")
      write(store, "L", "Another entry")

      // Mark L0001 as obsolete
      store.database.prepare("UPDATE memories SET obsolete = 1 WHERE id = ?").run(id)

      const result = bulkReadV2(store, {})
      const ids = result.map((e) => e.id)
      expect(ids).not.toContain("L0001")
      expect(ids).toContain("L0002")
    })
  })

  test("favorite entries are always included", async () => {
    await withStore((store) => {
      // Write two entries, mark one favorite
      const { id: id1 } = write(store, "L", "Favorite entry")
      write(store, "L", "Regular entry")

      store.database.prepare("UPDATE memories SET favorite = 1 WHERE id = ?").run(id1)

      const result = bulkReadV2(store, {})
      const ids = result.map((e) => e.id)
      expect(ids).toContain(id1)
    })
  })

  test("filters by prefix", async () => {
    await withStore((store) => {
      write(store, "L", "Learning entry")
      write(store, "P", "Project entry")
      write(store, "T", "Task entry")

      const result = bulkReadV2(store, { prefix: "L" })
      expect(result.every((e) => e.prefix === "L")).toBe(true)
      const ids = result.map((e) => e.id)
      expect(ids).toContain("L0001")
      expect(ids).not.toContain("P0001")
      expect(ids).not.toContain("T0001")
    })
  })
})
