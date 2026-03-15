import { test, expect } from "bun:test"
import { loadCatalog, groupByDepartment, findCatalog, type CatalogAgent } from "../../src/catalog"
import { join } from "path"
import { mkdtempSync, mkdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"

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

test("findCatalog returns .heimdall/catalog.json if it exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-test-"))
  const heimdallDir = join(dir, ".heimdall")
  mkdirSync(heimdallDir)
  writeFileSync(join(heimdallDir, "catalog.json"), "[]")
  expect(findCatalog(dir)).toBe(join(heimdallDir, "catalog.json"))
})

test("findCatalog falls back to configs/catalog.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-test-"))
  const configsDir = join(dir, "configs")
  mkdirSync(configsDir)
  writeFileSync(join(configsDir, "catalog.json"), "[]")
  expect(findCatalog(dir)).toBe(join(configsDir, "catalog.json"))
})

test("findCatalog returns null if neither exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-test-"))
  expect(findCatalog(dir)).toBeNull()
})
