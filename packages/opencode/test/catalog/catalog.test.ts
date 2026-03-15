import { test, expect } from "bun:test"
import { loadCatalog, groupByDepartment, type CatalogAgent } from "../../src/catalog"
import { join } from "path"

const FIXTURE = join(import.meta.dir, "fixtures", "catalog.json")

test("loadCatalog reads JSON and returns typed agents", () => {
  const agents = loadCatalog(FIXTURE)
  expect(agents).toHaveLength(4)
  expect(agents[0].id).toBe("THOR")
  expect(agents[0].department).toBe("Backend")
  expect(agents[0].tier).toBe("$$")
  expect(agents[0].provider).toBe("anthropic")
  expect(agents[0].model).toBe("claude-sonnet-4-5")
})

test("loadCatalog returns empty array for missing file", () => {
  const agents = loadCatalog("/nonexistent/catalog.json")
  expect(agents).toHaveLength(0)
})

test("groupByDepartment groups agents correctly", () => {
  const agents = loadCatalog(FIXTURE)
  const grouped = groupByDepartment(agents)
  expect(grouped.get("Backend")).toHaveLength(2)
  expect(grouped.get("Security")).toHaveLength(1)
  expect(grouped.get("Research")).toHaveLength(1)
})

test("CatalogAgent without provider/model uses defaults", () => {
  const agents = loadCatalog(FIXTURE)
  const mimir = agents.find(a => a.id === "MIMIR")!
  expect(mimir.provider).toBeUndefined()
  expect(mimir.model).toBeUndefined()
})
