export interface TaskBudget {
  limit: number
  spent: number
  estimates: Record<string, number>
  actuals: Record<string, number>
}

const TIER_COSTS: Record<string, number> = {
  "$": 0.02,
  "$$": 0.05,
  "$$$": 0.10,
}

export function createBudget(limit: number): TaskBudget {
  return { limit, spent: 0, estimates: {}, actuals: {} }
}

export function canAfford(budget: TaskBudget, estimate: number): boolean {
  return budget.spent + estimate <= budget.limit
}

export function record(budget: TaskBudget, agent: string, cost: number): void {
  budget.actuals[agent] = (budget.actuals[agent] ?? 0) + cost
  budget.spent += cost
}

export function estimateCost(tier: string): number {
  return TIER_COSTS[tier] ?? TIER_COSTS["$$"]
}
