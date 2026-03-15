import type { Store } from "./store.js"
import type { MemoryEntry, MemoryNode } from "./types.js"

const TAG_PATTERN = /^#[a-z0-9_-]{1,49}$/
const MAX_TAGS = 10

export function validateTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const tag of tags) {
    const lower = tag.toLowerCase().trim()
    if (TAG_PATTERN.test(lower) && !seen.has(lower)) {
      seen.add(lower)
      result.push(lower)
      if (result.length >= MAX_TAGS) break
    }
  }
  return result
}

export function setTags(store: Store, entryId: string, tags: string[]): void {
  const valid = validateTags(tags)
  const transaction = store.database.transaction(() => {
    store.database.prepare("DELETE FROM memory_tags WHERE entry_id = ?").run(entryId)
    const insert = store.database.prepare("INSERT INTO memory_tags (entry_id, tag) VALUES (?, ?)")
    for (const tag of valid) insert.run(entryId, tag)
  })
  transaction()
}

export function fetchTags(store: Store, entryId: string): string[] {
  const rows = store.database
    .prepare("SELECT tag FROM memory_tags WHERE entry_id = ? ORDER BY tag ASC")
    .all(entryId) as { tag: string }[]
  return rows.map((r) => r.tag)
}

export function fetchTagsBulk(store: Store, ids: string[]): Record<string, string[]> {
  if (ids.length === 0) return {}
  const result: Record<string, string[]> = {}
  const CHUNK_SIZE = 500
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE)
    const placeholders = chunk.map(() => "?").join(",")
    const rows = store.database
      .prepare(`SELECT entry_id, tag FROM memory_tags WHERE entry_id IN (${placeholders}) ORDER BY tag ASC`)
      .all(...chunk) as { entry_id: string; tag: string }[]
    for (const row of rows) {
      if (!result[row.entry_id]) result[row.entry_id] = []
      result[row.entry_id].push(row.tag)
    }
  }
  return result
}

function collectIds(entries: MemoryEntry[]): string[] {
  const ids: string[] = []
  function walkNodes(nodes: MemoryNode[]): void {
    for (const n of nodes) {
      ids.push(n.id)
      walkNodes(n.children)
    }
  }
  for (const e of entries) {
    ids.push(e.id)
    walkNodes(e.children)
  }
  return ids
}

function assignToNodes(nodes: MemoryNode[], tagMap: Record<string, string[]>): void {
  for (const n of nodes) {
    n.tags = tagMap[n.id] ?? []
    assignToNodes(n.children, tagMap)
  }
}

export function assignBulkTags(store: Store, entries: MemoryEntry[]): void {
  const ids = collectIds(entries)
  const tagMap = fetchTagsBulk(store, ids)
  for (const e of entries) {
    e.tags = tagMap[e.id] ?? []
    assignToNodes(e.children, tagMap)
  }
}
