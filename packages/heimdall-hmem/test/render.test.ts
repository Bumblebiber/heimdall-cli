import { describe, it, expect } from "vitest"
import { render } from "../src/render"
import type { MemoryEntry } from "../src/types"

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: "L0001", prefix: "L", seq: 1, createdAt: "", updatedAt: "",
    title: "Test", level1: "Test entry", links: [], minRole: "worker",
    obsolete: false, favorite: false, irrelevant: false, pinned: false,
    accessCount: 0, lastAccessed: null, promoted: "", tags: [], children: [],
    ...overrides,
  }
}

describe("render", () => {
  it("renders entries with children", () => {
    const entry = makeEntry({
      children: [{
        id: "L0001.1", parentId: "L0001", rootId: "L0001", depth: 2,
        seq: 1, title: "", content: "Child text", createdAt: "",
        accessCount: 0, favorite: false, irrelevant: false, tags: [], children: [],
      }],
    })
    const out = render([entry])
    expect(out).toContain("L0001")
    expect(out).toContain("Test entry")
    expect(out).toContain("Child text")
  })

  it("returns empty for empty array", () => {
    expect(render([])).toBe("")
  })

  it("skips obsolete entries", () => {
    const out = render([makeEntry({ obsolete: true })])
    expect(out).not.toContain("L0001")
  })

  it("marks favorites", () => {
    const out = render([makeEntry({ favorite: true })])
    expect(out).toContain("\u2665")
  })
})
