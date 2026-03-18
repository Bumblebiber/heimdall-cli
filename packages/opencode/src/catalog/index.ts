import fs from "fs"
import path from "path"

export interface CatalogAgent {
  id: string
  name: string
  department: string
  persona: string
  specializations: string[]
  tier: "$" | "$$" | "$$$"
  provider?: string
  model?: string
  temperature?: number
  tools?: string
  role?: string
}

export function loadCatalog(catalogPath: string): CatalogAgent[] {
  try {
    const raw = fs.readFileSync(catalogPath, "utf8")
    const parsed = JSON.parse(raw)
    // v2 format: { _version, agents: { ID: spec } }
    if (parsed && typeof parsed === "object" && parsed.agents && !Array.isArray(parsed)) {
      return Object.entries(parsed.agents as Record<string, Omit<CatalogAgent, "id">>).map(
        ([id, spec]) => ({ ...spec, id }),
      )
    }
    // legacy format: CatalogAgent[]
    return parsed as CatalogAgent[]
  } catch {
    return []
  }
}

export function findCatalog(projectRoot: string): string | null {
  let dir = path.resolve(projectRoot)
  while (true) {
    const candidates = [
      path.join(dir, ".heimdall", "catalog.json"),
      path.join(dir, "configs", "catalog.json"),
    ]
    for (const candidate of candidates) {
      try {
        fs.accessSync(candidate)
        return candidate
      } catch {
        continue
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export function groupByDepartment(agents: CatalogAgent[]): Map<string, CatalogAgent[]> {
  const map = new Map<string, CatalogAgent[]>()
  for (const agent of agents) {
    const dept = agent.department
    if (!map.has(dept)) map.set(dept, [])
    map.get(dept)!.push(agent)
  }
  return map
}
