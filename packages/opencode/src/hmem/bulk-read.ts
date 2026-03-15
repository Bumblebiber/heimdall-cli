import type { Store } from "./store"
import type { MemoryEntry, ReadOptions } from "./types"
import { allowedRoles } from "./types"
import { scanEntry, loadDirectChildren, loadChildrenToDepth } from "./read"

function weightedAccessScore(entry: MemoryEntry): number {
  const created = new Date(entry.createdAt).getTime()
  const ageDays = (Date.now() - created) / (1000 * 60 * 60 * 24)
  return entry.accessCount / Math.log2(ageDays + 2)
}

const RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

function isRecent(entry: MemoryEntry): boolean {
  const created = new Date(entry.createdAt).getTime()
  return (Date.now() - created) < RECENCY_WINDOW_MS
}

function readBulkAll(store: Store, opts: ReadOptions): MemoryEntry[] {
  let sql = "SELECT * FROM memories WHERE seq > 0"
  const params: any[] = []

  if (opts.prefix) {
    sql += " AND prefix = ?"
    params.push(opts.prefix.toUpperCase())
  }
  if (opts.agentRole) {
    const roles = allowedRoles(opts.agentRole)
    sql += ` AND min_role IN (${roles.map(() => "?").join(",")})`
    params.push(...roles)
  }
  if (opts.after) {
    sql += " AND created_at > ?"
    params.push(opts.after)
  }
  if (opts.before) {
    sql += " AND created_at < ?"
    params.push(opts.before)
  }

  sql += " ORDER BY created_at DESC"

  const rows = store.database.prepare(sql).all(...params) as any[]
  return rows.map(scanEntry)
}

export function bulkReadV2(store: Store, opts: ReadOptions): MemoryEntry[] {
  const all = readBulkAll(store, opts)
  const active = all.filter((e) => !e.irrelevant && !e.obsolete)

  const byPrefix = new Map<string, MemoryEntry[]>()
  for (const e of active) {
    const group = byPrefix.get(e.prefix) ?? []
    group.push(e)
    byPrefix.set(e.prefix, group)
  }

  const selected = new Set<string>()
  for (const [, group] of byPrefix) {
    const newestCount = Math.ceil(group.length * 0.6)
    for (let i = 0; i < newestCount && i < group.length; i++) {
      selected.add(group[i].id)
    }
    const accessCount = Math.ceil(group.length * 0.4)
    const byAccess = [...group].sort((a, b) => weightedAccessScore(b) - weightedAccessScore(a))
    for (let i = 0; i < accessCount && i < byAccess.length; i++) {
      selected.add(byAccess[i].id)
    }
  }

  for (const e of all) {
    if (e.favorite || e.pinned) selected.add(e.id)
  }

  // Session-recency boost: entries < 24h always included
  for (const e of active) {
    if (isRecent(e)) selected.add(e.id)
  }

  const { hidden, cached } = store.cache.hiddenAndCachedSets()

  const result: MemoryEntry[] = []
  for (const e of all) {
    if (!selected.has(e.id)) continue
    if (hidden.has(e.id) && !e.favorite && !e.pinned) continue

    if (isRecent(e)) {
      // Session-recency boost: entries < 24h get full L1-L4 expansion
      e.children = loadChildrenToDepth(store, e.id, 3) // depth 3 = L2→L3→L4
    } else {
      // L2 full body: always load direct children (L2 level) for context
      e.children = loadDirectChildren(store, e.id)
    }
    result.push(e)
  }

  store.cache.recordAll(result.map((e) => e.id))

  return result
}
