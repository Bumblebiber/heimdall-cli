import { HmemStore } from "hmem-mcp"
import { VALID_PREFIXES } from "./tools"

export interface CompactedTopic {
  prefix: string
  tags: string[]
  l1: string
  l2: string
  l3: string
  l4: string
  l5: string
}

export interface CompactionResult {
  summary: string
  topics: CompactedTopic[]
}

const HMEM_MARKER_START = "<!--hmem-topics"
const HMEM_MARKER_END = "-->"

/**
 * Extract the hmem-topics JSON block from a compacted summary string.
 * Returns the parsed result and the cleaned text with the block removed.
 */
export function extractLearningsFromText(text: string): { cleaned: string; result: CompactionResult | null } {
  const startIdx = text.indexOf(HMEM_MARKER_START)
  if (startIdx === -1) return { cleaned: text, result: null }

  const jsonStart = startIdx + HMEM_MARKER_START.length
  const endIdx = text.indexOf(HMEM_MARKER_END, jsonStart)
  if (endIdx === -1) return { cleaned: text, result: null }

  const jsonBlock = text.slice(jsonStart, endIdx).trim()
  const cleaned = (text.slice(0, startIdx) + text.slice(endIdx + HMEM_MARKER_END.length)).trim()

  try {
    const result = parseCompactionResponse(jsonBlock)
    return { cleaned, result }
  } catch {
    return { cleaned: text, result: null }
  }
}

/**
 * Write extracted compaction topics to hmem as new entries.
 * Returns the IDs of written entries.
 */
export function writeCompactedTopics(store: HmemStore, topics: CompactedTopic[]): string[] {
  const ids: string[] = []
  for (const topic of topics) {
    if (!topic.l1) continue // skip empty topics
    const content = topicToContent(topic)
    const tags = topic.tags?.length > 0 ? topic.tags : undefined
    try {
      const result = store.write(topic.prefix, content, undefined, undefined, undefined, tags)
      ids.push(result.id)
    } catch (err) {
      console.error(`[heimdall-hmem] Failed to write compacted topic: ${(err as Error).message}`)
    }
  }
  return ids
}

export function parseCompactionResponse(raw: string): CompactionResult {
  let text = raw.trim()
  // Strip code fences
  if (text.startsWith("```")) {
    const firstNewline = text.indexOf("\n")
    const lastFence = text.lastIndexOf("```")
    if (firstNewline > 0 && lastFence > firstNewline) {
      text = text.slice(firstNewline + 1, lastFence).trim()
    }
  }

  const parsed = JSON.parse(text)
  const summary: string = parsed.summary ?? ""
  const topics: CompactedTopic[] = (parsed.topics ?? []).map((t: any) => {
    let prefix = (t.prefix ?? "L").toUpperCase()
    if (!VALID_PREFIXES.includes(prefix as any)) prefix = "L"
    return {
      prefix,
      tags: Array.isArray(t.tags) ? t.tags : [],
      l1: t.l1 ?? "",
      l2: t.l2 ?? "",
      l3: t.l3 ?? "",
      l4: t.l4 ?? "",
      l5: t.l5 ?? "",
    }
  })

  return { summary, topics }
}

export function topicToContent(topic: CompactedTopic): string {
  const levels = [topic.l1, topic.l2, topic.l3, topic.l4, topic.l5]
  const lines: string[] = []
  for (let i = 0; i < levels.length; i++) {
    if (levels[i]) {
      lines.push("\t".repeat(i) + levels[i])
    }
  }
  return lines.join("\n")
}
