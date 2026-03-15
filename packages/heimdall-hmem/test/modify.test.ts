import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { read } from "../src/read"
import { update, append } from "../src/modify"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("modify", () => {
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

  it("updates favorite flag", () => {
    write(store, "L", "Test entry")
    update(store, "L0001", { favorite: true })
    const [entry] = read(store, { id: "L0001" })
    expect(entry.favorite).toBe(true)
  })

  it("updates obsolete and content", () => {
    write(store, "L", "Original content")
    update(store, "L0001", { obsolete: true, content: "Updated content" })
    const [entry] = read(store, { id: "L0001" })
    expect(entry.obsolete).toBe(true)
    expect(entry.level1).toBe("Updated content")
  })

  it("updates node favorite", () => {
    write(store, "L", "Root\n\tChild")
    update(store, "L0001.1", { favorite: true })
    const row = store.database.prepare("SELECT favorite FROM memory_nodes WHERE id = ?").get("L0001.1") as any
    expect(row.favorite).toBe(1)
  })

  it("appends children to root", () => {
    write(store, "L", "Root entry")
    const result = append(store, "L0001", "New child\n\tGrandchild")
    expect(result.count).toBe(2)
    expect(result.ids).toHaveLength(2)
    expect(result.ids[0]).toBe("L0001.1")
  })

  it("appends to existing children", () => {
    write(store, "L", "Root\n\tExisting child")
    const result = append(store, "L0001", "Another child")
    expect(result.ids[0]).toBe("L0001.2")
  })
})
