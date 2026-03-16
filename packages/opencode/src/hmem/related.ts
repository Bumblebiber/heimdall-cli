import type { Store } from "./store"
import type { RelatedEntry } from "./types"
import { fetchTags } from "./tags"

export function findRelated(store: Store, id: string, limit: number): RelatedEntry[] {
  const myTags = fetchTags(store, id)
  if (myTags.length === 0) return []

  const placeholders = myTags.map(() => "?").join(",")
  const rows = store.database
    .prepare(`
      SELECT DISTINCT t.entry_id, m.title, m.created_at
      FROM memory_tags t
      JOIN memories m ON t.entry_id = m.id
      WHERE t.tag IN (${placeholders}) AND t.entry_id != ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `)
    .all(...myTags, id, limit) as { entry_id: string; title: string; created_at: string }[]

  return rows.map((r) => ({
    id: r.entry_id,
    title: r.title ?? "",
    createdAt: r.created_at,
    tags: [],
    matchType: "tags" as const,
  }))
}
