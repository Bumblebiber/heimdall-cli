import { test, expect } from "bun:test"
import { formatTranscript } from "../../src/groupchat/transcript"
import type { TranscriptEntry } from "../../src/groupchat/types"

test("formats empty transcript", () => {
  const result = formatTranscript([], [], [], 0)
  expect(result).toContain("Group chat")
  expect(result).toContain("Participants:")
})

test("formats transcript with entries", () => {
  const entries: TranscriptEntry[] = [
    { agent: "", content: "@THOR review auth", timestamp: "2026-03-15T10:00:00Z" },
    { agent: "THOR", content: "Found three issues in the auth module.", timestamp: "2026-03-15T10:00:30Z" },
  ]
  const result = formatTranscript(entries, ["THOR"], ["HEIMDALL"], 30000)
  expect(result).toContain("Participants: THOR")
  expect(result).toContain("Observers: HEIMDALL")
  expect(result).toContain("User: @THOR review auth")
  expect(result).toContain("THOR: Found three issues")
})

test("L2 line is under 120 chars", () => {
  const entries: TranscriptEntry[] = [
    { agent: "", content: "@THOR " + "x".repeat(200), timestamp: "2026-03-15T10:00:00Z" },
  ]
  const result = formatTranscript(entries, ["THOR"], [], 0)
  const firstLine = result.split("\n")[0]
  expect(firstLine.length).toBeLessThanOrEqual(120)
})

test("L3 lines are tab-indented", () => {
  const entries: TranscriptEntry[] = [
    { agent: "", content: "@THOR test", timestamp: "2026-03-15T10:00:00Z" },
  ]
  const result = formatTranscript(entries, ["THOR"], [], 5000)
  const lines = result.split("\n")
  const l3Lines = lines.filter(l => l.startsWith("\t") && !l.startsWith("\t\t"))
  expect(l3Lines.length).toBeGreaterThan(0)
})

test("L5 lines are double-tab-indented", () => {
  const entries: TranscriptEntry[] = [
    { agent: "", content: "@THOR test", timestamp: "2026-03-15T10:00:00Z" },
    { agent: "THOR", content: "response", timestamp: "2026-03-15T10:00:05Z" },
  ]
  const result = formatTranscript(entries, ["THOR"], [], 5000)
  const lines = result.split("\n")
  const l5Lines = lines.filter(l => l.startsWith("\t\t"))
  expect(l5Lines.length).toBe(2)
})

test("duration formatted as human readable", () => {
  const entries: TranscriptEntry[] = [
    { agent: "", content: "test", timestamp: "2026-03-15T10:00:00Z" },
  ]
  const result = formatTranscript(entries, ["THOR"], [], 272000)
  expect(result).toContain("4m 32s")
})
