# hmem-mcp as Dependency — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ~14 duplicated hmem core files with the `hmem-mcp` npm package as a direct dependency, so updates flow automatically.

**Architecture:** Add `hmem-mcp` as a dependency. Delete duplicated core files (store, schema, read, write, modify, delete, tags, related, stats, bulk-read, parse, session-cache, types, sqlite-adapter). Rewrite `index.ts` and `tools.ts` to use `HmemStore` from hmem-mcp. Keep render.ts, compact.ts, migration.ts, setup-dialog.ts, and sync/ as local Heimdall-specific code.

**Tech Stack:** TypeScript, hmem-mcp (npm), better-sqlite3, Bun

**Spec:** `docs/superpowers/specs/2026-03-16-hmem-mcp-dependency-design.md`

---

## Chunk 1: Dependency + Index Rewrite

### Task 1: Add hmem-mcp dependency

**Files:**
- Modify: `packages/opencode/package.json`

- [ ] **Step 1: Add hmem-mcp to dependencies**

```json
// In "dependencies" section, add:
"hmem-mcp": "^2.8.0",
```

- [ ] **Step 2: Install**

Run: `cd packages/opencode && npm install hmem-mcp`
(or `bun install` if available)

- [ ] **Step 3: Verify import works**

Run: `node -e "const { HmemStore } = require('hmem-mcp'); console.log(typeof HmemStore)"`
Expected: `function`

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/package.json
git commit -m "chore(hmem): add hmem-mcp as dependency"
```

---

### Task 2: Rewrite index.ts to use HmemStore

**Files:**
- Modify: `packages/opencode/src/hmem/index.ts`

- [ ] **Step 1: Rewrite index.ts**

Replace the entire file with:

```ts
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
```

- [ ] **Step 2: Verify callers still type-check**

The public API (`Hmem.openStore`, `Hmem.autoRecall`, `Hmem.closeAll`, `Hmem.openAgentStore`, `Hmem.needsSetup`, `Hmem.saveMemoryChoice`) has the same signatures. Check `session/llm.ts` still compiles.

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/hmem/index.ts
git commit -m "feat(hmem): rewrite index.ts to use HmemStore from hmem-mcp"
```

---

## Chunk 2: Tools + Render Rewrite

### Task 3: Update render.ts imports

**Files:**
- Modify: `packages/opencode/src/hmem/render.ts`

- [ ] **Step 1: Change type imports from local types.ts to hmem-mcp**

Replace:
```ts
import { MemoryEntry, MemoryNode } from "./types"
```
With:
```ts
import type { MemoryEntry, MemoryNode } from "hmem-mcp"
```

- [ ] **Step 2: Verify render still works**

The `MemoryEntry` and `MemoryNode` types from hmem-mcp have the same fields (`id`, `level_1`, `favorite`, `pinned`, `obsolete`, `tags`, `children`). Check field names match — hmem-mcp uses `level_1` (snake_case) while local types may use `level1` (camelCase). If mismatched, update field references in render.ts.

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/hmem/render.ts
git commit -m "fix(hmem): update render.ts imports to use hmem-mcp types"
```

---

### Task 4: Rewrite tools.ts

**Files:**
- Modify: `packages/opencode/src/hmem/tools.ts`

- [ ] **Step 1: Replace all internal imports with hmem-mcp**

Old imports to remove:
```ts
import { read, readL1Headers } from "./read"
import { write } from "./write"
import { append, update } from "./modify"
import { setTags, assignBulkTags } from "./tags"
import { stats, healthCheck } from "./stats"
```

New imports:
```ts
import type { HmemStore } from "hmem-mcp"
```

- [ ] **Step 2: Rewrite each tool's execute() to call HmemStore methods**

For each of the 9 tools, replace function calls with store method calls:

| Tool | Old call | New call |
|------|----------|----------|
| hmem_search | `read(store, { search })` | `store.read({ search })` |
| hmem_read | `read(store, { id, prefix, limit })` | `store.read({ id, prefix, limit })` |
| hmem_write | `write(store, prefix, content, opts)` | `store.write(prefix, content, opts.links, opts.minRole, opts.favorite, opts.tags)` |
| hmem_append | `append(store, parentId, content)` | `store.appendChildren(parentId, content)` |
| hmem_list | `readL1Headers(store, { prefix })` | `store.read({ titlesOnly: true, prefix })` |
| hmem_tag | `setTags(store, id, tags)` | `store.updateNode(id, undefined, undefined, undefined, undefined, undefined, undefined, tags)` — or better: read entry first, then `updateNode(id, entry.level_1, ..., tags=tags)` |
| hmem_stats | `stats(store)` | `store.getStats()` |
| hmem_health | `healthCheck(store)` | `store.healthCheck()` |
| hmem_read_agent | `read(store, { id, prefix, limit })` | `store.read({ id, prefix, limit })` |

- [ ] **Step 3: Keep VALID_PREFIXES and HmemTools export**

```ts
export const VALID_PREFIXES = ["P", "L", "T", "E", "D", "M", "S", "N", "H", "R", "F"] as const

export const HmemTools = [
  HmemSearchTool, HmemReadTool, HmemWriteTool, HmemAppendTool,
  HmemListTool, HmemTagTool, HmemStatsTool, HmemHealthTool, HmemReadAgentTool,
]
```

- [ ] **Step 4: Verify registry.ts still works**

`tool/registry.ts` imports `{ HmemTools }` from `"../hmem/tools"` and spreads it. The export shape is unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/hmem/tools.ts
git commit -m "feat(hmem): rewrite tools.ts to use HmemStore methods directly"
```

---

## Chunk 3: Fix Callers + Compact

### Task 5: Fix TUI groupchat caller

**Files:**
- Modify: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

- [ ] **Step 1: Replace dynamic import of `@/hmem/write`**

Find (around line 360-362):
```ts
const { Hmem } = await import("@/hmem")
const { write } = await import("@/hmem/write")
```

Replace with:
```ts
const { Hmem } = await import("@/hmem")
```

- [ ] **Step 2: Replace write() call with store.write()**

Find (around line 368-375):
```ts
for (const id of [...participantIds, ...gc.observers]) {
  try {
    const store = await Hmem.openAgentStore(id)
    write(store, "P", formatted, { tags: ["groupchat"] })
  } catch (err) {
    console.error(`[groupchat] Failed to save hmem for ${id}:`, err)
  }
}
```

Replace with:
```ts
for (const id of [...participantIds, ...gc.observers]) {
  try {
    const store = await Hmem.openAgentStore(id)
    store.write("P", formatted, undefined, undefined, undefined, ["groupchat"])
  } catch (err) {
    console.error(`[groupchat] Failed to save hmem for ${id}:`, err)
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/routes/session/index.tsx
git commit -m "fix(groupchat): use HmemStore.write() instead of deleted write function"
```

---

### Task 6: Update compact.ts imports

**Files:**
- Modify: `packages/opencode/src/hmem/compact.ts`

- [ ] **Step 1: Replace imports**

Old:
```ts
import { CompactedTopic, CompactionResult } from "./types"
import { Store } from "./store"
import { VALID_PREFIXES } from "./types"
import { write } from "./write"
```

New:
```ts
import { HmemStore } from "hmem-mcp"
import { VALID_PREFIXES } from "./tools"
```

- [ ] **Step 2: Keep CompactedTopic and CompactionResult as local types**

These are Heimdall-specific (not in hmem-mcp). Move their definitions into compact.ts directly:

```ts
export interface CompactedTopic {
  prefix: string
  tags: string[]
  l1: string
  l2: string
  l3: string
  l4: string
  l5: string
}

export interface CompactionResult {
  summary: string
  topics: CompactedTopic[]
}
```

- [ ] **Step 3: Change writeCompactedTopics signature**

Old: `export function writeCompactedTopics(store: Store, topics: CompactedTopic[]): string[]`
New: `export function writeCompactedTopics(store: HmemStore, topics: CompactedTopic[]): string[]`

Replace `write(store, ...)` calls with `store.write(...)`:

Old:
```ts
const result = write(store, topic.prefix, content, { tags: topic.tags })
```
New:
```ts
const result = store.write(topic.prefix, content, undefined, undefined, undefined, topic.tags)
```

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/hmem/compact.ts
git commit -m "fix(hmem): update compact.ts to use HmemStore from hmem-mcp"
```

---

## Chunk 4: Delete Core Files + Sync Shim

### Task 7: Add DB handle shim for sync client

**Files:**
- Modify: `packages/opencode/src/hmem/sync/client.ts`

- [ ] **Step 1: Update Store import to HmemStore**

Old:
```ts
import { Store } from "../store"
```
New:
```ts
import { HmemStore } from "hmem-mcp"
```

- [ ] **Step 2: Add db accessor helper**

Add at the top of the file:
```ts
/** Access the underlying better-sqlite3 Database from HmemStore. */
function getDb(store: HmemStore): any {
  return (store as any).db
}
```

- [ ] **Step 3: Replace all `store.database` with `getDb(store)`**

Find and replace all occurrences:
- `store.database.prepare(` → `getDb(store).prepare(`
- `store.database.transaction(` → `getDb(store).transaction(`

- [ ] **Step 4: Update function signatures from `Store` to `HmemStore`**

All methods/functions that take `store: Store` → change to `store: HmemStore`.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/hmem/sync/client.ts
git commit -m "fix(hmem): update sync client to use HmemStore with db shim"
```

---

### Task 8: Delete the 14 core files

**Files:**
- Delete: `packages/opencode/src/hmem/store.ts`
- Delete: `packages/opencode/src/hmem/schema.ts`
- Delete: `packages/opencode/src/hmem/sqlite-adapter.ts`
- Delete: `packages/opencode/src/hmem/read.ts`
- Delete: `packages/opencode/src/hmem/write.ts`
- Delete: `packages/opencode/src/hmem/modify.ts`
- Delete: `packages/opencode/src/hmem/delete.ts`
- Delete: `packages/opencode/src/hmem/tags.ts`
- Delete: `packages/opencode/src/hmem/related.ts`
- Delete: `packages/opencode/src/hmem/stats.ts`
- Delete: `packages/opencode/src/hmem/bulk-read.ts`
- Delete: `packages/opencode/src/hmem/parse.ts`
- Delete: `packages/opencode/src/hmem/session-cache.ts`
- Delete: `packages/opencode/src/hmem/types.ts`

- [ ] **Step 1: Delete all 14 files**

```bash
cd packages/opencode/src/hmem
rm store.ts schema.ts sqlite-adapter.ts read.ts write.ts modify.ts delete.ts tags.ts related.ts stats.ts bulk-read.ts parse.ts session-cache.ts types.ts
```

- [ ] **Step 2: Verify no broken imports**

```bash
grep -r "from.*\./store\|from.*\./schema\|from.*\./sqlite-adapter\|from.*\./read\|from.*\./write\|from.*\./modify\|from.*\./delete\|from.*\./tags\|from.*\./related\|from.*\./stats\|from.*\./bulk-read\|from.*\./parse\|from.*\./session-cache\|from.*\./types" packages/opencode/src/hmem/
```

Expected: No output (all imports have been updated in previous tasks). If any remain, fix them.

- [ ] **Step 3: Commit**

```bash
git add -u packages/opencode/src/hmem/
git commit -m "chore(hmem): delete 14 duplicated core files, replaced by hmem-mcp dependency"
```

---

## Chunk 5: Verify + Update Sync Config Files

### Task 9: Update remaining sync/ imports

**Files:**
- Check: `packages/opencode/src/hmem/sync/config.ts`
- Check: `packages/opencode/src/hmem/sync/crypto.ts`
- Check: `packages/opencode/src/hmem/sync/transport.ts`
- Check: `packages/opencode/src/hmem/sync/setup.ts`

- [ ] **Step 1: Check each sync file for imports from deleted modules**

```bash
grep -r "from.*\.\.\/" packages/opencode/src/hmem/sync/
```

Any import from `"../store"`, `"../types"`, `"../schema"` etc. must be updated to use hmem-mcp or removed.

- [ ] **Step 2: Fix any broken imports**

Common fixes:
- `import { Store } from "../store"` → `import { HmemStore } from "hmem-mcp"`
- `import type { MemoryEntry } from "../types"` → `import type { MemoryEntry } from "hmem-mcp"`

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/hmem/sync/
git commit -m "fix(hmem): update sync module imports for hmem-mcp"
```

---

### Task 10: Smoke test

- [ ] **Step 1: Type check**

```bash
cd packages/opencode && bun typecheck
```

Expected: No errors in hmem/ files.

- [ ] **Step 2: Run tests**

```bash
cd packages/opencode && bun test --timeout 30000
```

Expected: All existing tests pass. hmem tools work with HmemStore.

- [ ] **Step 3: Manual smoke test**

```bash
bun dev .
```

Start a chat, verify hmem tools work:
- `/hmem stats` should return store statistics
- Writing a memory and reading it back should work

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A packages/opencode/src/hmem/
git commit -m "fix(hmem): smoke test fixes for hmem-mcp migration"
```
