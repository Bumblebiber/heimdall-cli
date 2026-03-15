import { describe, it, expect, beforeEach } from "vitest"
import { Catalog } from "../src/catalog"
import { writeFileSync, mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const TEST_CATALOG = {
  _version: "1.0",
  agents: {
    THOR: {
      name: "Thor", persona: "Thorough coder", department: "Backend",
      specializations: ["APIs", "Go"], temperature: 0.3,
      model: "claude-4-opus", provider: "anthropic", tier: "$$$",
      tools: "coder", billing: "api", role: "al",
    },
    MAGNI: {
      name: "Magni", persona: "Debugger", department: "Backend",
      specializations: ["Debugging"], temperature: 0.2,
      model: "claude-3.5-haiku", provider: "anthropic", tier: "$",
      tools: "coder", billing: "api", role: "worker",
    },
    FRIGG: {
      name: "Frigg", persona: "Frontend expert", department: "Frontend",
      specializations: ["React", "CSS"], temperature: 0.4,
      model: "gemini-2.5", provider: "gemini", tier: "$$",
      tools: "coder", billing: "api", role: "al",
    },
  },
}

describe("Catalog", () => {
  let tempDir: string
  let catalog: Catalog

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "catalog-"))
    const path = join(tempDir, "catalog.json")
    writeFileSync(path, JSON.stringify(TEST_CATALOG))
    catalog = Catalog.load(path)
  })

  it("loads and populates IDs", () => {
    const thor = catalog.get("THOR")
    expect(thor).toBeDefined()
    expect(thor!.id).toBe("THOR")
    expect(thor!.temperature).toBe(0.3)
  })

  it("gets by department (case-insensitive)", () => {
    const backend = catalog.getByDepartment("backend")
    expect(backend).toHaveLength(2)
  })

  it("gets by specialization (substring)", () => {
    const apis = catalog.getBySpecialization("APIs")
    expect(apis).toHaveLength(1)
    expect(apis[0].id).toBe("THOR")
  })

  it("filters by tier (at or below)", () => {
    expect(catalog.filterByTier("$")).toHaveLength(1)
    expect(catalog.filterByTier("$$")).toHaveLength(2)
  })

  it("groups by department", () => {
    const groups = catalog.groupByDepartment()
    expect(groups["Backend"]).toHaveLength(2)
    expect(groups["Frontend"]).toHaveLength(1)
  })

  it("returns sorted department names", () => {
    expect(catalog.departmentNames()).toEqual(["Backend", "Frontend"])
  })

  it("obscured view hides model names", () => {
    const view = catalog.obscuredView()
    expect(view).toContain("THOR")
    expect(view).toContain("FRIGG")
    expect(view).not.toContain("claude-4-opus")
    expect(view).not.toContain("gemini-2.5")
  })
})
