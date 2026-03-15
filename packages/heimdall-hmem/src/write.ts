import type { Store } from "./store.js"
import type { WriteOptions, WriteResult } from "./types.js"
import { VALID_PREFIXES, CHAR_LIMITS, CHAR_TOLERANCE } from "./types.js"
import { parseTree } from "./parse.js"

function nextSeq(store: Store, prefix: string): number {
  const row = store.database
    .prepare("SELECT MAX(seq) as m FROM memories WHERE prefix = ?")
    .get(prefix) as { m: number | null } | undefined
  return (row?.m ?? 0) + 1
}

function checkCharLimit(content: string, depth: number): void {
  const limit = CHAR_LIMITS[depth] ?? 0
  if (limit === 0) return // unlimited (L5)
  const tolerance = Math.floor(limit * CHAR_TOLERANCE)
  if (content.length > tolerance) {
    throw new Error(
      `Content at depth ${depth + 1} exceeds limit: ${content.length} > ${tolerance} (limit: ${limit})`,
    )
  }
}

export function write(
  store: Store,
  prefix: string,
  content: string,
  opts: WriteOptions = {},
): WriteResult {
  const upper = prefix.toUpperCase()
  if (!VALID_PREFIXES.includes(upper as any)) {
    throw new Error(`Invalid prefix: ${prefix}. Valid: ${VALID_PREFIXES.join(", ")}`)
  }

  const seq = nextSeq(store, upper)
  const id = `${upper}${String(seq).padStart(4, "0")}`
  const now = new Date().toISOString()

  const parsed = parseTree(content, id)

  // Check char limits on L1
  checkCharLimit(parsed.level1, 0)

  // Check char limits on children
  for (const node of parsed.nodes) {
    checkCharLimit(node.content, node.depth - 1)
  }

  const db = store.database

  const insertEntry = db.prepare(`
    INSERT INTO memories (id, prefix, seq, created_at, updated_at, level_1, title, links, min_role, favorite, pinned)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertNode = db.prepare(`
    INSERT INTO memory_nodes (id, parent_id, root_id, depth, seq, content, created_at, updated_at, title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertTag = db.prepare(`
    INSERT INTO memory_tags (entry_id, tag) VALUES (?, ?)
  `)

  const transaction = db.transaction(() => {
    insertEntry.run(
      id,
      upper,
      seq,
      now,
      now,
      parsed.level1,
      parsed.title,
      JSON.stringify(opts.links ?? []),
      opts.minRole ?? "worker",
      opts.favorite ? 1 : 0,
      opts.pinned ? 1 : 0,
    )

    for (const node of parsed.nodes) {
      insertNode.run(node.id, node.parentId, id, node.depth, node.seq, node.content, now, now, node.title)
    }

    if (opts.tags && opts.tags.length > 0) {
      const tagTarget = parsed.nodes.length > 0 ? parsed.nodes[0].id : id
      for (const tag of opts.tags) {
        insertTag.run(tagTarget, tag.toLowerCase())
      }
    }
  })

  transaction()

  return { id, timestamp: now }
}
