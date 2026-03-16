import type { Store } from "./store"
import type { UpdateFields, AppendResult } from "./types"
import { parseRelativeTree } from "./parse"

function rootIdFrom(id: string): string {
  const dot = id.indexOf(".")
  return dot === -1 ? id : id.slice(0, dot)
}

function getParentDepth(store: Store, parentId: string): number {
  if (!parentId.includes(".")) return 1
  const row = store.database
    .prepare("SELECT depth FROM memory_nodes WHERE id = ?")
    .get(parentId) as { depth: number } | undefined
  return row?.depth ?? 1
}

export function update(store: Store, id: string, fields: UpdateFields): void {
  const now = new Date().toISOString()
  const isNode = id.includes(".")

  if (isNode) {
    if (fields.content !== undefined) {
      store.database.prepare("UPDATE memory_nodes SET content = ?, updated_at = ? WHERE id = ?").run(fields.content, now, id)
    }
    if (fields.favorite !== undefined) {
      store.database.prepare("UPDATE memory_nodes SET favorite = ? WHERE id = ?").run(fields.favorite ? 1 : 0, id)
    }
    if (fields.irrelevant !== undefined) {
      store.database.prepare("UPDATE memory_nodes SET irrelevant = ? WHERE id = ?").run(fields.irrelevant ? 1 : 0, id)
    }
  } else {
    if (fields.content !== undefined) {
      store.database.prepare("UPDATE memories SET level_1 = ?, updated_at = ? WHERE id = ?").run(fields.content, now, id)
    }
    if (fields.favorite !== undefined) {
      store.database.prepare("UPDATE memories SET favorite = ? WHERE id = ?").run(fields.favorite ? 1 : 0, id)
    }
    if (fields.obsolete !== undefined) {
      store.database.prepare("UPDATE memories SET obsolete = ? WHERE id = ?").run(fields.obsolete ? 1 : 0, id)
    }
    if (fields.irrelevant !== undefined) {
      store.database.prepare("UPDATE memories SET irrelevant = ? WHERE id = ?").run(fields.irrelevant ? 1 : 0, id)
    }
    if (fields.pinned !== undefined) {
      store.database.prepare("UPDATE memories SET pinned = ? WHERE id = ?").run(fields.pinned ? 1 : 0, id)
    }
    if (fields.links !== undefined) {
      store.database.prepare("UPDATE memories SET links = ? WHERE id = ?").run(JSON.stringify(fields.links), id)
    }
    if (fields.minRole !== undefined) {
      store.database.prepare("UPDATE memories SET min_role = ? WHERE id = ?").run(fields.minRole, id)
    }
  }
}

export function append(store: Store, parentId: string, content: string): AppendResult {
  const rootId = rootIdFrom(parentId)
  const parentDepth = getParentDepth(store, parentId)
  const row = store.database
    .prepare("SELECT MAX(seq) as m FROM memory_nodes WHERE parent_id = ?")
    .get(parentId) as { m: number | null } | undefined
  const startSeq = (row?.m ?? 0) + 1
  const nodes = parseRelativeTree(content, parentId, parentDepth, startSeq)
  const now = new Date().toISOString()
  const insertNode = store.database.prepare(
    "INSERT INTO memory_nodes (id, parent_id, root_id, depth, seq, content, created_at, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
  const transaction = store.database.transaction(() => {
    for (const node of nodes) {
      insertNode.run(node.id, node.parentId, rootId, node.depth, node.seq, node.content, now, node.title)
    }
  })
  transaction()
  return { count: nodes.length, ids: nodes.map((n) => n.id) }
}
