import path from "path"
import fs from "fs/promises"
import { Store } from "./store"
import { bulkReadV2 } from "./bulk-read"
import { readL1Headers } from "./read"
import { render } from "./render"
import { assignBulkTags } from "./tags"
import { Agent } from "../agent/agent"
import { Global } from "../global"

// Map from store path -> Store instance (for lifecycle management)
const openStores = new Map<string, Store>()

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
    return path.join(Global.Path.data, "memory.hmem")
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
    // Subagent gets its own store (uppercase name)
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
   * Closes all open stores (call on shutdown).
   */
  export function closeAll(): void {
    for (const store of openStores.values()) {
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
