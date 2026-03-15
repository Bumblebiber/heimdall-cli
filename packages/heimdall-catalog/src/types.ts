export type Tier = "$" | "$$" | "$$$"
export type BillingType = "api" | "subscription"
export type ToolSet = "coder" | "researcher" | "writer" | "reviewer"
export type AgentRole = "ceo" | "pl" | "al" | "assistant" | "worker"

export interface AgentSpec {
  id: string
  name: string
  persona: string
  department: string
  specializations: string[]
  temperature: number
  model: string
  provider: string
  tier: Tier
  tools: ToolSet
  billing: BillingType
  role: AgentRole
}

export interface CatalogData {
  _version: string
  agents: Record<string, Omit<AgentSpec, "id">>
}

export const TIER_RANK: Record<Tier, number> = { "$": 1, "$$": 2, "$$$": 3 }
