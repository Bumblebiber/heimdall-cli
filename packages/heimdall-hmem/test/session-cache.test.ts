import { describe, it, expect, vi, afterEach } from "vitest"
import { SessionCache } from "../src/session-cache"

describe("SessionCache", () => {
  afterEach(() => { vi.useRealTimers() })

  it("records and checks hidden (< 5min)", () => {
    const cache = new SessionCache()
    cache.record("L0001")
    expect(cache.isHidden("L0001")).toBe(true)
    expect(cache.isCached("L0001")).toBe(false)
  })

  it("returns false for unknown ids", () => {
    const cache = new SessionCache()
    expect(cache.isHidden("X0001")).toBe(false)
    expect(cache.isCached("X0001")).toBe(false)
  })

  it("recordAll is idempotent", () => {
    const cache = new SessionCache()
    cache.recordAll(["A", "B"])
    cache.recordAll(["A", "C"])
    // A should keep original timestamp
    expect(cache.isHidden("A")).toBe(true)
    expect(cache.isHidden("C")).toBe(true)
  })

  it("returns correct hidden and cached sets", () => {
    const cache = new SessionCache()
    cache.record("fresh")
    const { hidden, cached } = cache.hiddenAndCachedSets()
    expect(hidden.has("fresh")).toBe(true)
    expect(cached.has("fresh")).toBe(false)
  })
})
