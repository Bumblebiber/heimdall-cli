import { describe, expect, test } from "bun:test"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { resetSessionModel, syncSessionModel } from "./session-model-helpers"

const message = (input?: Partial<Pick<UserMessage, "agent" | "model" | "variant">>) =>
  ({
    id: "msg",
    sessionID: "session",
    role: "user",
    time: { created: 1 },
    agent: input?.agent ?? "build",
    model: input?.model ?? { providerID: "anthropic", modelID: "claude-sonnet-4" },
    variant: input?.variant,
  }) as UserMessage

describe("syncSessionModel", () => {
  test("restores the last message model and variant", () => {
    const calls: unknown[] = []

    syncSessionModel(
      {
        agent: {
          current() {
            return undefined
          },
          set(value, options) {
            calls.push(["agent", value, options])
          },
        },
        model: {
          set(value, options) {
            calls.push(["model", value, options])
          },
          current() {
            return { id: "claude-sonnet-4", provider: { id: "anthropic" } }
          },
          variant: {
            set(value, options) {
              calls.push(["variant", value, options])
            },
          },
        },
      },
      message({ variant: "high" }),
    )

    expect(calls).toEqual([
      ["agent", "build", { restore: true }],
      ["model", { providerID: "anthropic", modelID: "claude-sonnet-4" }, { restore: true }],
      ["variant", "high", { restore: true }],
    ])
  })

  test("restores the message variant even when the current model differs", () => {
    const calls: unknown[] = []

    syncSessionModel(
      {
        agent: {
          current() {
            return undefined
          },
          set(value, options) {
            calls.push(["agent", value, options])
          },
        },
        model: {
          set(value, options) {
            calls.push(["model", value, options])
          },
          current() {
            return { id: "gpt-5", provider: { id: "openai" } }
          },
          variant: {
            set(value, options) {
              calls.push(["variant", value, options])
            },
          },
        },
      },
      message({ variant: "high" }),
    )

    expect(calls).toEqual([
      ["agent", "build", { restore: true }],
      ["model", { providerID: "anthropic", modelID: "claude-sonnet-4" }, { restore: true }],
      ["variant", "high", { restore: true }],
    ])
  })

  test("restores an explicit default variant", () => {
    const calls: unknown[] = []

    syncSessionModel(
      {
        agent: {
          current() {
            return undefined
          },
          set(value, options) {
            calls.push(["agent", value, options])
          },
        },
        model: {
          set(value, options) {
            calls.push(["model", value, options])
          },
          current() {
            return { id: "claude-sonnet-4", provider: { id: "anthropic" } }
          },
          variant: {
            set(value, options) {
              calls.push(["variant", value, options])
            },
          },
        },
      },
      message(),
    )

    expect(calls).toEqual([
      ["agent", "build", { restore: true }],
      ["model", { providerID: "anthropic", modelID: "claude-sonnet-4" }, { restore: true }],
      ["variant", undefined, { restore: true }],
    ])
  })
})

describe("resetSessionModel", () => {
  test("restores the current agent defaults", () => {
    const calls: unknown[] = []

    resetSessionModel({
      agent: {
        current() {
          return {
            model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
            variant: "high",
          }
        },
        set() {},
      },
      model: {
        set(value) {
          calls.push(["model", value])
        },
        current() {
          return undefined
        },
        variant: {
          set(value) {
            calls.push(["variant", value])
          },
        },
      },
    })

    expect(calls).toEqual([
      ["model", { providerID: "anthropic", modelID: "claude-sonnet-4" }],
      ["variant", "high"],
    ])
  })

  test("clears the variant when the agent has none", () => {
    const calls: unknown[] = []

    resetSessionModel({
      agent: {
        current() {
          return {
            model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
          }
        },
        set() {},
      },
      model: {
        set(value) {
          calls.push(["model", value])
        },
        current() {
          return undefined
        },
        variant: {
          set(value) {
            calls.push(["variant", value])
          },
        },
      },
    })

    expect(calls).toEqual([
      ["model", { providerID: "anthropic", modelID: "claude-sonnet-4" }],
      ["variant", undefined],
    ])
  })
})
