import path from "path"
import fs from "fs/promises"
import { HmemStore } from "hmem-mcp"
import type { MemoryEntry } from "hmem-mcp"
import { render } from "./render"
import { Agent } from "../agent/agent"
import { Global } from "../global"

class SessionCache {
  private shown = new Map<string, number>()

  record(id: string): void {
    this.shown.set(id, Date.now())
  }

  recordAll(ids: string[]): void {
    const now = Date.now()
    for (const id of ids) this.shown.set(id, now)
  }

  hiddenAndCachedSets(): { hiddenIds: Set<string>; cachedIds: Set<string> } {
    const now = Date.now()
    const hiddenIds = new Set<string>()
    const cachedIds = new Set<string>()
    for (const [id, ts] of this.shown) {
      const age = now - ts
      if (age < 5 * 60_000) hiddenIds.add(id)
      else if (age < 30 * 60_000) cachedIds.add(id)
    }
    return { hiddenIds, cachedIds }
  }
}

const openStores = new Map<string, { store: HmemStore; cache: SessionCache }>()

function getOrOpen(storePath: string): { store: HmemStore; cache: SessionCache } {
  const existing = openStores.get(storePath)
  if (existing) return existing
  const entry = { store: new HmemStore(storePath), cache: new SessionCache() }
  openStores.set(storePath, entry)
  return entry
}

export namespace Hmem {
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

  export async function openStore(agentName: string, projectDir?: string): Promise<HmemStore> {
    const agentInfo = await Agent.get(agentName)
    if (agentInfo?.mode === "primary" || !agentInfo) {
      const storePath = await heimdallStorePath(projectDir)
      return getOrOpen(storePath).store
    }
    const storePath = path.join(Global.Path.agents, `${agentName.toUpperCase()}.hmem`)
    return getOrOpen(storePath).store
  }

  export async function openAgentStore(agentId: string): Promise<HmemStore> {
    const storePath = path.join(Global.Path.agents, `${agentId.toUpperCase()}.hmem`)
    return getOrOpen(storePath).store
  }

  export async function autoRecall(agentName: string, projectDir?: string): Promise<string> {
    try {
      const agentInfo = await Agent.get(agentName)
      const isPrimary = agentInfo?.mode === "primary" || !agentInfo
      const storePath = isPrimary
        ? await heimdallStorePath(projectDir)
        : path.join(Global.Path.agents, `${agentName.toUpperCase()}.hmem`)
      const { store, cache } = getOrOpen(storePath)

      if (isPrimary) {
        const { hiddenIds, cachedIds } = cache.hiddenAndCachedSets()
        const entries = store.read({ mode: "discover", hiddenIds, cachedIds })
        if (entries.length === 0) return ""
        store.assignBulkTags(entries)
        cache.recordAll(entries.map((e) => e.id))
        return `<heimdall-memory>\n${render(entries)}\n</heimdall-memory>`
      }
      // Subagent: last 50 L1 headers only
      const headers = store.read({ titlesOnly: true }).slice(0, 50)
      if (headers.length === 0) return ""
      const lines = headers.map((e: MemoryEntry) => `[${e.id}] ${e.level_1}`).join("\n")
      return `<agent-memory>\n${lines}\n</agent-memory>`
    } catch {
      return ""
    }
  }

  export function closeAll(): void {
    for (const { store } of openStores.values()) {
      try {
        store.close()
      } catch {
        /* non-fatal */
      }
    }
    openStores.clear()
  }

  export async function needsSetup(projectDir: string): Promise<boolean> {
    try {
      const cfgPath = path.join(projectDir, ".heimdall", "config.json")
      await fs.access(cfgPath)
      return false
    } catch {
      return true
    }
  }

  export async function saveMemoryChoice(projectDir: string, choice: "local" | "global"): Promise<void> {
    const dir = path.join(projectDir, ".heimdall")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "config.json"), JSON.stringify({ memory: choice }, null, 2), "utf-8")
  }
}

export { HmemStore } from "hmem-mcp"
export type { MemoryEntry, MemoryNode, ReadOptions, AgentRole } from "hmem-mcp"
