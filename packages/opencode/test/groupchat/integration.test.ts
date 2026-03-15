import { test, expect } from "bun:test"
import { runRound, type RoundInput, createBudget, type SpawnResult } from "../../src/groupchat"
import type { CatalogAgent } from "../../src/catalog"

const THOR: CatalogAgent = {
  id: "THOR", name: "Thor", department: "Backend",
  persona: "You are Thor.", specializations: ["Go"],
  tier: "$$", provider: "anthropic", model: "claude-sonnet-4-5", tools: "coder",
}

const LOKI: CatalogAgent = {
  id: "LOKI", name: "Loki", department: "Security",
  persona: "You are Loki.", specializations: ["pentesting"],
  tier: "$$$", provider: "anthropic", model: "claude-opus-4-5", tools: "researcher",
}

function mockDispatch(responses: Record<string, string>) {
  return async (agentInfo: any, cleanedMessage: string): Promise<SpawnResult> => {
    const content = responses[agentInfo.name] ?? "default response"
    return {
      agent: agentInfo.name,
      content,
      tokensIn: 100,
      tokensOut: 50,
      cost: 0.05,
      duration: 1000,
    }
  }
}

test("full round: parse mentions, dispatch, record transcript", async () => {
  const input: RoundInput = {
    text: "@THOR @LOKI review the auth module",
    participants: [THOR, LOKI],
    observers: [],
    rounds: [],
    contract: null,
    budget: null,
    semaphore: 3,
    sessionID: "test-session",
    dispatch: mockDispatch({
      THOR: "I found three issues.",
      LOKI: "Token rotation is vulnerable.",
    }),
  }

  const { result, transcriptEntries } = await runRound(input)

  expect(Object.keys(result.responses)).toHaveLength(2)
  expect(result.responses["THOR"].content).toBe("I found three issues.")
  expect(result.responses["LOKI"].content).toBe("Token rotation is vulnerable.")
  expect(transcriptEntries).toHaveLength(3) // user + 2 agents
  expect(transcriptEntries[0].agent).toBe("")
  expect(transcriptEntries[0].content).toContain("@THOR")
})

test("budget enforcement skips over-budget agents", async () => {
  const budget = createBudget(0.06) // only enough for one $$

  const input: RoundInput = {
    text: "@All review",
    participants: [THOR, LOKI],
    observers: [],
    rounds: [],
    contract: null,
    budget,
    semaphore: 3,
    sessionID: "test-session",
    dispatch: mockDispatch({ THOR: "ok", LOKI: "ok" }),
  }

  const { result } = await runRound(input)

  // THOR ($$ = $0.05) should proceed, LOKI ($$$ = $0.10) should be skipped
  expect(result.responses["THOR"].content).toBe("ok")
  expect(result.responses["LOKI"].error).toContain("Budget exhausted")
})

test("no mentions returns empty round", async () => {
  const input: RoundInput = {
    text: "just talking",
    participants: [THOR],
    observers: [],
    rounds: [],
    contract: null,
    budget: null,
    semaphore: 3,
    sessionID: "test-session",
    dispatch: mockDispatch({}),
  }

  const { result } = await runRound(input)
  expect(Object.keys(result.responses)).toHaveLength(0)
})

test("context injection includes prior rounds", async () => {
  let capturedPrompt = ""

  const input: RoundInput = {
    text: "@THOR follow up",
    participants: [THOR],
    observers: [],
    rounds: [{
      responses: {
        THOR: { agent: "THOR", content: "Initial analysis.", tokensIn: 100, tokensOut: 50, cost: 0.05, duration: 1000 },
      },
      duration: 1000,
    }],
    contract: null,
    budget: null,
    semaphore: 3,
    sessionID: "test-session",
    dispatch: async (agentInfo, msg) => {
      capturedPrompt = agentInfo.prompt ?? ""
      return { agent: agentInfo.name, content: "follow up", tokensIn: 50, tokensOut: 30, cost: 0.03, duration: 500 }
    },
  }

  await runRound(input)
  expect(capturedPrompt).toContain("Prior discussion")
  expect(capturedPrompt).toContain("Initial analysis.")
})
