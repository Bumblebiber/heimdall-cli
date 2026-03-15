import { test, expect } from "bun:test"
import { createBudget, canAfford, record, estimateCost } from "../../src/groupchat/budget"

test("createBudget initializes with limit", () => {
  const budget = createBudget(1.0)
  expect(budget.limit).toBe(1.0)
  expect(budget.spent).toBe(0)
})

test("canAfford returns true when under limit", () => {
  const budget = createBudget(1.0)
  expect(canAfford(budget, 0.05)).toBe(true)
})

test("canAfford returns false when over limit", () => {
  const budget = createBudget(0.03)
  expect(canAfford(budget, 0.05)).toBe(false)
})

test("canAfford accounts for already spent", () => {
  const budget = createBudget(0.10)
  record(budget, "THOR", 0.08)
  expect(canAfford(budget, 0.05)).toBe(false)
  expect(canAfford(budget, 0.02)).toBe(true)
})

test("record tracks per-agent actuals", () => {
  const budget = createBudget(1.0)
  record(budget, "THOR", 0.05)
  record(budget, "LOKI", 0.10)
  expect(budget.spent).toBeCloseTo(0.15)
  expect(budget.actuals["THOR"]).toBeCloseTo(0.05)
  expect(budget.actuals["LOKI"]).toBeCloseTo(0.10)
})

test("record accumulates for same agent", () => {
  const budget = createBudget(1.0)
  record(budget, "THOR", 0.05)
  record(budget, "THOR", 0.03)
  expect(budget.actuals["THOR"]).toBeCloseTo(0.08)
  expect(budget.spent).toBeCloseTo(0.08)
})

test("estimateCost returns tier defaults", () => {
  expect(estimateCost("$")).toBe(0.02)
  expect(estimateCost("$$")).toBe(0.05)
  expect(estimateCost("$$$")).toBe(0.10)
})

test("estimateCost defaults to $$ for unknown tier", () => {
  expect(estimateCost("unknown")).toBe(0.05)
})
