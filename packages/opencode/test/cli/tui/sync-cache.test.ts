import { describe, expect, test } from "bun:test"
import type { Message, Part, SessionStatus, Todo, PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2"
import { dropSessionCache, pickSessionCacheEvictions } from "../../../src/cli/cmd/tui/context/sync-cache"

const msg = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-4o-mini" },
  }) as Message

const part = (id: string, sessionID: string, messageID: string) =>
  ({
    id,
    sessionID,
    messageID,
    type: "text",
    text: id,
  }) as Part

describe("tui sync cache", () => {
  test("dropSessionCache clears session scoped maps and related parts", () => {
    const m = msg("msg_1", "ses_1")
    const store = {
      session_status: { ses_1: { type: "busy" } as SessionStatus },
      session_diff: { ses_1: [] },
      todo: { ses_1: [] as Todo[] },
      message: { ses_1: [m] },
      part: { [m.id]: [part("prt_1", "ses_1", m.id)] },
      permission: { ses_1: [] as PermissionRequest[] },
      question: { ses_1: [] as QuestionRequest[] },
    }

    dropSessionCache(store, "ses_1")

    expect(store.message.ses_1).toBeUndefined()
    expect(store.part[m.id]).toBeUndefined()
    expect(store.todo.ses_1).toBeUndefined()
    expect(store.session_diff.ses_1).toBeUndefined()
    expect(store.session_status.ses_1).toBeUndefined()
    expect(store.permission.ses_1).toBeUndefined()
    expect(store.question.ses_1).toBeUndefined()
  })

  test("dropSessionCache clears orphaned parts without message rows", () => {
    const store = {
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: { msg_1: [part("prt_1", "ses_1", "msg_1")] },
      permission: {},
      question: {},
    }

    dropSessionCache(store, "ses_1")

    expect(store.part.msg_1).toBeUndefined()
  })

  test("pickSessionCacheEvictions evicts oldest cached sessions", () => {
    const seen = new Set(["ses_1", "ses_2", "ses_3"])

    const stale = pickSessionCacheEvictions({
      seen,
      keep: "ses_4",
      limit: 2,
    })

    expect(stale).toEqual(["ses_1", "ses_2"])
    expect([...seen]).toEqual(["ses_3", "ses_4"])
  })

  test("pickSessionCacheEvictions refreshes recency for revisited sessions", () => {
    const seen = new Set(["ses_1", "ses_2", "ses_3"])

    const stale = pickSessionCacheEvictions({
      seen,
      keep: "ses_2",
      limit: 3,
    })

    expect(stale).toEqual([])
    expect([...seen]).toEqual(["ses_1", "ses_3", "ses_2"])
  })
})
