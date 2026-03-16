/**
 * hmem-sync client — high-level push/pull coordinator.
 *
 * Reads directly from the hmem SQLite file via the Store API,
 * encrypts entries, and exchanges blobs with the hmem-sync server.
 *
 * Zero-knowledge protocol:
 *   Server stores: { id_hash, blob: { data (AES-GCM), updated_at } }
 *   Server never sees: plaintext IDs, content, tags, or structure.
 *
 * Sync strategy: Last-Write-Wins on updated_at.
 *   Push: entries where updated_at > last_push_at
 *   Pull: blobs from server where updated_at > last_pull_at
 *   Merge: decrypt pulled blobs → upsert into local DB via SQLite
 */

import type { Store } from "../store"
import { deriveKey, encryptEntry, decryptEntry, hashId } from "./crypto"
import type { SyncBlob, EncryptedBlob } from "./crypto"
import { pushBlobs, pullBlobs } from "./transport"
import { loadToken, loadState, saveState, getDbState, setDbState } from "./config"
import type { SyncConfig } from "./config"

// ---- Wire-format types ----

interface SyncNode {
  id: string
  parent_id: string
  depth: number
  seq: number
  content: string
  created_at: string
  updated_at: string | null
  favorite: number
  obsolete: number
  irrelevant: number
  secret: number
  links: string | null
}

interface SyncEntry {
  id: string
  prefix: string
  seq: number
  created_at: string
  updated_at: string | null
  level_1: string
  obsolete: number
  favorite: number
  irrelevant: number
  active: number
  secret: number
  pinned: number
  links: string | null
  min_role: string
  tags: string[]
  nodes: SyncNode[]
}

// ---- SyncClient class ----

export class SyncClient {
  private key: Buffer
  private dbName: string
  private cfg: SyncConfig

  constructor(cfg: SyncConfig, dbName: string, passphrase: string) {
    this.cfg = cfg
    this.dbName = dbName
    this.key = deriveKey(passphrase, cfg.salt)
  }

  // ---- Reading entries from the local Store ----

  private readEntries(store: Store, since: string | null, syncSecrets: boolean): SyncEntry[] {
    const db = store.database
    let sql = `
      SELECT m.*, GROUP_CONCAT(mt.tag) as tag_list
      FROM memories m
      LEFT JOIN memory_tags mt ON mt.entry_id = m.id
      WHERE m.seq > 0
    `
    const params: unknown[] = []

    if (since) {
      sql += " AND (m.updated_at > ? OR (m.updated_at IS NULL AND m.created_at > ?))"
      params.push(since, since)
    }

    if (!syncSecrets) {
      sql += " AND (m.secret IS NULL OR m.secret = 0)"
    }

    sql += " GROUP BY m.id ORDER BY m.updated_at ASC"

    const rows = db.prepare(sql).all(...params) as any[]
    return rows.map((row) => {
      const nodes = this.readNodes(store, row.id, syncSecrets)
      return {
        id: row.id,
        prefix: row.prefix,
        seq: row.seq,
        created_at: row.created_at,
        updated_at: row.updated_at ?? null,
        level_1: row.level_1,
        obsolete: row.obsolete ?? 0,
        favorite: row.favorite ?? 0,
        irrelevant: row.irrelevant ?? 0,
        active: row.active ?? 0,
        secret: row.secret ?? 0,
        pinned: row.pinned ?? 0,
        links: row.links ?? null,
        min_role: row.min_role ?? "worker",
        tags: row.tag_list ? row.tag_list.split(",") : [],
        nodes,
      } satisfies SyncEntry
    })
  }

  private readNodes(store: Store, rootId: string, syncSecrets: boolean): SyncNode[] {
    let sql = "SELECT * FROM memory_nodes WHERE root_id = ?"
    if (!syncSecrets) sql += " AND (secret IS NULL OR secret = 0)"
    sql += " ORDER BY depth ASC, seq ASC"
    const rows = store.database.prepare(sql).all(rootId) as any[]
    return rows.map((row) => ({
      id: row.id,
      parent_id: row.parent_id,
      depth: row.depth,
      seq: row.seq,
      content: row.content,
      created_at: row.created_at,
      updated_at: row.updated_at ?? null,
      favorite: row.favorite ?? 0,
      obsolete: row.obsolete ?? 0,
      irrelevant: row.irrelevant ?? 0,
      secret: row.secret ?? 0,
      links: row.links ?? null,
    }))
  }

  // ---- Encrypt / Decrypt ----

  buildPushPayload(store: Store, since: string | null, syncSecrets: boolean): SyncBlob[] {
    const entries = this.readEntries(store, since, syncSecrets)
    return entries.map((entry) => {
      const updatedAt = entry.updated_at ?? entry.created_at
      return {
        id_hash: hashId(entry.id, this.dbName, this.cfg.salt),
        blob: encryptEntry(entry.id, entry, this.key, updatedAt),
      }
    })
  }

  mergeBlob(
    store: Store,
    blob: { id_hash: string; blob: EncryptedBlob },
  ): "upserted" | "skipped" | "error" {
    try {
      const payload = decryptEntry<SyncEntry>(blob.blob, this.key)
      return this.upsertEntry(store, payload)
    } catch {
      return "error"
    }
  }

  // ---- Upsert ----

  private upsertEntry(store: Store, payload: SyncEntry): "upserted" | "skipped" {
    const db = store.database
    const existing = db
      .prepare("SELECT updated_at, created_at FROM memories WHERE id = ?")
      .get(payload.id) as { updated_at: string | null; created_at: string } | undefined

    const incomingTs = payload.updated_at ?? payload.created_at

    if (existing) {
      const localTs = existing.updated_at ?? existing.created_at
      if (localTs >= incomingTs) return "skipped" // local is newer or equal
    }

    db.transaction(() => {
      // Upsert root entry
      db.prepare(`
        INSERT INTO memories (id, prefix, seq, created_at, updated_at, level_1,
          obsolete, favorite, irrelevant, pinned, links, min_role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          updated_at  = excluded.updated_at,
          level_1     = excluded.level_1,
          obsolete    = excluded.obsolete,
          favorite    = excluded.favorite,
          irrelevant  = excluded.irrelevant,
          pinned      = excluded.pinned,
          links       = excluded.links,
          min_role    = excluded.min_role
      `).run(
        payload.id,
        payload.prefix,
        payload.seq,
        payload.created_at,
        payload.updated_at,
        payload.level_1,
        payload.obsolete,
        payload.favorite,
        payload.irrelevant,
        payload.pinned,
        payload.links,
        payload.min_role,
      )

      // Upsert nodes
      for (const node of payload.nodes) {
        const title = node.content.split("\n")[0].substring(0, 50)
        db.prepare(`
          INSERT INTO memory_nodes (id, parent_id, root_id, depth, seq, content,
            created_at, updated_at, favorite, irrelevant, title)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            content    = excluded.content,
            updated_at = excluded.updated_at,
            favorite   = excluded.favorite,
            irrelevant = excluded.irrelevant,
            title      = excluded.title
        `).run(
          node.id,
          node.parent_id,
          payload.id,
          node.depth,
          node.seq,
          node.content,
          node.created_at,
          node.updated_at,
          node.favorite,
          node.irrelevant,
          title,
        )
      }

      // Upsert tags (additive — no removals on pull)
      for (const tag of payload.tags) {
        db.prepare(
          "INSERT OR IGNORE INTO memory_tags (entry_id, tag) VALUES (?, ?)",
        ).run(payload.id, tag)
      }
    })()

    return "upserted"
  }
}

// ---- High-level syncDatabase function ----

export interface SyncResult {
  pushed: number
  pulled: number
  upserted: number
  skipped: number
  errors: number
}

/**
 * Full bidirectional sync for a single database.
 * Pushes local changes since last_push_at, then pulls server changes
 * since last_pull_at. Updates state on completion.
 */
export async function syncDatabase(
  store: Store,
  dbName: string,
  cfg: SyncConfig,
  passphrase: string,
): Promise<SyncResult> {
  const token = loadToken()
  if (!token) throw new Error("No sync token found. Run sync setup first.")

  const dbCfg = cfg.databases.find((d) => d.dbName === dbName)
  const syncSecrets = dbCfg?.syncSecrets ?? cfg.syncSecrets

  const client = new SyncClient(cfg, dbName, passphrase)
  let state = loadState()
  const dbState = getDbState(state, dbName)

  // ---- Push ----
  const pushPayload = client.buildPushPayload(store, dbState.last_push_at, syncSecrets)
  let pushed = 0
  if (pushPayload.length > 0) {
    pushed = await pushBlobs(cfg.serverUrl, token, pushPayload)
    state = setDbState(state, dbName, { last_push_at: new Date().toISOString() })
    saveState(state)
  }

  // ---- Pull ----
  const pullResponse = await pullBlobs(cfg.serverUrl, token, dbState.last_pull_at)
  const blobs = pullResponse.blobs

  let upserted = 0
  let skipped = 0
  let errors = 0

  for (const b of blobs) {
    const result = client.mergeBlob(store, b)
    if (result === "upserted") upserted++
    else if (result === "skipped") skipped++
    else errors++
  }

  if (errors === 0 || upserted > 0) {
    const pullAt = pullResponse.server_time ?? new Date().toISOString()
    state = setDbState(state, dbName, { last_pull_at: pullAt })
    saveState(state)
  }

  return { pushed, pulled: blobs.length, upserted, skipped, errors }
}
