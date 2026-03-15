import { tool } from "@opencode-ai/plugin"
import type { Catalog } from "./catalog.js"
import type { AgentSpec, Tier } from "./types.js"
import { TIER_RANK } from "./types.js"

function formatAgentList(agents: AgentSpec[]): string {
  if (agents.length === 0) return "No agents found matching the criteria."
  let out = "Available specialists:\n\n"
  for (const a of agents) {
    const specs = a.specializations.join(", ")
    out += `  ${a.id.padEnd(12)} ${a.tier.padEnd(5)} ${a.department} (${specs})\n`
  }
  return out
}

export function createCatalogTools(catalog: Catalog) {
  return {
    catalog_list: tool({
      description: "List available agents by department and tier",
      args: {
        department: tool.schema.string().optional().describe("Filter by department (e.g., Backend, Frontend, QA)"),
        tier: tool.schema.string().optional().describe("Max tier filter: $ (cheap), $$ (mid), $$$ (expensive)"),
      },
      async execute(args) {
        let agents: AgentSpec[]
        if (args.department) {
          agents = catalog.getByDepartment(args.department)
        } else {
          agents = catalog.all()
        }
        if (args.tier) {
          agents = agents.filter((a) => TIER_RANK[a.tier] <= TIER_RANK[args.tier as Tier])
        }
        return formatAgentList(agents)
      },
    }),

    catalog_search: tool({
      description: "Search agents by specialization keyword",
      args: {
        query: tool.schema.string().describe("Specialization keyword (e.g., APIs, Testing, CSS)"),
      },
      async execute(args) {
        const agents = catalog.getBySpecialization(args.query)
        return formatAgentList(agents)
      },
    }),
  }
}
