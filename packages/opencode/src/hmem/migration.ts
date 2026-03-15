import fs from "fs"
import path from "path"
import os from "os"
import { Global } from "../global"

const MIGRATED_PATH = () => path.join(Global.Path.data, "migrated.json")

interface MigratedState {
  hmem?: boolean
  hmemSync?: boolean
  date?: string
}

function loadMigrated(): MigratedState {
  try {
    return JSON.parse(fs.readFileSync(MIGRATED_PATH(), "utf8"))
  } catch {
    return {}
  }
}

function saveMigrated(state: MigratedState): void {
  fs.mkdirSync(path.dirname(MIGRATED_PATH()), { recursive: true })
  fs.writeFileSync(MIGRATED_PATH(), JSON.stringify(state, null, 2))
}

/** Check if old hmem exists and needs migration */
export function needsHmemMigration(): { path: string; entryCount: number } | null {
  const migrated = loadMigrated()
  if (migrated.hmem) return null

  const oldPath = path.join(os.homedir(), ".hmem", "memory.hmem")
  if (!fs.existsSync(oldPath)) return null

  try {
    // Use dynamic import to avoid hard dependency
    const Database = require("bun:sqlite").Database
    const db = new Database(oldPath, { readonly: true })
    const row = db.prepare("SELECT COUNT(*) as count FROM memories WHERE seq > 0").get() as any
    db.close()
    return { path: oldPath, entryCount: row?.count ?? -1 }
  } catch {
    return { path: oldPath, entryCount: -1 }
  }
}

/** Copy old hmem to new location */
export function migrateHmem(): void {
  const oldPath = path.join(os.homedir(), ".hmem", "memory.hmem")
  const newPath = path.join(Global.Path.data, "memory.hmem")

  fs.mkdirSync(path.dirname(newPath), { recursive: true })
  fs.copyFileSync(oldPath, newPath)

  // Also copy WAL/SHM if they exist
  for (const suffix of ["-wal", "-shm"]) {
    const src = oldPath + suffix
    if (fs.existsSync(src)) fs.copyFileSync(src, newPath + suffix)
  }

  const migrated = loadMigrated()
  migrated.hmem = true
  migrated.date = new Date().toISOString()
  saveMigrated(migrated)
}

/** Migrate hmem-sync config files to new location */
export function migrateHmemSync(): void {
  const migrated = loadMigrated()
  if (migrated.hmemSync) return

  const home = os.homedir()
  const oldConfig = path.join(home, ".hmem-sync-config.json")
  const oldToken = path.join(home, ".hmem-sync-token")
  const oldState = path.join(home, ".hmem-sync.json")

  if (!fs.existsSync(oldConfig)) return

  const syncDir = Global.Path.sync
  fs.mkdirSync(syncDir, { recursive: true })

  // Migrate config
  try {
    const cfg = JSON.parse(fs.readFileSync(oldConfig, "utf8"))
    const newCfg = {
      serverUrl: cfg.serverUrl ?? "https://bbbee.uber.space",
      userId: cfg.userId,
      salt: cfg.salt,
      syncSecrets: cfg.syncSecrets ?? false,
      databases: { heimdall: { enabled: true } },
    }
    fs.writeFileSync(path.join(syncDir, "config.json"), JSON.stringify(newCfg, null, 2))
  } catch {}

  // Migrate token
  if (fs.existsSync(oldToken)) {
    try {
      const token = fs.readFileSync(oldToken, "utf8").replace(/[^\x21-\x7E]/g, "")
      if (token) {
        const tokenPath = path.join(syncDir, "token")
        fs.writeFileSync(tokenPath, token, { encoding: "utf8", mode: 0o600 })
        try { fs.chmodSync(tokenPath, 0o600) } catch {}
      }
    } catch {}
  }

  // Migrate state: flat → keyed by "heimdall"
  if (fs.existsSync(oldState)) {
    try {
      const old = JSON.parse(fs.readFileSync(oldState, "utf8"))
      const newState = {
        heimdall: {
          last_push_at: old.last_push_at ?? null,
          last_pull_at: old.last_pull_at ?? null,
        },
      }
      fs.writeFileSync(path.join(syncDir, "state.json"), JSON.stringify(newState, null, 2))
    } catch {}
  }

  migrated.hmemSync = true
  migrated.date = new Date().toISOString()
  saveMigrated(migrated)
}
