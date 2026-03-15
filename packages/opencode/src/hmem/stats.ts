import type { Store } from "./store"
import type { StatsResult, HealthResult } from "./types"

export function stats(store: Store): StatsResult {
  const rows = store.database
    .prepare("SELECT prefix, COUNT(*) as cnt, SUM(LENGTH(COALESCE(level_1,''))) as chars FROM memories WHERE seq > 0 GROUP BY prefix")
    .all() as { prefix: string; cnt: number; chars: number }[]

  const byPrefix: Record<string, number> = {}
  let total = 0
  let totalChars = 0
  for (const row of rows) {
    byPrefix[row.prefix] = row.cnt
    total += row.cnt
    totalChars += row.chars ?? 0
  }

  // Add node chars
  const nodeChars = store.database
    .prepare("SELECT SUM(LENGTH(COALESCE(content,''))) as chars FROM memory_nodes")
    .get() as { chars: number | null }
  totalChars += nodeChars?.chars ?? 0

  return { total, byPrefix, totalChars }
}

export function healthCheck(store: Store): HealthResult {
  // Broken links: memories referencing non-existent IDs in links column
  const brokenLinks: string[] = []
  const allMemories = store.database
    .prepare("SELECT id, links FROM memories WHERE seq > 0 AND links IS NOT NULL AND links != '[]'")
    .all() as { id: string; links: string }[]
  for (const row of allMemories) {
    try {
      const links: string[] = JSON.parse(row.links)
      for (const link of links) {
        const exists = store.database.prepare("SELECT 1 FROM memories WHERE id = ?").get(link)
        if (!exists) brokenLinks.push(`${row.id} -> ${link}`)
      }
    } catch { /* skip malformed */ }
  }

  // Orphaned nodes: nodes whose root_id doesn't exist
  const orphanedEntries = store.database
    .prepare("SELECT DISTINCT n.root_id FROM memory_nodes n LEFT JOIN memories m ON n.root_id = m.id WHERE m.id IS NULL")
    .all() as { root_id: string }[]

  // Stale favorites: favorites with 0 access
  const staleFavorites = store.database
    .prepare("SELECT id FROM memories WHERE favorite = 1 AND access_count = 0")
    .all() as { id: string }[]

  // Tag orphans: tags referencing non-existent entries
  const tagOrphanResult = store.database
    .prepare(`SELECT COUNT(*) as cnt FROM memory_tags t
      LEFT JOIN memories m ON t.entry_id = m.id
      LEFT JOIN memory_nodes n ON t.entry_id = n.id
      WHERE m.id IS NULL AND n.id IS NULL`)
    .get() as { cnt: number }

  return {
    brokenLinks,
    orphanedEntries: orphanedEntries.map((r) => r.root_id),
    staleFavorites: staleFavorites.map((r) => r.id),
    brokenObsoleteChains: [],
    tagOrphans: tagOrphanResult?.cnt ?? 0,
  }
}
