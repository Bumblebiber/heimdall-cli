import { test, expect } from "bun:test"
import { buildContextPrefix } from "../../src/groupchat/round"
import type { RoundResult } from "../../src/groupchat/types"

test("buildContextPrefix returns empty for no rounds", () => {
  expect(buildContextPrefix([])).toBe("")
})

test("buildContextPrefix formats single round", () => {
  const rounds: RoundResult[] = [{
    responses: {
      THOR: { agent: "THOR", content: "I found a bug.", tokensIn: 100, tokensOut: 50, cost: 0.02, duration: 1000 },
    },
    duration: 1000,
  }]
  const prefix = buildContextPrefix(rounds)
  expect(prefix).toContain("## Prior discussion")
  expect(prefix).toContain("### Round 1")
  expect(prefix).toContain("THOR:")
  expect(prefix).toContain("I found a bug.")
})

test("buildContextPrefix formats multiple rounds", () => {
  const rounds: RoundResult[] = [
    {
      responses: {
        THOR: { agent: "THOR", content: "Analysis done.", tokensIn: 100, tokensOut: 50, cost: 0.02, duration: 1000 },
      },
      duration: 1000,
    },
    {
      responses: {
        LOKI: { agent: "LOKI", content: "Security check.", tokensIn: 80, tokensOut: 40, cost: 0.03, duration: 800 },
        THOR: { agent: "THOR", content: "Follow up.", tokensIn: 90, tokensOut: 45, cost: 0.02, duration: 900 },
      },
      duration: 900,
    },
  ]
  const prefix = buildContextPrefix(rounds)
  expect(prefix).toContain("### Round 1")
  expect(prefix).toContain("### Round 2")
  expect(prefix).toContain("LOKI:")
})

test("buildContextPrefix skips errored responses", () => {
  const rounds: RoundResult[] = [{
    responses: {
      THOR: { agent: "THOR", content: "", tokensIn: 0, tokensOut: 0, cost: 0, duration: 0, error: "API timeout" },
    },
    duration: 0,
  }]
  const prefix = buildContextPrefix(rounds)
  expect(prefix).not.toContain("THOR:")
})
