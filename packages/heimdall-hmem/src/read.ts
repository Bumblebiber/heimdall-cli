import type { Store } from "./store.js"
import type { MemoryEntry, MemoryNode, ReadOptions } from "./types.js"

function scanEntry(row: any): MemoryEntry {
  return {
    id: row.id,
    prefix: row.prefix,
    seq: row.seq,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? "",
    title: row.title ?? "",
    level1: row.level_1,
    links: row.links ? JSON.parse(row.links) : [],
    minRole: row.min_role ?? "worker",
    obsolete: !!row.obsolete,
    favorite: !!row.favorite,
    irrelevant: !!row.irrelevant,
    pinned: !!row.pinned,
    accessCount: row.access_count ?? 0,
    lastAccessed: row.last_accessed ?? null,
    promoted: row.favorite || row.pinned ? "favorite" : "",
    tags: [],
    children: [],
  }
}

function scanNode(row: any): MemoryNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    rootId: row.root_id,
    depth: row.depth,
    seq: row.seq,
    title: row.title ?? "",
    content: row.content,
    createdAt: row.created_at,
    accessCount: row.access_count ?? 0,
    favorite: !!row.favorite,
    irrelevant: !!row.irrelevant,
    tags: [],
    children: [],
  }
}

function loadDirectChildren(store: Store, parentId: string): MemoryNode[] {
  const rows = store.database
    .prepare("SELECT * FROM memory_nodes WHERE parent_id = ? ORDER BY seq ASC")
    .all(parentId) as any[]
  return rows.map(scanNode)
}

function bumpAccess(store: Store, id: string): void {
  try {
    store.database
      .prepare("UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?")
      .run(new Date().toISOString(), id)
  } catch {
    // Non-fatal
  }
}

function readRootById(store: Store, id: string): MemoryEntry[] {
  const row = store.database.prepare("SELECT * FROM memories WHERE id = ?").get(id) as any
  if (!row) return []
  bumpAccess(store, id)
  // Re-fetch after bump to get updated access_count
  const updatedRow = store.database.prepare("SELECT * FROM memories WHERE id = ?").get(id) as any
  const entry = scanEntry(updatedRow)
  entry.children = loadDirectChildren(store, id)
  return [entry]
}

function readNodeById(store: Store, id: string): MemoryEntry[] {
  const row = store.database.prepare("SELECT * FROM memory_nodes WHERE id = ?").get(id) as any
  if (!row) return []
  const node = scanNode(row)
  const children = loadDirectChildren(store, id)

  const entry: MemoryEntry = {
    id: node.id,
    prefix: "",
    seq: 0,
    createdAt: node.createdAt,
    updatedAt: "",
    title: node.title,
    level1: `[${node.id}] ${node.content}`,
    links: [],
    minRole: "worker",
    obsolete: false,
    favorite: node.favorite,
    irrelevant: node.irrelevant,
    pinned: false,
    accessCount: node.accessCount,
    lastAccessed: null,
    promoted: "",
    tags: [],
    children,
  }
  return [entry]
}

function readBySearch(store: Store, query: string, limit: number): MemoryEntry[] {
  const rows = store.database
    .prepare(`
      SELECT DISTINCT m.root_id
      FROM hmem_fts f
      JOIN hmem_fts_rowid_map m ON m.fts_rowid = f.rowid
      WHERE hmem_fts MATCH ?
      LIMIT ?
    `)
    .all(query, limit) as any[]

  const entries: MemoryEntry[] = []
  for (const row of rows) {
    const found = readRootById(store, row.root_id)
    entries.push(...found)
  }
  return entries
}

export function read(store: Store, opts: ReadOptions = {}): MemoryEntry[] {
  if (opts.id) {
    return opts.id.includes(".")
      ? readNodeById(store, opts.id)
      : readRootById(store, opts.id)
  }

  if (opts.search) {
    return readBySearch(store, opts.search, opts.limit ?? 20)
  }

  // Default: bulk read
  const limit = opts.limit ?? 100
  const rows = store.database
    .prepare("SELECT * FROM memories WHERE seq > 0 ORDER BY created_at DESC LIMIT ?")
    .all(limit) as any[]

  return rows.map((row) => {
    const entry = scanEntry(row)
    entry.children = loadDirectChildren(store, entry.id)
    return entry
  })
}

/**
 * Recursively load children up to maxDepth levels deep.
 * depth=1 is equivalent to loadDirectChildren.
 */
function loadChildrenToDepth(store: Store, parentId: string, maxDepth: number): MemoryNode[] {
  if (maxDepth <= 0) return []
  const children = loadDirectChildren(store, parentId)
  if (maxDepth > 1) {
    for (const child of children) {
      child.children = loadChildrenToDepth(store, child.id, maxDepth - 1)
    }
  }
  return children
}

/**
 * Read all L1 entries (headers only, no children loaded).
 * Used by the compaction agent to see what's already in memory.
 */
function readL1Headers(store: Store, opts: { prefix?: string } = {}): MemoryEntry[] {
  let sql = "SELECT * FROM memories WHERE seq > 0"
  const params: any[] = []

  if (opts.prefix) {
    sql += " AND prefix = ?"
    params.push(opts.prefix.toUpperCase())
  }

  sql += " ORDER BY created_at DESC"

  const rows = store.database.prepare(sql).all(...params) as any[]
  return rows.map(scanEntry) // No children loaded — L1 only
}

// Export helpers for reuse in bulk-read
export { scanEntry, scanNode, loadDirectChildren, bumpAccess, readL1Headers, loadChildrenToDepth }
