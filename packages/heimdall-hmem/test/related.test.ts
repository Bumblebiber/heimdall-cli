import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { setTags } from "../src/tags"
import { findRelated } from "../src/related"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("findRelated", () => {
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

  it("finds related by shared tags", () => {
    write(store, "L", "Entry one")
    write(store, "L", "Entry two")
    setTags(store, "L0001", ["#coding", "#typescript"])
    setTags(store, "L0002", ["#coding", "#typescript"])
    const related = findRelated(store, "L0001", 10)
    expect(related.some((r) => r.id === "L0002")).toBe(true)
  })

  it("returns empty when no matches", () => {
    write(store, "L", "Lonely entry")
    expect(findRelated(store, "L0001", 10)).toHaveLength(0)
  })
})
