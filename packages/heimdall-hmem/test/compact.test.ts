import { describe, it, expect } from "vitest"
import { parseCompactionResponse, topicToContent } from "../src/compact"

describe("compact", () => {
  it("parses valid response", () => {
    const json = JSON.stringify({
      summary: "Session summary",
      topics: [{ prefix: "L", tags: ["#test"], l1: "Title", l2: "Summary", l3: "", l4: "", l5: "" }],
    })
    const result = parseCompactionResponse(json)
    expect(result.summary).toBe("Session summary")
    expect(result.topics).toHaveLength(1)
    expect(result.topics[0].prefix).toBe("L")
  })

  it("strips code fences", () => {
    const json = "```json\n" + JSON.stringify({ summary: "ok", topics: [] }) + "\n```"
    const result = parseCompactionResponse(json)
    expect(result.summary).toBe("ok")
  })

  it("throws on invalid JSON", () => {
    expect(() => parseCompactionResponse("not json")).toThrow()
  })

  it("corrects invalid prefix to L", () => {
    const json = JSON.stringify({
      summary: "", topics: [{ prefix: "Z", tags: [], l1: "x", l2: "", l3: "", l4: "", l5: "" }],
    })
    const result = parseCompactionResponse(json)
    expect(result.topics[0].prefix).toBe("L")
  })

  it("converts topic to tab-indented content", () => {
    const content = topicToContent({ prefix: "L", tags: [], l1: "Title", l2: "Details", l3: "More", l4: "", l5: "" })
    expect(content).toBe("Title\n\tDetails\n\t\tMore")
  })

  it("skips empty levels", () => {
    const content = topicToContent({ prefix: "L", tags: [], l1: "Title", l2: "", l3: "Deep", l4: "", l5: "" })
    expect(content).toBe("Title\n\t\tDeep")
  })
})
