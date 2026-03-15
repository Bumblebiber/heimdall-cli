import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("write", () => {
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

  it("creates entry with generated ID", async () => {
    const result = write(store, "L", "Test entry content")
    expect(result.id).toBe("L0001")
    expect(result.timestamp).toBeTruthy()
  })

  it("rejects invalid prefix", () => {
    expect(() => write(store, "X", "content")).toThrow()
  })

  it("increments sequence per prefix", () => {
    const r1 = write(store, "L", "First")
    const r2 = write(store, "L", "Second")
    expect(r1.id).toBe("L0001")
    expect(r2.id).toBe("L0002")
  })

  it("keeps independent sequences per prefix", () => {
    const l1 = write(store, "L", "Learning")
    const p1 = write(store, "P", "Project")
    expect(l1.id).toBe("L0001")
    expect(p1.id).toBe("P0001")
  })

  it("writes with children from tab-indented content", () => {
    const content = "Root content\n\tChild one\n\tChild two"
    const result = write(store, "L", content)
    expect(result.id).toBe("L0001")
    const row = store.database.prepare("SELECT COUNT(*) as c FROM memory_nodes WHERE root_id = ?").get(result.id) as any
    expect(row.c).toBe(2)
  })

  it("allows unlimited L5 content", () => {
    const longContent = "Title\n\tL2\n\t\tL3\n\t\t\tL4\n\t\t\t\t" + "A".repeat(10000)
    expect(() => write(store, "L", longContent)).not.toThrow()
  })
})
