# hmem-mcp as Dependency — Design Spec

**Date:** 2026-03-16
**Goal:** Replace the duplicated hmem core implementation in `packages/opencode/src/hmem/` with the `hmem-mcp` npm package as a direct dependency. Updates to hmem-mcp automatically flow into Heimdall without manual porting.

## Problem

Heimdall's native hmem integration (`packages/opencode/src/hmem/`, ~1800 lines across 20 files) is a 1:1 copy of `hmem-mcp`'s core logic. When hmem-mcp gets an update (new features, bug fixes, schema migrations), Heimdall's copy stays stale. Manual porting is error-prone and unsustainable.

## Solution

Add `hmem-mcp` as an npm dependency in `packages/opencode/package.json`. Delete the duplicated core files. Keep only Heimdall-specific wrapper code that provides agent isolation, auto-recall, sync, and tool registration.

## Constraints

- **better-sqlite3 accepted** — hmem-mcp uses `better-sqlite3` (native C++ addon). The bun:sqlite adapter is dropped for now. A future hmem 3.0 will add a DB adapter parameter for bun:sqlite support.
- **render.ts stays local** — hmem-mcp does not export a formatter. Heimdall keeps its own `render.ts` (~100 lines) until hmem-mcp adds one.
- **Sync stays local** — The `sync/` directory (encrypted cloud sync ported from hmem-sync v0.2.7) is Heimdall-specific and stays. See "Sync Client" section for the raw DB handle issue.

## Callers (Blast Radius)

3 files import from `src/hmem/`:

1. `session/llm.ts` — `import { Hmem } from "@/hmem"` (autoRecall for system prompt injection)
2. `tool/registry.ts` — `import { HmemTools } from "../hmem/tools"` (tool registration)
3. `cli/cmd/tui/routes/session/index.tsx` — dynamic `import("@/hmem/write")` + `import("@/hmem")` (groupchat /endchat persistence)

Callers 1-2 import from the public API. Caller 3 imports the internal `write` function directly — this must be rewired to use `Hmem.openStore()` + `store.write()` instead.

## Files Deleted

These files in `packages/opencode/src/hmem/` are fully replaced by `hmem-mcp`'s `HmemStore` class:

- `store.ts` — Store class (open, close, schema init)
- `schema.ts` — SQLite DDL + migrations
- `sqlite-adapter.ts` — Runtime adapter (bun:sqlite / better-sqlite3)
- `read.ts` — read, readL1Headers, loadChildren
- `write.ts` — write new entries with tab-indented parsing
- `modify.ts` — update, append operations
- `delete.ts` — deleteEntry
- `tags.ts` — setTags, fetchTags, validateTags, assignBulkTags
- `related.ts` — findRelated by tag overlap
- `stats.ts` — stats, healthCheck
- `bulk-read.ts` — BulkRead V2 with session-cache logic
- `parse.ts` — Tab-indented content to node tree
- `session-cache.ts` — Session-scoped cache (hidden 5min, cached 5-30min)
- `types.ts` — MemoryEntry, MemoryNode type definitions

**Total: 14 files deleted.**

## Files Kept (Heimdall-Specific)

| File | Purpose | Changes |
|------|---------|---------|
| `index.ts` | Agent isolation, auto-recall, store lifecycle, session cache | Rewrite: `Store` → `HmemStore` from hmem-mcp. Maintain `SessionCache` per store. |
| `tools.ts` | 9 LLM tool definitions (hmem_search, hmem_read, hmem_write, hmem_append, hmem_list, hmem_tag, hmem_stats, hmem_health, hmem_read_agent) | Rewrite: call `HmemStore` methods directly |
| `render.ts` | Format `MemoryEntry[]` to text for system prompt | Keep as-is, import types from hmem-mcp |
| `compact.ts` | Compaction engine (hmem-compaction agent) | Rewrite imports: `write()` → `store.write()`, types from hmem-mcp. Keep local `CompactedTopic`/`CompactionResult` types (Heimdall-specific). |
| `setup-dialog.ts` | First-chat dialog (local/global memory choice) | Keep as-is |
| `migration.ts` | Migrate existing `~/.hmem/` data to Heimdall paths | Keep as-is (imports only from `../global`, not from deleted files) |
| `sync/` | Encrypted cloud sync (AES-256-GCM, push/pull) | Needs shim for raw DB access (see below) |

## Sync Client — Raw DB Handle

**Problem:** `sync/client.ts` accesses `store.database` to execute raw SQL (SELECT/INSERT/UPDATE on memories, memory_nodes, memory_tags tables). `HmemStore` from hmem-mcp does not expose its internal `db` property.

**Solution:** Add a `getDb()` accessor to hmem-mcp in the next minor release. This is a small, low-risk change:

```ts
// hmem-mcp addition
class HmemStore {
  /** Access the underlying better-sqlite3 Database instance. Use with caution. */
  getDb(): Database { return this.db }
}
```

Until then, workaround: access the private field via `(store as any).db` — ugly but functional for an internal module that we own.

**Future (hmem 3.0):** Replace raw SQL in sync/client.ts with proper HmemStore API methods (exportEntries, importEntries).

## API Mapping

Local functions map to `HmemStore` methods:

| Old (local function) | New (HmemStore method) |
|---|---|
| `Store.open(path)` | `new HmemStore(path)` (synchronous) |
| `store.close()` | `store.close()` |
| `read(store, opts)` | `store.read(opts)` |
| `write(store, prefix, content, links, role, fav, tags)` | `store.write(prefix, content, links, role, fav, tags)` |
| `update(store, id, content, ...)` | `store.updateNode(id, content, ...)` |
| `append(store, parentId, content)` | `store.appendChildren(parentId, content)` |
| `deleteEntry(store, id)` | `store.delete(id)` |
| `setTags(store, id, tags)` | via `store.updateNode(id, ..., tags=tags)` |
| `assignBulkTags(store, entries)` | `store.assignBulkTags(entries)` |
| `stats(store)` | `store.getStats()` |
| `healthCheck(store)` | `store.healthCheck()` |
| `findRelated(store, id, limit)` | `store.findRelated(id, tags, limit)` — note: HmemStore requires tags param, caller must fetch tags first or use `store.findRelatedCombined(id, limit)` |
| `bulkReadV2(store, opts)` | `store.read({ mode: "discover", cachedIds, hiddenIds, ...opts })` |
| `readL1Headers(store, { prefix? })` | `store.read({ titlesOnly: true, prefix })` |

## Key Differences

### Constructor

Old: `const store = await Store.open(path)` (async wrapper, but internally synchronous)
New: `const store = new HmemStore(path)` (truly synchronous)

This makes `openStore()`, `openAgentStore()`, and `autoRecall()` synchronous.

### Types

All types re-exported from hmem-mcp:

```ts
export type { MemoryEntry, MemoryNode, ReadOptions, AgentRole } from "hmem-mcp"
```

Heimdall-specific types (`CompactedTopic`, `CompactionResult`) stay as local definitions in `compact.ts`.

### Session Cache

The `SessionCache` class (tracking hidden/cached IDs per store, 5min hidden / 5-30min cached) moves into `index.ts`. Each store in the `openStores` map gets a paired `SessionCache` instance:

```ts
const openStores = new Map<string, { store: HmemStore; cache: SessionCache }>()
```

`autoRecall()` passes `cachedIds` and `hiddenIds` from the cache to `store.read()`.

### BulkRead V2

Old: `bulkReadV2(store, { cachedIds, hiddenIds })` (separate function)
New: `store.read({ mode: "discover", cachedIds, hiddenIds })` (built into HmemStore.read)

## Dependency

```json
// packages/opencode/package.json → dependencies
"hmem-mcp": "^2.8.0"
```

`better-sqlite3` is a transitive dependency via hmem-mcp. No additional native addon needed.

## index.ts After Refactor (Sketch)

```ts
import path from "path"
import fs from "fs/promises"
import { HmemStore } from "hmem-mcp"
import type { MemoryEntry } from "hmem-mcp"
import { render } from "./render"
import { Agent } from "../agent/agent"
import { Global } from "../global"

// Inline SessionCache (moved from deleted session-cache.ts)
class SessionCache {
  private shown = new Map<string, number>()
  hiddenAndCachedSets(): { hiddenIds: Set<string>; cachedIds: Set<string> } {
    const now = Date.now()
    const hidden = new Set<string>()
    const cached = new Set<string>()
    for (const [id, ts] of this.shown) {
      const age = now - ts
      if (age < 5 * 60_000) hidden.add(id)
      else if (age < 30 * 60_000) cached.add(id)
    }
    return { hiddenIds: hidden, cachedIds: cached }
  }
  recordAll(ids: string[]): void {
    const now = Date.now()
    for (const id of ids) this.shown.set(id, now)
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
    // ... unchanged ...
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
      const lines = headers.map((e) => `[${e.id}] ${e.level_1}`).join("\n")
      return `<agent-memory>\n${lines}\n</agent-memory>`
    } catch {
      return ""
    }
  }

  export function closeAll(): void {
    for (const { store } of openStores.values()) {
      try { store.close() } catch { /* non-fatal */ }
    }
    openStores.clear()
  }

  export async function needsSetup(projectDir: string): Promise<boolean> { /* unchanged */ }
  export async function saveMemoryChoice(projectDir: string, choice: "local" | "global"): Promise<void> { /* unchanged */ }
}

export type { MemoryEntry, MemoryNode, ReadOptions, AgentRole } from "hmem-mcp"
```

## Caller Fix: TUI Groupchat

`cli/cmd/tui/routes/session/index.tsx` currently does:

```ts
const { Hmem } = await import("@/hmem")
const { write } = await import("@/hmem/write")  // ← BREAKS after refactor
```

Fix: replace with `store.write()` via the public API:

```ts
const { Hmem } = await import("@/hmem")
const store = await Hmem.openAgentStore(agentId)
store.write(prefix, content, undefined, undefined, undefined, tags)
```

## Testing

- Existing tests in `packages/heimdall-hmem/` serve as regression reference
- New tests verify the wrapper layer (openStore, openAgentStore, autoRecall, session cache)
- Integration test: write → read → update → delete cycle through the wrapper
- Verify sync/client.ts still works with the DB handle shim

## Future (hmem 3.0)

1. **DB adapter parameter** — `new HmemStore(path, { adapter: bunSqlite })` for bun:sqlite support
2. **Built-in renderer** — `store.render(entries)` or `HmemStore.format(entries)` to eliminate local render.ts
3. **getDb() accessor** — proper public API for raw DB access (replaces the `(store as any).db` workaround)
4. **Export/import API** — `store.exportEntries()` / `store.importEntries()` to replace raw SQL in sync client
5. **Session cache built-in** — `store.createSession()` returns a session-aware reader
