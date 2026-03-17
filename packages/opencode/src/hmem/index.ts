import path from "path"
import fs from "fs/promises"
import { Store } from "./store"
import { bulkReadV2 } from "./bulk-read"
import { readL1Headers } from "./read"
import { render } from "./render"
import { assignBulkTags } from "./tags"
import { Agent } from "../agent/agent"
import { Global } from "../global"
import { syncDatabase } from "./sync/client"
import type { SyncResult } from "./sync/client"
import { loadConfig } from "./sync/config"

// Map from store path -> Store instance (for lifecycle management)
const openStores = new Map<string, Store>()

/** Run sync (pull+push) for a store. Non-blocking, errors are swallowed. */
async function trySync(store: Store, storePath: string): Promise<void> {
  const cfg = loadConfig()
  if (!cfg) return
  const passphrase = process.env.HMEM_SYNC_PASSPHRASE
  if (!passphrase) return
  const name = path.basename(storePath, ".hmem")
  await syncDatabase(store, name, cfg, passphrase)
}

async function getOrOpen(storePath: string): Promise<Store> {
  const existing = openStores.get(storePath)
  if (existing) return existing
  const store = await Store.open(storePath)
  openStores.set(storePath, store)
  return store
}

export namespace Hmem {
  /**
   * Returns the store path for Heimdall's primary store.
   * Checks projectDir/.heimdall/config.json for {"memory":"local"}, otherwise global.
   */
  async function heimdallStorePath(projectDir?: string): Promise<string> {
    if (projectDir) {
      try {
        const cfgPath = path.join(projectDir, ".heimdall", "config.json")
        const raw = await fs.readFile(cfgPath, "utf-8")
        const cfg = JSON.parse(raw)
        if (cfg.memory === "local") {
          return path.join(projectDir, ".heimdall", "memory.hmem")
        }
      } catch {
        // config not found or unreadable → use global
      }
    }
    return path.join(Global.Path.data, "HEIMDALL.hmem")
  }

  /**
   * Opens the correct store for the given agent name.
   * - Primary agents (mode === "primary") → Heimdall's store
   * - Subagents → agent-specific store at Global.Path.agents/{NAME}.hmem
   */
  export async function openStore(agentName: string, projectDir?: string): Promise<Store> {
    const agentInfo = await Agent.get(agentName)
    if (agentInfo?.mode === "primary" || !agentInfo) {
      const storePath = await heimdallStorePath(projectDir)
      return getOrOpen(storePath)
    }
    // Subagent gets its own store — keyed by agent ID (uppercase)
    const storePath = path.join(Global.Path.agents, `${agentName.toUpperCase()}.hmem`)
    return getOrOpen(storePath)
  }

  /**
   * Opens a specific agent's store by agent ID (uppercase).
   */
  export async function openAgentStore(agentId: string): Promise<Store> {
    const storePath = path.join(Global.Path.agents, `${agentId.toUpperCase()}.hmem`)
    return getOrOpen(storePath)
  }

  /**
   * Returns the memory context string to inject into the system prompt.
   * - Primary agents (Heimdall store): BulkRead V2 with full rendering
   * - Subagents: last 50 L1 titles only
   */
  export async function autoRecall(agentName: string, projectDir?: string): Promise<string> {
    try {
      const agentInfo = await Agent.get(agentName)
      const isPrimary = agentInfo?.mode === "primary" || !agentInfo

      const store = await openStore(agentName, projectDir)

      // Sync before reading (pull remote changes)
      if (isPrimary) {
        const storePath = await heimdallStorePath(projectDir)
        await trySync(store, storePath).catch(() => {})
      }

      if (isPrimary) {
        const entries = bulkReadV2(store, {})
        if (entries.length === 0) return ""
        assignBulkTags(store, entries)
        const rendered = render(entries)
        if (!rendered.trim()) return ""
        return `<heimdall-memory>\n${rendered}\n</heimdall-memory>`
      } else {
        // Subagent: last 50 L1 headers only
        const headers = readL1Headers(store).slice(0, 50)
        if (headers.length === 0) return ""
        const lines = headers.map((e) => `[${e.id}] ${e.level1}`).join("\n")
        return `<agent-memory>\n${lines}\n</agent-memory>`
      }
    } catch {
      // Non-fatal: if memory store isn't available, return empty
      return ""
    }
  }

  /**
   * Manually triggers bidirectional sync for the primary store.
   * Returns the SyncResult or null if sync is not configured.
   */
  export async function sync(agentName: string, projectDir?: string): Promise<SyncResult | null> {
    const cfg = loadConfig()
    if (!cfg) return null
    const passphrase = process.env.HMEM_SYNC_PASSPHRASE
    if (!passphrase) return null
    const store = await openStore(agentName, projectDir)
    const storePath = await heimdallStorePath(projectDir)
    const name = path.basename(storePath, ".hmem")
    return syncDatabase(store, name, cfg, passphrase)
  }

  /**
   * Closes all open stores (call on shutdown).
   */
  export async function closeAll(): Promise<void> {
    // Push local changes before closing
    for (const [storePath, store] of openStores.entries()) {
      try {
        await trySync(store, storePath)
      } catch { /* non-fatal */ }
      try { store.close() } catch { /* non-fatal */ }
    }
    openStores.clear()
  }

  /**
   * Returns true if the first-chat setup dialog is needed for this projectDir.
   * Looks for the .heimdall/config.json in the project directory.
   */
  export async function needsSetup(projectDir: string): Promise<boolean> {
    try {
      const cfgPath = path.join(projectDir, ".heimdall", "config.json")
      await fs.access(cfgPath)
      return false
    } catch {
      return true
    }
  }

  /**
   * Saves the user's memory scope choice ("local" | "global") for a project.
   */
  export async function saveMemoryChoice(projectDir: string, choice: "local" | "global"): Promise<void> {
    const dir = path.join(projectDir, ".heimdall")
    await fs.mkdir(dir, { recursive: true })
    const cfgPath = path.join(dir, "config.json")
    await fs.writeFile(cfgPath, JSON.stringify({ memory: choice }, null, 2), "utf-8")
  }
}
