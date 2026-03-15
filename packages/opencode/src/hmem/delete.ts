import type { Store } from "./store"

export function deleteEntry(store: Store, id: string): boolean {
  const exists = store.database.prepare("SELECT 1 FROM memories WHERE id = ?").get(id)
  if (!exists) return false
  const transaction = store.database.transaction(() => {
    store.database.prepare("DELETE FROM memory_tags WHERE entry_id = ? OR entry_id LIKE ?").run(id, `${id}.%`)
    store.database.prepare("DELETE FROM memory_nodes WHERE root_id = ?").run(id)
    store.database.prepare("DELETE FROM memories WHERE id = ?").run(id)
  })
  transaction()
  return true
}
