import type { Message, Part, PermissionRequest, QuestionRequest, SessionStatus, Todo } from "@opencode-ai/sdk/v2"
import type { Snapshot } from "@/snapshot"

export const SESSION_CACHE_LIMIT = 40

type SessionCache = {
  session_status: Record<string, SessionStatus | undefined>
  session_diff: Record<string, Snapshot.FileDiff[] | undefined>
  todo: Record<string, Todo[] | undefined>
  message: Record<string, Message[] | undefined>
  part: Record<string, Part[] | undefined>
  permission: Record<string, PermissionRequest[] | undefined>
  question: Record<string, QuestionRequest[] | undefined>
}

export function dropSessionCache(store: SessionCache, sessionID: string) {
  for (const key of Object.keys(store.part)) {
    const parts = store.part[key]
    if (!parts?.some((part) => part?.sessionID === sessionID)) continue
    delete store.part[key]
  }
  delete store.message[sessionID]
  delete store.todo[sessionID]
  delete store.session_diff[sessionID]
  delete store.session_status[sessionID]
  delete store.permission[sessionID]
  delete store.question[sessionID]
}

export function pickSessionCacheEvictions(input: { seen: Set<string>; keep: string; limit: number }) {
  const stale: string[] = []
  if (input.seen.has(input.keep)) input.seen.delete(input.keep)
  input.seen.add(input.keep)
  for (const id of input.seen) {
    if (input.seen.size - stale.length <= input.limit) break
    if (id === input.keep) continue
    stale.push(id)
  }
  for (const id of stale) {
    input.seen.delete(id)
  }
  return stale
}
