import type { UserMessage } from "@opencode-ai/sdk/v2"
import { batch } from "solid-js"

type Local = {
  agent: {
    current():
      | {
          model?: UserMessage["model"]
          variant?: string
        }
      | undefined
    set(name: string | undefined, options?: { restore?: boolean }): void
  }
  model: {
    set(model: UserMessage["model"] | undefined, options?: { restore?: boolean }): void
    current():
      | {
          id: string
          provider: { id: string }
        }
      | undefined
    variant: {
      set(value: string | undefined, options?: { restore?: boolean }): void
    }
  }
}

export const resetSessionModel = (local: Local) => {
  const agent = local.agent.current()
  if (!agent) return
  batch(() => {
    local.model.set(agent.model)
    local.model.variant.set(agent.variant)
  })
}

export const syncSessionModel = (local: Local, msg: UserMessage) => {
  batch(() => {
    local.agent.set(msg.agent, { restore: true })
    local.model.set(msg.model, { restore: true })
    local.model.variant.set(msg.variant, { restore: true })
  })
}
