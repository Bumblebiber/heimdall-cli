import { describe, test, expect } from "bun:test"
import { Store } from "../../src/hmem/store"
import { write } from "../../src/hmem/write"
import { read, readL1Headers } from "../../src/hmem/read"
import { rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

function makeDbPath(tag: string): string {
  return join(tmpdir(), `hmem-rw-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
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

describe("write + read by ID", () => {
  test("write returns an id and timestamp", async () => {
    await withStore((s) => {
      const result = write(s, "L", "Hello world")
      expect(result.id).toBe("L0001")
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  test("read by id returns the written entry", async () => {
    await withStore((s) => {
      write(s, "L", "Test entry content")
      const entries = read(s, { id: "L0001" })
      expect(entries).toHaveLength(1)
      expect(entries[0].id).toBe("L0001")
      expect(entries[0].level1).toBe("Test entry content")
    })
  })

  test("read with non-existent id returns empty array", async () => {
    await withStore((s) => {
      const entries = read(s, { id: "L9999" })
      expect(entries).toHaveLength(0)
    })
  })
})

describe("sequence increments", () => {
  test("sequence increments per prefix", async () => {
    await withStore((s) => {
      const r1 = write(s, "L", "First")
      const r2 = write(s, "L", "Second")
      const r3 = write(s, "P", "Project entry")
      expect(r1.id).toBe("L0001")
      expect(r2.id).toBe("L0002")
      expect(r3.id).toBe("P0001")
    })
  })
})

describe("FTS search", () => {
  test("search finds entries by keyword", async () => {
    await withStore((s) => {
      write(s, "L", "TypeScript is a superset of JavaScript")
      write(s, "L", "Python is great for data science")

      const results = read(s, { search: "TypeScript" })
      expect(results.length).toBeGreaterThan(0)
      const ids = results.map((e) => e.id)
      expect(ids).toContain("L0001")
    })
  })

  test("search returns empty for non-matching query", async () => {
    await withStore((s) => {
      write(s, "L", "Hello there")
      const results = read(s, { search: "xyzzy_nonexistent_term" })
      expect(results).toHaveLength(0)
    })
  })
})

describe("readL1Headers", () => {
  test("returns entries without children loaded", async () => {
    await withStore((s) => {
      write(s, "L", "Header only\n\tChild node content")
      const headers = readL1Headers(s)
      expect(headers.length).toBeGreaterThan(0)
      // L1 headers have no children loaded
      expect(headers[0].children).toHaveLength(0)
    })
  })

  test("filters by prefix", async () => {
    await withStore((s) => {
      write(s, "L", "Learning entry")
      write(s, "P", "Project entry")
      const lHeaders = readL1Headers(s, { prefix: "L" })
      const pHeaders = readL1Headers(s, { prefix: "P" })
      expect(lHeaders.every((e) => e.prefix === "L")).toBe(true)
      expect(pHeaders.every((e) => e.prefix === "P")).toBe(true)
    })
  })
})
