import type { RoundResult, SpawnResult, TranscriptEntry } from "./types"
import type { CatalogAgent } from "../catalog"
import { parseMentions } from "./mention"
import { buildAgentInfo } from "./dispatch"
import { canAfford, estimateCost, record } from "./budget"
import type { TaskBudget } from "./budget"

export function buildContextPrefix(rounds: RoundResult[]): string {
  if (rounds.length === 0) return ""

  const parts = ["## Prior discussion\n"]
  for (let i = 0; i < rounds.length; i++) {
    parts.push(`### Round ${i + 1}`)
    for (const [agentId, result] of Object.entries(rounds[i].responses)) {
      if (result.error) continue
      parts.push(`${agentId}:\n${result.content}\n`)
    }
  }
  return parts.join("\n")
}

export interface RoundInput {
  text: string
  participants: CatalogAgent[]
  observers: string[]
  rounds: RoundResult[]
  contract: string | null
  budget: TaskBudget | null
  semaphore: number
  sessionID: string
  dispatch: (agentInfo: ReturnType<typeof buildAgentInfo>, cleanedMessage: string, sessionID: string) => Promise<SpawnResult>
}

export async function runRound(input: RoundInput): Promise<{
  result: RoundResult
  transcriptEntries: TranscriptEntry[]
}> {
  const participantIds = input.participants.map(p => p.id)
  const { mentioned, cleaned } = parseMentions(input.text, participantIds)

  if (mentioned.length === 0) {
    return {
      result: { responses: {}, duration: 0 },
      transcriptEntries: [{ agent: "", content: input.text, timestamp: new Date().toISOString() }],
    }
  }

  const transcriptEntries: TranscriptEntry[] = [
    { agent: "", content: input.text, timestamp: new Date().toISOString() },
  ]

  const contextPrefix = buildContextPrefix(input.rounds)
  const startTime = Date.now()
  const responses: Record<string, SpawnResult> = {}

  const agentsToDispatch = mentioned
    .map(id => input.participants.find(p => p.id === id))
    .filter((a): a is CatalogAgent => a !== undefined)

  const affordable = agentsToDispatch.filter(agent => {
    if (!input.budget) return true
    const estimate = estimateCost(agent.tier)
    if (!canAfford(input.budget, estimate)) {
      responses[agent.id] = {
        agent: agent.id, content: "", tokensIn: 0, tokensOut: 0, cost: 0, duration: 0,
        error: `Budget exhausted (need $${estimate.toFixed(2)}, remaining $${(input.budget.limit - input.budget.spent).toFixed(2)})`,
      }
      return false
    }
    return true
  })

  const chunks: CatalogAgent[][] = []
  for (let i = 0; i < affordable.length; i += input.semaphore) {
    chunks.push(affordable.slice(i, i + input.semaphore))
  }

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (agent) => {
        const agentInfo = buildAgentInfo(agent, contextPrefix, input.contract)
        const result = await input.dispatch(agentInfo, cleaned, input.sessionID)
        return { agentId: agent.id, result }
      }),
    )

    for (const settled of results) {
      if (settled.status === "fulfilled") {
        const { agentId, result } = settled.value
        responses[agentId] = result
        if (input.budget && result.cost > 0) {
          record(input.budget, agentId, result.cost)
        }
        transcriptEntries.push({
          agent: agentId,
          content: result.error ?? result.content,
          timestamp: new Date().toISOString(),
        })
      }
    }
  }

  return {
    result: { responses, duration: Date.now() - startTime },
    transcriptEntries,
  }
}
