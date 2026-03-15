import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { validateTags, setTags, fetchTags, fetchTagsBulk, assignBulkTags } from "../src/tags"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("tags", () => {
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

  it("validates and lowercases tags", () => {
    const result = validateTags(["#Valid", "#UPPER", "invalid", "#ok-tag"])
    expect(result).toContain("#valid")
    expect(result).toContain("#upper")
    expect(result).toContain("#ok-tag")
    expect(result).not.toContain("invalid")
  })

  it("caps at 10 tags", () => {
    const tags = Array.from({ length: 15 }, (_, i) => `#tag${i}`)
    expect(validateTags(tags)).toHaveLength(10)
  })

  it("deduplicates case-insensitively", () => {
    expect(validateTags(["#foo", "#FOO", "#Foo"])).toHaveLength(1)
  })

  it("sets and fetches tags", () => {
    write(store, "L", "Entry")
    setTags(store, "L0001", ["#test", "#coding"])
    const tags = fetchTags(store, "L0001")
    expect(tags).toContain("#coding")
    expect(tags).toContain("#test")
  })

  it("replaces all tags on set", () => {
    write(store, "L", "Entry")
    setTags(store, "L0001", ["#old"])
    setTags(store, "L0001", ["#new"])
    const tags = fetchTags(store, "L0001")
    expect(tags).toEqual(["#new"])
  })

  it("bulk fetches tags", () => {
    write(store, "L", "One")
    write(store, "L", "Two")
    setTags(store, "L0001", ["#a"])
    setTags(store, "L0002", ["#b"])
    const bulk = fetchTagsBulk(store, ["L0001", "L0002"])
    expect(bulk["L0001"]).toContain("#a")
    expect(bulk["L0002"]).toContain("#b")
  })

  it("returns empty map for empty input", () => {
    expect(fetchTagsBulk(store, [])).toEqual({})
  })
})
