import fs from "fs"

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
    return JSON.parse(raw) as CatalogAgent[]
  } catch {
    return []
  }
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
