import { describe, it, expect } from "vitest"
import { parseTree, parseRelativeTree, autoExtractTitle } from "../src/parse"

describe("parseTree", () => {
  it("parses single line", () => {
    const result = parseTree("Hello world", "L0001")
    expect(result.level1).toBe("Hello world")
    expect(result.title).toBeTruthy()
    expect(result.nodes).toHaveLength(0)
  })

  it("parses with children", () => {
    const content = "Root content\n\tChild one\n\tChild two\n\t\tGrandchild"
    const result = parseTree(content, "L0001")
    expect(result.level1).toBe("Root content")
    expect(result.nodes).toHaveLength(3)
    expect(result.nodes[0].depth).toBe(2)
    expect(result.nodes[0].parentId).toBe("L0001")
    expect(result.nodes[0].id).toBe("L0001.1")
    expect(result.nodes[1].depth).toBe(2)
    expect(result.nodes[1].id).toBe("L0001.2")
    expect(result.nodes[2].depth).toBe(3)
    expect(result.nodes[2].parentId).toBe("L0001.2")
    expect(result.nodes[2].id).toBe("L0001.2.1")
  })

  it("extracts title from two L1 lines (first=title, rest=level1)", () => {
    const content = "Title line\nSecond L1 line"
    const result = parseTree(content, "L0001")
    expect(result.title).toBe("Title line")
    expect(result.level1).toBe("Second L1 line")
  })

  it("handles multiple siblings", () => {
    const content = "Root\n\tA\n\tB\n\tC"
    const result = parseTree(content, "L0001")
    const children = result.nodes.filter(n => n.depth === 2)
    expect(children).toHaveLength(3)
    expect(children[0].seq).toBe(1)
    expect(children[1].seq).toBe(2)
    expect(children[2].seq).toBe(3)
  })

  it("caps depth at 5", () => {
    const content = "Root\n\tL2\n\t\tL3\n\t\t\tL4\n\t\t\t\tL5\n\t\t\t\t\tL6should-be-5"
    const result = parseTree(content, "L0001")
    const deepest = result.nodes[result.nodes.length - 1]
    expect(deepest.depth).toBeLessThanOrEqual(5)
  })
})

describe("parseRelativeTree", () => {
  it("parses relative to parent", () => {
    const content = "Direct child\n\tGrandchild"
    const nodes = parseRelativeTree(content, "L0001.2", 2, 3)
    expect(nodes).toHaveLength(2)
    expect(nodes[0].depth).toBe(3)
    expect(nodes[0].seq).toBe(3)
    expect(nodes[0].parentId).toBe("L0001.2")
    expect(nodes[1].depth).toBe(4)
  })
})

describe("autoExtractTitle", () => {
  it("extracts before separator", () => {
    expect(autoExtractTitle("Project goals. Detailed description")).toBe("Project goals")
  })

  it("truncates long text", () => {
    const long = "A".repeat(100)
    const title = autoExtractTitle(long)
    expect(title.length).toBeLessThanOrEqual(41)
    expect(title.endsWith("\u2026")).toBe(true)
  })

  it("returns short text as-is", () => {
    expect(autoExtractTitle("Short")).toBe("Short")
  })
})
