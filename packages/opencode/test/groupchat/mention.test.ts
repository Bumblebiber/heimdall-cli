import { test, expect } from "bun:test"
import { parseMentions } from "../../src/groupchat/mention"

const PARTICIPANTS = ["THOR", "LOKI"]

test("single mention extracts agent and cleans text", () => {
  const result = parseMentions("@THOR review code", PARTICIPANTS)
  expect(result.mentioned).toEqual(["THOR"])
  expect(result.cleaned).toBe("review code")
})

test("multiple mentions extracted and cleaned", () => {
  const result = parseMentions("@THOR @LOKI review", PARTICIPANTS)
  expect(result.mentioned).toEqual(["THOR", "LOKI"])
  expect(result.cleaned).toBe("review")
})

test("@All expands to all participants", () => {
  const result = parseMentions("@All review", PARTICIPANTS)
  expect(result.mentioned).toEqual(["THOR", "LOKI"])
  expect(result.cleaned).toBe("review")
})

test("@all is case-insensitive", () => {
  const result = parseMentions("@all review", PARTICIPANTS)
  expect(result.mentioned).toEqual(["THOR", "LOKI"])
})

test("unknown mention left in cleaned text, not extracted", () => {
  const result = parseMentions("@UNKNOWN review", PARTICIPANTS)
  expect(result.mentioned).toEqual([])
  expect(result.cleaned).toBe("@UNKNOWN review")
})

test("no mentions returns empty array", () => {
  const result = parseMentions("no mention", PARTICIPANTS)
  expect(result.mentioned).toEqual([])
  expect(result.cleaned).toBe("no mention")
})

test("duplicate mentions deduplicated", () => {
  const result = parseMentions("@THOR @THOR review", PARTICIPANTS)
  expect(result.mentioned).toEqual(["THOR"])
  expect(result.cleaned).toBe("review")
})

test("multiple spaces normalized after mention removal", () => {
  const result = parseMentions("@THOR    review   code", PARTICIPANTS)
  expect(result.cleaned).toBe("review code")
})

test("mention at end of string", () => {
  const result = parseMentions("review @THOR", PARTICIPANTS)
  expect(result.mentioned).toEqual(["THOR"])
  expect(result.cleaned).toBe("review")
})

test("mixed known and unknown mentions", () => {
  const result = parseMentions("@THOR @UNKNOWN @LOKI do it", PARTICIPANTS)
  expect(result.mentioned).toEqual(["THOR", "LOKI"])
  expect(result.cleaned).toBe("@UNKNOWN do it")
})
