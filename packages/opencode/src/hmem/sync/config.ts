/**
 * hmem-sync config, token, and state persistence.
 *
 * All files are stored under Global.Path.sync:
 *   config.json  — server URL, user ID, salt, sync options per DB
 *   token        — bearer token (chmod 600, never committed)
 *   state.json   — per-DB last_push_at / last_pull_at timestamps
 */

import fs from "fs"
import path from "path"
import { Global } from "../../global"

// ---- Interfaces ----

export interface DatabaseSyncConfig {
  /** Local path to the .hmem SQLite file */
  hmemPath: string
  /** Logical name for this DB (used in id_hash namespacing) */
  dbName: string
  /** Whether to include entries with secret=1 */
  syncSecrets: boolean
}

export interface SyncConfig {
  serverUrl: string
  userId: string
  /** Base64-encoded 32-byte salt (public, stored server-side) */
  salt: string
  /** Whether to sync entries marked secret (global default) */
  syncSecrets: boolean
  /** Per-database overrides and paths */
  databases: DatabaseSyncConfig[]
}

export interface DbSyncState {
  last_push_at: string | null
  last_pull_at: string | null
}

export interface SyncState {
  /** Keyed by dbName */
  [dbName: string]: DbSyncState
}

// ---- Path helpers ----

function configFilePath(): string {
  return path.join(Global.Path.sync, "config.json")
}

function tokenFilePath(): string {
  return path.join(Global.Path.sync, "token")
}

function stateFilePath(): string {
  return path.join(Global.Path.sync, "state.json")
}

// ---- Config ----

export function loadConfig(): SyncConfig | null {
  const p = configFilePath()
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as SyncConfig
  } catch {
    return null
  }
}

export function saveConfig(cfg: SyncConfig): void {
  fs.mkdirSync(Global.Path.sync, { recursive: true })
  fs.writeFileSync(configFilePath(), JSON.stringify(cfg, null, 2), "utf8")
}

// ---- Token ----

export function loadToken(): string | null {
  const p = tokenFilePath()
  if (!fs.existsSync(p)) return null
  const raw = fs.readFileSync(p, "utf8")
  // Strip non-printable ASCII (guard against BOM / encoding issues)
  const token = raw.replace(/[^\x21-\x7E]/g, "")
  return token || null
}

export function saveToken(token: string): void {
  fs.mkdirSync(Global.Path.sync, { recursive: true })
  const p = tokenFilePath()
  fs.writeFileSync(p, token, { encoding: "utf8", mode: 0o600 })
  try {
    fs.chmodSync(p, 0o600)
  } catch {
    // chmod is a no-op on Windows — ignore
  }
}

// ---- State ----

export function loadState(): SyncState {
  const p = stateFilePath()
  if (!fs.existsSync(p)) return {}
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as SyncState
  } catch {
    return {}
  }
}

export function saveState(state: SyncState): void {
  fs.mkdirSync(Global.Path.sync, { recursive: true })
  fs.writeFileSync(stateFilePath(), JSON.stringify(state, null, 2), "utf8")
}

export function getDbState(state: SyncState, dbName: string): DbSyncState {
  return state[dbName] ?? { last_push_at: null, last_pull_at: null }
}

export function setDbState(
  state: SyncState,
  dbName: string,
  updates: Partial<DbSyncState>,
): SyncState {
  return {
    ...state,
    [dbName]: {
      ...getDbState(state, dbName),
      ...updates,
    },
  }
}
