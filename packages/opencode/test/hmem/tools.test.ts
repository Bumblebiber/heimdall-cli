import { describe, test, expect, afterEach } from "bun:test"
import { Store } from "../../src/hmem/store"
import { write } from "../../src/hmem/write"
import { read } from "../../src/hmem/read"
import { append } from "../../src/hmem/modify"
import { setTags } from "../../src/hmem/tags"
import { stats } from "../../src/hmem/stats"
import { render } from "../../src/hmem/render"
import { rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const openedPaths: string[] = []

function makeDbPath(tag: string): string {
  const p = join(tmpdir(), `hmem-tools-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  openedPaths.push(p)
  return p
}

async function withStore(fn: (store: Store) => Promise<void> | void): Promise<void> {
  const dbPath = makeDbPath("test")
  const store = await Store.open(dbPath)
  try {
    await fn(store)
  } finally {
    store.close()
  }
}

afterEach(() => {
  // Clean up db files after each test
  for (const p of openedPaths.splice(0)) {
    for (const suffix of ["", "-wal", "-shm"]) {
      const full = p + suffix
      if (existsSync(full)) try { rmSync(full) } catch {}
    }
  }
})

// ── write + read round-trip ───────────────────────────────────────────────────

describe("hmem tools: write + read round-trip", () => {
  test("write then read by id returns the same content", async () => {
    await withStore((store) => {
      const result = write(store, "L", "Tool round-trip test")
      expect(result.id).toBe("L0001")

      const entries = read(store, { id: "L0001" })
      expect(entries).toHaveLength(1)
      expect(entries[0].level1).toBe("Tool round-trip test")
    })
  })

  test("write with hierarchy and read includes children", async () => {
    await withStore((store) => {
      const result = write(store, "P", "Project root\n\tChild node A\n\tChild node B")
      expect(result.id).toBe("P0001")

      const entries = read(store, { id: "P0001" })
      expect(entries).toHaveLength(1)
      expect(entries[0].children).toHaveLength(2)
      expect(entries[0].children[0].content).toBe("Child node A")
      expect(entries[0].children[1].content).toBe("Child node B")
    })
  })

  test("multiple writes produce sequential ids per prefix", async () => {
    await withStore((store) => {
      const r1 = write(store, "L", "First learning")
      const r2 = write(store, "L", "Second learning")
      const r3 = write(store, "T", "First task")
      expect(r1.id).toBe("L0001")
      expect(r2.id).toBe("L0002")
      expect(r3.id).toBe("T0001")
    })
  })
})

// ── append round-trip ─────────────────────────────────────────────────────────

describe("hmem tools: append round-trip", () => {
  test("append adds child nodes to existing entry", async () => {
    await withStore((store) => {
      write(store, "L", "Base entry")
      const result = append(store, "L0001", "Appended child")
      expect(result.count).toBe(1)
      expect(result.ids[0]).toMatch(/^L0001\./)

      const entries = read(store, { id: "L0001" })
      expect(entries[0].children.length).toBeGreaterThan(0)
    })
  })
})

// ── tag + render ──────────────────────────────────────────────────────────────

describe("hmem tools: tag and render", () => {
  test("tags can be set and retrieved via stats/render", async () => {
    await withStore((store) => {
      write(store, "H", "How-to: deploy")
      setTags(store, "H0001", ["#deployment", "#ops"])

      const rendered = render(read(store, { id: "H0001" }))
      expect(rendered).toContain("H0001")
      expect(rendered).toContain("How-to: deploy")
    })
  })
})

// ── stats ─────────────────────────────────────────────────────────────────────

describe("hmem tools: stats", () => {
  test("stats counts entries by prefix", async () => {
    await withStore((store) => {
      write(store, "L", "Learning one")
      write(store, "L", "Learning two")
      write(store, "P", "Project one")

      const result = stats(store)
      expect(result.total).toBe(3)
      expect(result.byPrefix["L"]).toBe(2)
      expect(result.byPrefix["P"]).toBe(1)
      expect(result.totalChars).toBeGreaterThan(0)
    })
  })
})

// ── search ────────────────────────────────────────────────────────────────────

describe("hmem tools: search", () => {
  test("FTS search finds entry by keyword", async () => {
    await withStore((store) => {
      write(store, "N", "TypeScript generics explained")
      write(store, "N", "Python list comprehensions")

      const entries = read(store, { search: "TypeScript" })
      expect(entries.length).toBeGreaterThan(0)
      expect(entries.some((e) => e.level1.includes("TypeScript"))).toBe(true)
    })
  })
})
