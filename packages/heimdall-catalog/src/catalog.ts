import { readFileSync } from "fs"
import type { AgentSpec, CatalogData, Tier } from "./types.js"
import { TIER_RANK } from "./types.js"

export class Catalog {
  readonly version: string
  private agents: Map<string, AgentSpec>

  private constructor(version: string, agents: Map<string, AgentSpec>) {
    this.version = version
    this.agents = agents
  }

  static load(path: string): Catalog {
    const data: CatalogData = JSON.parse(readFileSync(path, "utf-8"))
    const agents = new Map<string, AgentSpec>()
    for (const [id, spec] of Object.entries(data.agents)) {
      agents.set(id.toUpperCase(), { ...spec, id: id.toUpperCase() })
    }
    return new Catalog(data._version, agents)
  }

  get(id: string): AgentSpec | undefined {
    return this.agents.get(id.toUpperCase())
  }

  getByDepartment(dept: string): AgentSpec[] {
    const lower = dept.toLowerCase()
    return [...this.agents.values()].filter(
      (a) => a.department.toLowerCase() === lower,
    )
  }

  getBySpecialization(...keywords: string[]): AgentSpec[] {
    const result: AgentSpec[] = []
    for (const agent of this.agents.values()) {
      for (const kw of keywords) {
        if (agent.specializations.some((s) => s.toLowerCase().includes(kw.toLowerCase()))) {
          result.push(agent)
          break
        }
      }
    }
    return result
  }

  filterByTier(maxTier: Tier): AgentSpec[] {
    const maxRank = TIER_RANK[maxTier]
    return [...this.agents.values()].filter((a) => TIER_RANK[a.tier] <= maxRank)
  }

  groupByDepartment(): Record<string, AgentSpec[]> {
    const groups: Record<string, AgentSpec[]> = {}
    for (const agent of this.agents.values()) {
      if (!groups[agent.department]) groups[agent.department] = []
      groups[agent.department].push(agent)
    }
    return groups
  }

  departmentNames(): string[] {
    const names = new Set<string>()
    for (const agent of this.agents.values()) names.add(agent.department)
    return [...names].sort()
  }

  all(): AgentSpec[] {
    return [...this.agents.values()]
  }

  obscuredView(): string {
    let out = "Available specialists:\n\n"
    for (const [id, spec] of this.agents) {
      const specs = spec.specializations.join(", ")
      out += `  ${id.padEnd(12)} ${(spec.department + "(" + specs + ")").padEnd(40)} ${spec.tier}\n`
    }
    out += "\nChoose agents by SPECIALTY, not by price.\nThe budget system handles cost optimization.\n"
    return out
  }
}
