import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { read } from "../src/read"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("read", () => {
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

  it("reads entry by ID with children", () => {
    write(store, "L", "Root content\n\tChild one\n\tChild two")
    const entries = read(store, { id: "L0001" })
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe("L0001")
    expect(entries[0].level1).toBe("Root content")
    expect(entries[0].children).toHaveLength(2)
  })

  it("reads node by compound ID", () => {
    write(store, "L", "Root\n\tChild content here")
    const entries = read(store, { id: "L0001.1" })
    expect(entries).toHaveLength(1)
    expect(entries[0].level1).toContain("Child content here")
  })

  it("searches via FTS", () => {
    write(store, "L", "TypeScript programming guide")
    write(store, "L", "Python data science tutorial")
    const entries = read(store, { search: "TypeScript" })
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(entries[0].level1).toContain("TypeScript")
  })

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      write(store, "L", `Entry number ${i}`)
    }
    const entries = read(store, { limit: 2 })
    expect(entries).toHaveLength(2)
  })

  it("bumps access count on read", () => {
    write(store, "L", "Access tracking test")
    read(store, { id: "L0001" })
    read(store, { id: "L0001" })
    const entries = read(store, { id: "L0001" })
    expect(entries[0].accessCount).toBe(3)
  })
})
