import { describe, test, expect, afterEach } from "bun:test"
import { Store } from "../../src/hmem/store"
import { rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const testDbPath = join(tmpdir(), `hmem-store-test-${Date.now()}.db`)

afterEach(() => {
  if (existsSync(testDbPath)) {
    try { rmSync(testDbPath) } catch {}
  }
  if (existsSync(testDbPath + "-wal")) {
    try { rmSync(testDbPath + "-wal") } catch {}
  }
  if (existsSync(testDbPath + "-shm")) {
    try { rmSync(testDbPath + "-shm") } catch {}
  }
})

describe("Store", () => {
  test("opens and creates required tables", async () => {
    const store = await Store.open(testDbPath)
    const db = store.database

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const tableNames = tables.map((t) => t.name)

    expect(tableNames).toContain("memories")
    expect(tableNames).toContain("memory_nodes")
    expect(tableNames).toContain("memory_tags")

    store.close()
  })

  test("enables WAL journal mode", async () => {
    const store = await Store.open(testDbPath)
    const db = store.database

    const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }
    expect(row.journal_mode).toBe("wal")

    store.close()
  })

  test("is idempotent: opening twice does not throw", async () => {
    const store1 = await Store.open(testDbPath)
    store1.close()

    const store2 = await Store.open(testDbPath)
    const db = store2.database
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).toContain("memories")
    store2.close()
  })
})
