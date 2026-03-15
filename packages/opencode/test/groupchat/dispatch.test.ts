import { test, expect } from "bun:test"
import { buildAgentPrompt, resolveToolset } from "../../src/groupchat/dispatch"

test("buildAgentPrompt combines persona + context", () => {
  const prompt = buildAgentPrompt(
    { persona: "You are Thor." } as any,
    "## Prior discussion\nLOKI: I disagree.",
    null,
  )
  expect(prompt).toContain("You are Thor.")
  expect(prompt).toContain("Prior discussion")
})

test("buildAgentPrompt includes contract when present", () => {
  const prompt = buildAgentPrompt(
    { persona: "You are Thor." } as any,
    "",
    "Always write tests.",
  )
  expect(prompt).toContain("Always write tests.")
})

test("buildAgentPrompt omits contract when null", () => {
  const prompt = buildAgentPrompt(
    { persona: "You are Thor." } as any,
    "context",
    null,
  )
  expect(prompt).not.toContain("null")
})

test("resolveToolset returns ruleset for coder", () => {
  const rules = resolveToolset("coder")
  expect(Array.isArray(rules)).toBe(true)
  // r.permission = tool name pattern ("*" = all tools)
  const allRule = rules.find(r => r.permission === "*")
  expect(allRule?.action).toBe("allow")
})

test("resolveToolset returns restricted ruleset for researcher", () => {
  const rules = resolveToolset("researcher")
  const denyAll = rules.find(r => r.permission === "*")
  expect(denyAll?.action).toBe("deny")
  const grep = rules.find(r => r.permission === "grep")
  expect(grep?.action).toBe("allow")
})

test("resolveToolset defaults to researcher for unknown", () => {
  const rules = resolveToolset("unknown_toolset")
  const denyAll = rules.find(r => r.permission === "*")
  expect(denyAll?.action).toBe("deny")
})

test("resolveToolset defaults to researcher for undefined", () => {
  const rules = resolveToolset(undefined)
  expect(rules).toEqual(resolveToolset("researcher"))
})
