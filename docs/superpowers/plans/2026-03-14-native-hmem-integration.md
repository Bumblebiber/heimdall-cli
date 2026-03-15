# Native hmem Integration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate hmem and hmem-sync natively into the Heimdall CLI binary — zero-config memory for every user, per-agent isolation, built-in encrypted sync.

**Architecture:** Port heimdall-hmem plugin code and hmem-sync client into `packages/opencode/src/hmem/` as a built-in module. Register tools directly in `tool/registry.ts`. Inject memories directly in `session/llm.ts`. Route tool calls to per-agent stores via agent mode detection. Add first-chat dialog for local/global memory choice.

**Tech Stack:** TypeScript, Bun (bun:sqlite), AES-256-GCM + scrypt, HTTP REST

**Spec:** `docs/superpowers/specs/2026-03-14-native-hmem-integration-design.md`

**Repos:**
- **Fork** (primary): `C:/Users/benni/dev/heimdall-opencode/` (branch: `heimdall/branding`)
- **Plugin** (source): `P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/packages/heimdall-hmem/src/`
- **hmem-sync** (source): `C:/Users/benni/AppData/Roaming/npm/node_modules/hmem-sync/dist/`

---

## File Structure

### Files to Create (in `packages/opencode/src/hmem/`)

| File | Responsibility |
|------|---------------|
| `sqlite-adapter.ts` | Runtime detection: `bun:sqlite` (Bun) or `better-sqlite3` (Node.js) |
| `types.ts` | All types: MemoryEntry, MemoryNode, ReadOptions, WriteOptions, etc. |
| `schema.ts` | DDL + migrations |
| `store.ts` | Store class: open/close, WAL, schema init |
| `parse.ts` | Tab-indented content → node tree |
| `read.ts` | read, readL1Headers, loadChildren, loadChildrenToDepth |
| `write.ts` | write with ID generation |
| `modify.ts` | update, append |
| `delete.ts` | deleteEntry |
| `tags.ts` | setTags, fetchTags |
| `related.ts` | findRelated |
| `stats.ts` | stats, healthCheck |
| `bulk-read.ts` | BulkRead V2 with session-recency boost |
| `render.ts` | Format entries for system prompt |
| `compact.ts` | parseCompactionResponse, topicToContent |
| `session-cache.ts` | SessionCache for BulkRead optimization |
| `index.ts` | Public API: openStore, autoRecall, StoreManager |
| `tools.ts` | Tool definitions (hmem_search, hmem_read, etc.) |
| `sync/crypto.ts` | AES-256-GCM, scrypt, recovery key |
| `sync/client.ts` | Sync logic: payload building, merge, state |
| `sync/transport.ts` | HTTP layer: push/pull requests, batching |
| `sync/setup.ts` | Registration, restore, passphrase prompting |
| `sync/config.ts` | Sync config read/write |

### Files to Modify (in `packages/opencode/src/`)

| File | Change |
|------|--------|
| `tool/registry.ts` | Import + register HmemTools in `all()` |
| `session/llm.ts` | Direct memory injection before Plugin.trigger |
| `session/compaction.ts` | No change needed (already resolves from ToolRegistry) |
| `agent/agent.ts` | Add `hmem_read_agent` to primary agent permissions |
| `global/index.ts` | Add `agents` and `sync` subdirectory paths |

### Files to Create (tests)

| File | What it tests |
|------|--------------|
| `test/hmem/store.test.ts` | Open/close, schema init, WAL mode |
| `test/hmem/read-write.test.ts` | Write + read, FTS search, L1 headers |
| `test/hmem/bulk-read.test.ts` | V2 selection, recency boost |
| `test/hmem/tools.test.ts` | Tool execution, store routing |
| `test/hmem/sync.test.ts` | Encrypt/decrypt round-trip, payload building |

---

## Chunk 1: Core hmem Module

### Task 1: SQLite Adapter + Types

**Files:**
- Create: `packages/opencode/src/hmem/sqlite-adapter.ts`
- Create: `packages/opencode/src/hmem/types.ts`

- [ ] **Step 1: Create sqlite-adapter.ts**

Copy from `P:/.../packages/heimdall-hmem/src/sqlite-adapter.ts` — this file handles runtime detection of Bun vs Node.js:

```typescript
// packages/opencode/src/hmem/sqlite-adapter.ts
let DatabaseConstructor: any

const isBun = typeof globalThis["Bun"] !== "undefined"

if (isBun) {
  const mod = await import("bun:sqlite")
  const BunDatabase = mod.Database

  DatabaseConstructor = class BunDatabaseCompat extends BunDatabase {
    pragma(str: string): unknown {
      const [key, val] = str.split("=").map((s: string) => s.trim())
      if (val !== undefined) {
        this.exec(`PRAGMA ${key} = ${val}`)
        return val
      }
      return this.prepare(`PRAGMA ${key}`).get()
    }
  }
} else {
  const mod = await import("better-sqlite3")
  DatabaseConstructor = mod.default
}

export default DatabaseConstructor as {
  new (path: string): import("better-sqlite3").Database
}
```

- [ ] **Step 2: Create types.ts**

Copy from `P:/.../packages/heimdall-hmem/src/types.ts`. This file has all type definitions: `MemoryEntry`, `MemoryNode`, `ReadOptions`, `WriteOptions`, `AgentRole`, `VALID_PREFIXES`, `CHAR_LIMITS`, etc.

Update the import path: the file is self-contained (no imports needed).

- [ ] **Step 3: Commit**

```bash
cd C:/Users/benni/dev/heimdall-opencode
git add packages/opencode/src/hmem/sqlite-adapter.ts packages/opencode/src/hmem/types.ts
git commit -m "feat(hmem): add sqlite adapter and type definitions"
```

---

### Task 2: Schema + Store

**Files:**
- Create: `packages/opencode/src/hmem/schema.ts`
- Create: `packages/opencode/src/hmem/store.ts`
- Create: `packages/opencode/src/hmem/session-cache.ts`
- Test: `packages/opencode/test/hmem/store.test.ts`

- [ ] **Step 1: Create schema.ts**

Copy from `P:/.../packages/heimdall-hmem/src/schema.ts`. Update import:
```typescript
// Change: import Database from "./sqlite-adapter.js"
// To:     import Database from "./sqlite-adapter"
```

Remove all `.js` extensions from imports (the fork uses Bun, not Node ESM).

- [ ] **Step 2: Create session-cache.ts**

Copy from `P:/.../packages/heimdall-hmem/src/session-cache.ts`. Remove `.js` import extensions.

- [ ] **Step 3: Create store.ts**

Copy from `P:/.../packages/heimdall-hmem/src/store.ts`. Remove `.js` import extensions. The Store class has `open(path)`, `close()`, `database` getter, and `cache` property.

- [ ] **Step 4: Write test for Store**

```typescript
// packages/opencode/test/hmem/store.test.ts
import { describe, test, expect, afterEach } from "bun:test"
import { Store } from "../../src/hmem/store"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("hmem store", () => {
  let tmpDir: string
  let store: Store

  afterEach(() => {
    store?.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("opens and initializes schema", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "hmem-test-"))
    store = await Store.open(join(tmpDir, "test.hmem"))
    const tables = store.database
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as any[]
    const names = tables.map((t: any) => t.name)
    expect(names).toContain("memories")
    expect(names).toContain("memory_nodes")
    expect(names).toContain("memory_tags")
  })

  test("uses WAL journal mode", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "hmem-test-"))
    store = await Store.open(join(tmpDir, "test.hmem"))
    const result = store.database.pragma("journal_mode") as any
    expect(result?.journal_mode ?? result).toBe("wal")
  })
})
```

- [ ] **Step 5: Run test**

```bash
cd C:/Users/benni/dev/heimdall-opencode/packages/opencode
bun test test/hmem/store.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/hmem/schema.ts packages/opencode/src/hmem/store.ts packages/opencode/src/hmem/session-cache.ts packages/opencode/test/hmem/store.test.ts
git commit -m "feat(hmem): add schema, store, and session cache"
```

---

### Task 3: Parse + Read + Write

**Files:**
- Create: `packages/opencode/src/hmem/parse.ts`
- Create: `packages/opencode/src/hmem/read.ts`
- Create: `packages/opencode/src/hmem/write.ts`
- Test: `packages/opencode/test/hmem/read-write.test.ts`

- [ ] **Step 1: Copy parse.ts, read.ts, write.ts**

Copy all three from `P:/.../packages/heimdall-hmem/src/`. Remove `.js` import extensions throughout.

- [ ] **Step 2: Write read/write tests**

```typescript
// packages/opencode/test/hmem/read-write.test.ts
import { describe, test, expect, afterEach } from "bun:test"
import { Store } from "../../src/hmem/store"
import { read, readL1Headers } from "../../src/hmem/read"
import { write } from "../../src/hmem/write"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("hmem read/write", () => {
  let tmpDir: string
  let store: Store

  afterEach(() => {
    store?.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function freshStore() {
    tmpDir = mkdtempSync(join(tmpdir(), "hmem-test-"))
    return Store.open(join(tmpDir, "test.hmem"))
  }

  test("write and read by ID", async () => {
    store = await freshStore()
    const result = write(store, "P", "Test project memory")
    expect(result.id).toBe("P0001")

    const entries = read(store, { id: "P0001" })
    expect(entries).toHaveLength(1)
    expect(entries[0].prefix).toBe("P")
  })

  test("write increments sequence", async () => {
    store = await freshStore()
    const r1 = write(store, "L", "First")
    const r2 = write(store, "L", "Second")
    expect(r1.id).toBe("L0001")
    expect(r2.id).toBe("L0002")
  })

  test("FTS search finds entries", async () => {
    store = await freshStore()
    write(store, "L", "OAuth token rotation fix")
    write(store, "P", "Database migration script")

    const results = read(store, { search: "OAuth" })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe("L0001")
  })

  test("readL1Headers returns titles only", async () => {
    store = await freshStore()
    write(store, "P", "Project A")
    write(store, "L", "Lesson B")
    write(store, "P", "Project C")

    const headers = readL1Headers(store, { prefix: "P" })
    expect(headers).toHaveLength(2)
    expect(headers[0].children).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd C:/Users/benni/dev/heimdall-opencode/packages/opencode
bun test test/hmem/read-write.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/hmem/parse.ts packages/opencode/src/hmem/read.ts packages/opencode/src/hmem/write.ts packages/opencode/test/hmem/read-write.test.ts
git commit -m "feat(hmem): add parse, read, and write modules"
```

---

### Task 4: Remaining Core Modules

**Files:**
- Create: `packages/opencode/src/hmem/modify.ts`
- Create: `packages/opencode/src/hmem/delete.ts`
- Create: `packages/opencode/src/hmem/tags.ts`
- Create: `packages/opencode/src/hmem/related.ts`
- Create: `packages/opencode/src/hmem/stats.ts`
- Create: `packages/opencode/src/hmem/bulk-read.ts`
- Create: `packages/opencode/src/hmem/render.ts`
- Create: `packages/opencode/src/hmem/compact.ts`

- [ ] **Step 1: Copy all remaining modules**

Copy from `P:/.../packages/heimdall-hmem/src/`:
- `modify.ts`, `delete.ts`, `tags.ts`, `related.ts`, `stats.ts`
- `bulk-read.ts`, `render.ts`, `compact.ts`

Remove `.js` import extensions throughout all files.

- [ ] **Step 2: Write BulkRead test**

```typescript
// packages/opencode/test/hmem/bulk-read.test.ts
import { describe, test, expect, afterEach } from "bun:test"
import { Store } from "../../src/hmem/store"
import { write } from "../../src/hmem/write"
import { bulkReadV2 } from "../../src/hmem/bulk-read"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("hmem bulk-read", () => {
  let tmpDir: string
  let store: Store

  afterEach(() => {
    store?.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("returns entries with L2 children loaded", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "hmem-test-"))
    store = await Store.open(join(tmpDir, "test.hmem"))
    write(store, "P", "Title\n\tDetail line")

    const entries = bulkReadV2(store, {})
    expect(entries.length).toBeGreaterThan(0)
    expect(entries[0].children.length).toBeGreaterThan(0)
  })

  test("empty store returns empty array", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "hmem-test-"))
    store = await Store.open(join(tmpDir, "test.hmem"))

    const entries = bulkReadV2(store, {})
    expect(entries).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd C:/Users/benni/dev/heimdall-opencode/packages/opencode
bun test test/hmem/bulk-read.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/hmem/modify.ts packages/opencode/src/hmem/delete.ts packages/opencode/src/hmem/tags.ts packages/opencode/src/hmem/related.ts packages/opencode/src/hmem/stats.ts packages/opencode/src/hmem/bulk-read.ts packages/opencode/src/hmem/render.ts packages/opencode/src/hmem/compact.ts packages/opencode/test/hmem/bulk-read.test.ts
git commit -m "feat(hmem): add modify, delete, tags, related, stats, bulk-read, render, compact"
```

---

## Chunk 2: Store Manager + Tool Registration

### Task 5: StoreManager and Index

**Files:**
- Create: `packages/opencode/src/hmem/index.ts`
- Modify: `packages/opencode/src/global/index.ts`

The `index.ts` is the public API. It manages per-agent stores and provides `autoRecall()`.

- [ ] **Step 1: Add agent paths to global/index.ts**

In `C:/Users/benni/dev/heimdall-opencode/packages/opencode/src/global/index.ts`, add after the existing `Path` properties (around line 24):

```typescript
// Add these to the Path object:
agents: path.join(data, "agents"),
sync: path.join(data, "sync"),
```

- [ ] **Step 2: Create hmem/index.ts**

```typescript
// packages/opencode/src/hmem/index.ts
import { Store } from "./store"
import { bulkReadV2 } from "./bulk-read"
import { readL1Headers } from "./read"
import { render } from "./render"
import { Global } from "../global"
import { Agent } from "../agent/agent"
import path from "path"
import fs from "fs"

const stores = new Map<string, Store>()

function agentStorePath(agentId: string): string {
  return path.join(Global.Path.agents, agentId.toUpperCase() + ".hmem")
}

function heimdallStorePath(projectDir?: string): string {
  if (projectDir) {
    const configPath = path.join(projectDir, ".heimdall", "config.json")
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
      if (config.memory === "local") {
        return path.join(projectDir, ".heimdall", "memory.hmem")
      }
    } catch {
      // No config or invalid — fall through to global
    }
    // Check if local hmem already exists (implicit local)
    const localPath = path.join(projectDir, ".heimdall", "memory.hmem")
    if (fs.existsSync(localPath)) return localPath
  }
  return path.join(Global.Path.data, "memory.hmem")
}

export namespace Hmem {
  export async function openStore(agentName: string, projectDir?: string): Promise<Store> {
    const key = agentName.toUpperCase()
    const existing = stores.get(key)
    if (existing) return existing

    const agent = await Agent.get(agentName)
    const isPrimary = agent?.mode === "primary"
    const storePath = isPrimary
      ? heimdallStorePath(projectDir)
      : agentStorePath(agentName)

    const store = await Store.open(storePath)
    stores.set(key, store)
    return store
  }

  export async function openAgentStore(agentId: string): Promise<Store> {
    const key = agentId.toUpperCase()
    const existing = stores.get(key)
    if (existing) return existing

    const store = await Store.open(agentStorePath(agentId))
    stores.set(key, store)
    return store
  }

  export async function autoRecall(agentName: string, projectDir?: string): Promise<string | null> {
    try {
      const agent = await Agent.get(agentName)
      const isPrimary = agent?.mode === "primary"
      const store = await openStore(agentName, projectDir)

      if (isPrimary) {
        // Heimdall: full BulkRead V2
        const memories = bulkReadV2(store, {})
        if (memories.length === 0) return null
        return (
          "# Long-term Memory (hmem)\n\n" +
          "The following are your persistent memories from previous sessions:\n\n" +
          render(memories)
        )
      } else {
        // Sub-agent: last 50 L1 titles
        const headers = readL1Headers(store, {})
        if (headers.length === 0) return null
        const lines = headers.slice(0, 50).map((e) => `- [${e.id}] ${e.title || e.level1}`)
        return "## Your Memory (from previous sessions)\n\n" + lines.join("\n")
      }
    } catch (err) {
      console.error(`[hmem] autoRecall failed for ${agentName}:`, err)
      return null
    }
  }

  export function closeAll(): void {
    for (const store of stores.values()) {
      try { store.close() } catch {}
    }
    stores.clear()
  }

  export function needsSetup(projectDir: string): boolean {
    const configPath = path.join(projectDir, ".heimdall", "config.json")
    const localPath = path.join(projectDir, ".heimdall", "memory.hmem")
    return !fs.existsSync(configPath) && !fs.existsSync(localPath)
  }

  export function saveMemoryChoice(projectDir: string, choice: "local" | "global"): void {
    const dir = path.join(projectDir, ".heimdall")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ memory: choice }, null, 2),
    )
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/hmem/index.ts packages/opencode/src/global/index.ts
git commit -m "feat(hmem): add StoreManager with per-agent routing and autoRecall"
```

---

### Task 6: Tool Definitions + Registration

**Files:**
- Create: `packages/opencode/src/hmem/tools.ts`
- Modify: `packages/opencode/src/tool/registry.ts`
- Modify: `packages/opencode/src/agent/agent.ts`
- Test: `packages/opencode/test/hmem/tools.test.ts`

- [ ] **Step 1: Create hmem/tools.ts**

This file defines hmem tools using the `Tool.Info` interface pattern (not the plugin tool pattern). Each tool resolves the correct store from the agent context.

```typescript
// packages/opencode/src/hmem/tools.ts
import { z } from "zod"
import { Tool } from "../tool/tool"
import { Hmem } from "./index"
import { read, readL1Headers } from "./read"
import { write } from "./write"
import { update, append } from "./modify"
import { setTags, fetchTags } from "./tags"
import { findRelated } from "./related"
import { stats, healthCheck } from "./stats"
import { render } from "./render"
import { Agent } from "../agent/agent"
import { Instance } from "../project/instance"

async function resolveStore(agentName: string) {
  const agent = await Agent.get(agentName)
  const isPrimary = agent?.mode === "primary"
  return Hmem.openStore(agentName, isPrimary ? Instance.directory : undefined)
}

export const HmemSearchTool: Tool.Info = {
  id: "hmem_search",
  init: async () => ({
    description: "Search hierarchical long-term memory (hmem). Returns matching entries by keyword.",
    parameters: z.object({
      query: z.string().describe("Search query (keywords or FTS syntax)"),
      limit: z.number().optional().describe("Max results (default 20)"),
    }),
    async execute(args, ctx) {
      const store = await resolveStore(ctx.agent)
      const entries = read(store, { search: args.query, limit: args.limit ?? 20 })
      return {
        title: `hmem search: ${args.query}`,
        output: entries.length === 0 ? "No matching memories found." : render(entries),
        metadata: {},
      }
    },
  }),
}

export const HmemReadTool: Tool.Info = {
  id: "hmem_read",
  init: async () => ({
    description: "Read a specific memory entry by ID (e.g., P0042, L0001.2)",
    parameters: z.object({
      id: z.string().describe("Memory ID like P0042 or node ID like L0001.2"),
    }),
    async execute(args, ctx) {
      const store = await resolveStore(ctx.agent)
      const entries = read(store, { id: args.id })
      return {
        title: `hmem read: ${args.id}`,
        output: entries.length === 0 ? `Memory ${args.id} not found.` : render(entries),
        metadata: {},
      }
    },
  }),
}

export const HmemWriteTool: Tool.Info = {
  id: "hmem_write",
  init: async () => ({
    description: "Write a new memory entry. Uses tab-indented hierarchical format.",
    parameters: z.object({
      prefix: z.string().describe("Category prefix: P(project), L(learning), T(task), E(event), D(decision), M(meeting), S(snippet), N(note), H(human), R(reference), F(feedback)"),
      content: z.string().describe("Tab-indented hierarchical content. L1=title, \\tL2=details, \\t\\tL3=deep details"),
      tags: z.array(z.string()).optional().describe("Tags like #typescript, #project-x"),
    }),
    async execute(args, ctx) {
      const store = await resolveStore(ctx.agent)
      const result = write(store, args.prefix, args.content, { tags: args.tags })
      return {
        title: `hmem write: ${result.id}`,
        output: `Written: ${result.id} at ${result.timestamp}`,
        metadata: {},
      }
    },
  }),
}

export const HmemAppendTool: Tool.Info = {
  id: "hmem_append",
  init: async () => ({
    description: "Append children to an existing memory entry",
    parameters: z.object({
      parentId: z.string().describe("Parent memory ID (e.g., L0001 or L0001.2)"),
      content: z.string().describe("Tab-indented content to append as children"),
    }),
    async execute(args, ctx) {
      const store = await resolveStore(ctx.agent)
      const result = append(store, args.parentId, args.content)
      return {
        title: `hmem append: ${args.parentId}`,
        output: `Appended ${result.count} nodes: ${result.ids.join(", ")}`,
        metadata: {},
      }
    },
  }),
}

export const HmemListTool: Tool.Info = {
  id: "hmem_list",
  init: async () => ({
    description: "List all L1 memory entries (titles only, no children). Use to see existing memory before writing new entries.",
    parameters: z.object({
      prefix: z.string().optional().describe("Filter by prefix (P, L, E, D, T, M, etc.)"),
    }),
    async execute(args, ctx) {
      const store = await resolveStore(ctx.agent)
      const entries = readL1Headers(store, { prefix: args.prefix })
      return {
        title: "hmem list",
        output: entries.length === 0 ? "No memories found." : render(entries),
        metadata: {},
      }
    },
  }),
}

export const HmemTagTool: Tool.Info = {
  id: "hmem_tag",
  init: async () => ({
    description: "Set tags on a memory entry (replaces existing tags)",
    parameters: z.object({
      id: z.string().describe("Memory ID to tag"),
      tags: z.array(z.string()).describe("Tags like #typescript, #project-x"),
    }),
    async execute(args, ctx) {
      const store = await resolveStore(ctx.agent)
      setTags(store, args.id, args.tags)
      const current = fetchTags(store, args.id)
      return {
        title: `hmem tag: ${args.id}`,
        output: `Tags on ${args.id}: ${current.join(", ") || "(none)"}`,
        metadata: {},
      }
    },
  }),
}

export const HmemStatsTool: Tool.Info = {
  id: "hmem_stats",
  init: async () => ({
    description: "Show memory statistics (counts by prefix, total chars)",
    parameters: z.object({}),
    async execute(_args, ctx) {
      const store = await resolveStore(ctx.agent)
      const s = stats(store)
      let out = `Total: ${s.total} entries, ${s.totalChars} chars\n\nBy prefix:\n`
      for (const [prefix, count] of Object.entries(s.byPrefix)) {
        out += `  ${prefix}: ${count}\n`
      }
      return { title: "hmem stats", output: out, metadata: {} }
    },
  }),
}

export const HmemHealthTool: Tool.Info = {
  id: "hmem_health",
  init: async () => ({
    description: "Run health check on memory database",
    parameters: z.object({}),
    async execute(_args, ctx) {
      const store = await resolveStore(ctx.agent)
      const h = healthCheck(store)
      const issues: string[] = []
      if (h.brokenLinks.length > 0) issues.push(`Broken links: ${h.brokenLinks.join(", ")}`)
      if (h.orphanedEntries.length > 0) issues.push(`Orphaned entries: ${h.orphanedEntries.join(", ")}`)
      if (h.staleFavorites.length > 0) issues.push(`Stale favorites: ${h.staleFavorites.join(", ")}`)
      if (h.tagOrphans > 0) issues.push(`Tag orphans: ${h.tagOrphans}`)
      return {
        title: "hmem health",
        output: issues.length === 0 ? "Memory database is healthy." : issues.join("\n"),
        metadata: {},
      }
    },
  }),
}

export const HmemReadAgentTool: Tool.Info = {
  id: "hmem_read_agent",
  init: async () => ({
    description: "Read another agent's memory (read-only). Only available to the primary agent.",
    parameters: z.object({
      agent: z.string().describe("Agent ID (e.g., THOR, LOKI)"),
      id: z.string().optional().describe("Specific memory ID"),
      search: z.string().optional().describe("FTS search query"),
    }),
    async execute(args, ctx) {
      const store = await Hmem.openAgentStore(args.agent)
      if (args.id) {
        const entries = read(store, { id: args.id })
        return {
          title: `hmem read ${args.agent}: ${args.id}`,
          output: entries.length === 0 ? `Memory ${args.id} not found in ${args.agent}'s store.` : render(entries),
          metadata: {},
        }
      }
      if (args.search) {
        const entries = read(store, { search: args.search })
        return {
          title: `hmem search ${args.agent}: ${args.search}`,
          output: entries.length === 0 ? `No matching memories in ${args.agent}'s store.` : render(entries),
          metadata: {},
        }
      }
      const headers = readL1Headers(store, {})
      return {
        title: `hmem list ${args.agent}`,
        output: headers.length === 0 ? `${args.agent} has no memories yet.` : render(headers),
        metadata: {},
      }
    },
  }),
}

export const HmemTools = [
  HmemSearchTool,
  HmemReadTool,
  HmemWriteTool,
  HmemAppendTool,
  HmemListTool,
  HmemTagTool,
  HmemStatsTool,
  HmemHealthTool,
  HmemReadAgentTool,
]
```

- [ ] **Step 2: Register in tool/registry.ts**

In `C:/Users/benni/dev/heimdall-opencode/packages/opencode/src/tool/registry.ts`:

Add import at the top (after existing tool imports, around line 18):
```typescript
import { HmemTools } from "../hmem/tools"
```

In the `all()` function (around line 125), add before `...custom`:
```typescript
    ...HmemTools,
    ...custom,
```

- [ ] **Step 3: Add hmem_read_agent permission to primary agent**

In `C:/Users/benni/dev/heimdall-opencode/packages/opencode/src/agent/agent.ts`, find the `build` agent definition (line 79). Add `hmem_read_agent: "allow"` to its permission merge:

```typescript
build: {
  name: "build",
  // ... existing fields ...
  permission: PermissionNext.merge(
    defaults,
    PermissionNext.fromConfig({
      question: "allow",
      plan_enter: "allow",
      hmem_read_agent: "allow",
    }),
    user,
  ),
  // ...
},
```

Also deny `hmem_read_agent` in the `hmem-compaction` agent (line 174-194) by adding to its deny list. The existing permission structure already denies `"*"` for tools not explicitly allowed, so no change needed there.

- [ ] **Step 4: Write tool test**

```typescript
// packages/opencode/test/hmem/tools.test.ts
import { describe, test, expect, afterEach } from "bun:test"
import { Store } from "../../src/hmem/store"
import { write } from "../../src/hmem/write"
import { read } from "../../src/hmem/read"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("hmem tools", () => {
  let tmpDir: string
  let store: Store

  afterEach(() => {
    store?.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("write then read round-trip", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "hmem-test-"))
    store = await Store.open(join(tmpDir, "test.hmem"))
    const result = write(store, "L", "Test lesson\n\tDetail about test")
    expect(result.id).toBe("L0001")

    const entries = read(store, { id: "L0001" })
    expect(entries).toHaveLength(1)
    expect(entries[0].children.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 5: Run tests**

```bash
cd C:/Users/benni/dev/heimdall-opencode/packages/opencode
bun test test/hmem/tools.test.ts
```

Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/hmem/tools.ts packages/opencode/src/tool/registry.ts packages/opencode/src/agent/agent.ts packages/opencode/test/hmem/tools.test.ts
git commit -m "feat(hmem): register built-in hmem tools in ToolRegistry"
```

---

## Chunk 3: System Prompt Injection + First-Chat Dialog

### Task 7: Direct Memory Injection in session/llm.ts

**Files:**
- Modify: `packages/opencode/src/session/llm.ts`

- [ ] **Step 1: Add import**

At the top of `session/llm.ts`, add:
```typescript
import { Hmem } from "../hmem"
```

- [ ] **Step 2: Inject memory before Plugin.trigger**

In `session/llm.ts`, find the system array construction (around line 80). After the `system.push(...)` block and BEFORE the `Plugin.trigger("experimental.chat.system.transform", ...)` call (line 83), insert:

```typescript
// Inject hmem memories directly (no plugin hook)
const hmemContext = await Hmem.autoRecall(input.agent.name, input.user.path?.cwd)
if (hmemContext) system.push(hmemContext)
```

This must go BEFORE line 83 (`await Plugin.trigger(...)`) so that the memory is in the system array before plugins process it.

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/session/llm.ts
git commit -m "feat(hmem): inject memories directly in session/llm.ts"
```

---

### Task 8: First-Chat Memory Setup Dialog

**Files:**
- Create: `packages/opencode/src/hmem/setup-dialog.ts`
- Modify: TUI session initialization (the exact integration point depends on the TUI framework — hook into session creation)

This task is more exploratory since the TUI uses Solid.js components. The dialog should be triggered when `Hmem.needsSetup(projectDir)` returns true.

- [ ] **Step 1: Create setup-dialog.ts**

```typescript
// packages/opencode/src/hmem/setup-dialog.ts
import { Hmem } from "./index"
import fs from "fs"
import path from "path"

export interface MemorySetupResult {
  choice: "local" | "global"
}

/**
 * Check if memory setup is needed and return the choice if already configured.
 * Returns null if setup dialog should be shown.
 */
export function checkMemorySetup(projectDir: string): "local" | "global" | null {
  const configPath = path.join(projectDir, ".heimdall", "config.json")
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    if (config.memory === "local" || config.memory === "global") {
      return config.memory
    }
  } catch {}

  // Implicit local if hmem exists
  const localPath = path.join(projectDir, ".heimdall", "memory.hmem")
  if (fs.existsSync(localPath)) return "local"

  return null // needs setup
}

/**
 * Save the user's memory choice.
 */
export function saveMemorySetup(projectDir: string, choice: "local" | "global"): void {
  Hmem.saveMemoryChoice(projectDir, choice)
}
```

- [ ] **Step 2: Integration note**

The TUI dialog component itself needs to be created as a Solid.js component in `packages/opencode/src/cli/cmd/tui/`. This is TUI-framework-specific work. The dialog should:
1. Check `checkMemorySetup(Instance.directory)` on session start
2. If `null`, render a radio-button dialog with "Global" / "Local" options
3. On selection, call `saveMemorySetup(Instance.directory, choice)`
4. Proceed with session

The exact Solid.js component implementation is deferred to the implementer, who should follow existing dialog patterns in `packages/opencode/src/cli/cmd/tui/routes/` (e.g., the permission dialog or settings dialog).

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/hmem/setup-dialog.ts
git commit -m "feat(hmem): add memory setup check and save logic"
```

---

## Chunk 4: hmem-sync Client

### Task 9: Sync Crypto Module

**Files:**
- Create: `packages/opencode/src/hmem/sync/crypto.ts`
- Test: `packages/opencode/test/hmem/sync.test.ts`

- [ ] **Step 1: Create sync/crypto.ts**

Port from `hmem-sync/dist/crypto.js`. Convert to TypeScript with proper types:

```typescript
// packages/opencode/src/hmem/sync/crypto.ts
import { scryptSync, randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const KEY_LEN = 32
const IV_LEN = 12
const TAG_LEN = 16
const SALT_LEN = 32
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const RECOVERY_KEY_BYTES = 16

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

export function deriveKey(passphrase: string, saltBase64: string): Buffer {
  const salt = Buffer.from(saltBase64, "base64")
  return scryptSync(passphrase, salt, KEY_LEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  })
}

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, encrypted, tag]).toString("base64")
}

export function decrypt(blobBase64: string, key: Buffer): string {
  const buf = Buffer.from(blobBase64, "base64")
  if (buf.length < IV_LEN + TAG_LEN) throw new Error("Invalid encrypted blob — too short.")
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(buf.length - TAG_LEN)
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}

export function encryptEntry(entryId: string, payload: any, key: Buffer, updatedAt: string) {
  return { data: encrypt(JSON.stringify(payload), key), updated_at: updatedAt }
}

export function decryptEntry(blob: { data: string }, key: Buffer): any {
  return JSON.parse(decrypt(blob.data, key))
}

export function hashId(entryId: string, dbName: string, salt: string): string {
  return createHash("sha256").update(`${dbName}:${entryId}${salt}`).digest("hex").substring(0, 32)
}

export function generateKeyMaterial(): { salt: string; recoveryKey: string } {
  const salt = randomBytes(SALT_LEN).toString("base64")
  const recoveryKey = generateRecoveryKey()
  return { salt, recoveryKey }
}

function generateRecoveryKey(): string {
  const bytes = randomBytes(RECOVERY_KEY_BYTES)
  const encoded = base58Encode(bytes)
  const grouped = encoded.match(/.{1,5}/g) ?? [encoded]
  return grouped.join("-")
}

function base58Encode(buf: Buffer): string {
  let num = BigInt("0x" + buf.toString("hex"))
  let result = ""
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)] + result
    num = num / 58n
  }
  return result || "1"
}

export function base58Decode(str: string): Buffer {
  str = str.replace(/-/g, "")
  let num = BigInt(0)
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char)
    if (idx < 0) throw new Error(`Invalid Base58 character: ${char}`)
    num = num * BigInt(58) + BigInt(idx)
  }
  const hex = num.toString(16).padStart(RECOVERY_KEY_BYTES * 2, "0")
  return Buffer.from(hex, "hex")
}
```

- [ ] **Step 2: Write crypto test**

```typescript
// packages/opencode/test/hmem/sync.test.ts
import { describe, test, expect } from "bun:test"
import { deriveKey, encrypt, decrypt, encryptEntry, decryptEntry, hashId, generateKeyMaterial } from "../../src/hmem/sync/crypto"

describe("hmem sync crypto", () => {
  const { salt } = generateKeyMaterial()
  const key = deriveKey("test-passphrase", salt)

  test("encrypt/decrypt round-trip", () => {
    const plaintext = "Hello, encrypted world!"
    const blob = encrypt(plaintext, key)
    const result = decrypt(blob, key)
    expect(result).toBe(plaintext)
  })

  test("encryptEntry/decryptEntry round-trip", () => {
    const entry = { id: "P0001", prefix: "P", level_1: "Test entry" }
    const blob = encryptEntry("P0001", entry, key, "2026-03-14T10:00:00Z")
    const result = decryptEntry(blob, key)
    expect(result.id).toBe("P0001")
    expect(result.level_1).toBe("Test entry")
  })

  test("hashId includes db name for namespacing", () => {
    const hash1 = hashId("P0001", "heimdall", salt)
    const hash2 = hashId("P0001", "THOR", salt)
    expect(hash1).not.toBe(hash2)
    expect(hash1).toHaveLength(32)
  })

  test("wrong key fails to decrypt", () => {
    const blob = encrypt("secret", key)
    const wrongKey = deriveKey("wrong-passphrase", salt)
    expect(() => decrypt(blob, wrongKey)).toThrow()
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd C:/Users/benni/dev/heimdall-opencode/packages/opencode
bun test test/hmem/sync.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/hmem/sync/crypto.ts packages/opencode/test/hmem/sync.test.ts
git commit -m "feat(hmem): add sync crypto module with AES-256-GCM + scrypt"
```

---

### Task 10: Sync Client + Transport + Config

**Files:**
- Create: `packages/opencode/src/hmem/sync/config.ts`
- Create: `packages/opencode/src/hmem/sync/client.ts`
- Create: `packages/opencode/src/hmem/sync/transport.ts`
- Create: `packages/opencode/src/hmem/sync/setup.ts`

- [ ] **Step 1: Create sync/config.ts**

```typescript
// packages/opencode/src/hmem/sync/config.ts
import fs from "fs"
import path from "path"
import { Global } from "../../global"

export interface SyncConfig {
  serverUrl: string
  userId: string
  salt: string
  syncSecrets: boolean
  databases: Record<string, { enabled: boolean }>
}

export interface SyncState {
  [dbName: string]: { last_push_at: string | null; last_pull_at: string | null }
}

const syncDir = () => Global.Path.sync
const configPath = () => path.join(syncDir(), "config.json")
const tokenPath = () => path.join(syncDir(), "token")
const statePath = () => path.join(syncDir(), "state.json")

export function loadConfig(): SyncConfig | null {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"))
  } catch {
    return null
  }
}

export function saveConfig(cfg: SyncConfig): void {
  fs.mkdirSync(syncDir(), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
}

export function loadToken(): string | null {
  try {
    return fs.readFileSync(tokenPath(), "utf8").replace(/[^\x21-\x7E]/g, "") || null
  } catch {
    return null
  }
}

export function saveToken(token: string): void {
  fs.mkdirSync(syncDir(), { recursive: true })
  fs.writeFileSync(tokenPath(), token, { encoding: "utf8", mode: 0o600 })
  try { fs.chmodSync(tokenPath(), 0o600) } catch {}
}

export function loadState(): SyncState {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"))
  } catch {
    return {}
  }
}

export function saveState(state: SyncState): void {
  fs.mkdirSync(syncDir(), { recursive: true })
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2))
}

export function isConfigured(): boolean {
  return loadConfig() !== null && loadToken() !== null
}
```

- [ ] **Step 2: Create sync/transport.ts**

Port HTTP transport from `hmem-sync/dist/cli.js`:

```typescript
// packages/opencode/src/hmem/sync/transport.ts

export interface PushBlob {
  id_hash: string
  blob: { data: string; updated_at: string }
}

export interface PullResult {
  blobs: { blob: { data: string; updated_at: string } }[]
  server_time?: string
}

export async function pushBlobs(
  serverUrl: string, token: string, blobs: PushBlob[], batchSize = 200,
): Promise<number> {
  let stored = 0
  for (let i = 0; i < blobs.length; i += batchSize) {
    const chunk = blobs.slice(i, i + batchSize)
    const res = await fetch(`${serverUrl}/blobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(chunk),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Push failed (${res.status}): ${body.substring(0, 200)}`)
    }
    const data = await res.json() as { stored: number }
    stored += data.stored
  }
  return stored
}

export async function pullBlobs(
  serverUrl: string, token: string, since: string | null,
): Promise<PullResult> {
  const url = since
    ? `${serverUrl}/blobs?since=${encodeURIComponent(since)}`
    : `${serverUrl}/blobs`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Pull failed (${res.status}): ${body.substring(0, 200)}`)
  }
  const parsed = await res.json()
  if (Array.isArray(parsed)) return { blobs: parsed }
  return parsed as PullResult
}

export async function register(
  serverUrl: string, userId: string, salt: string,
): Promise<string> {
  const res = await fetch(`${serverUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, salt }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown" }))
    throw new Error(`Registration failed (${res.status}): ${(body as any).error ?? "unknown"}`)
  }
  const data = await res.json() as { token: string }
  return data.token
}

export async function fetchSalt(serverUrl: string, userId: string): Promise<string> {
  const res = await fetch(`${serverUrl}/salt/${encodeURIComponent(userId)}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown" }))
    throw new Error(`Salt fetch failed (${res.status}): ${(body as any).error ?? "unknown"}`)
  }
  const data = await res.json() as { salt: string }
  return data.salt
}
```

- [ ] **Step 3: Create sync/client.ts**

Port sync logic from `hmem-sync/dist/sync.js`:

```typescript
// packages/opencode/src/hmem/sync/client.ts
import { Store } from "../store"
import { encryptEntry, decryptEntry, hashId, deriveKey } from "./crypto"
import { pushBlobs, pullBlobs, type PushBlob } from "./transport"
import { loadConfig, loadToken, loadState, saveState, type SyncState } from "./config"

export class SyncClient {
  private key: Buffer
  private dbName: string
  private salt: string

  constructor(
    private store: Store,
    passphrase: string,
    salt: string,
    private dbName_: string,
  ) {
    this.key = deriveKey(passphrase, salt)
    this.dbName = dbName_
    this.salt = salt
  }

  buildPushPayload(since: string | null): PushBlob[] {
    const entries = this.readEntries(since)
    return entries.map((e: any) => ({
      id_hash: hashId(e.id, this.dbName, this.salt),
      blob: encryptEntry(e.id, e, this.key, e.updated_at ?? e.created_at),
    }))
  }

  mergeBlob(blob: { data: string; updated_at: string }): "upserted" | "skipped" {
    const payload = decryptEntry(blob, this.key)
    return this.upsertEntry(payload)
  }

  private readEntries(since: string | null): any[] {
    let sql = `
      SELECT m.*, GROUP_CONCAT(mt.tag) as tag_list
      FROM memories m LEFT JOIN memory_tags mt ON mt.entry_id = m.id
      WHERE m.seq > 0`
    const params: any[] = []
    if (since) {
      sql += " AND (m.updated_at > ? OR (m.updated_at IS NULL AND m.created_at > ?))"
      params.push(since, since)
    }
    sql += " GROUP BY m.id ORDER BY m.updated_at ASC"
    const rows = this.store.database.prepare(sql).all(...params) as any[]
    return rows.map((row: any) => ({
      id: row.id, prefix: row.prefix, seq: row.seq,
      created_at: row.created_at, updated_at: row.updated_at ?? null,
      level_1: row.level_1, obsolete: row.obsolete ?? 0,
      favorite: row.favorite ?? 0, irrelevant: row.irrelevant ?? 0,
      pinned: row.pinned ?? 0, links: row.links ?? null,
      min_role: row.min_role ?? "worker",
      tags: row.tag_list ? row.tag_list.split(",") : [],
      nodes: this.readNodes(row.id),
    }))
  }

  private readNodes(rootId: string): any[] {
    const rows = this.store.database
      .prepare("SELECT * FROM memory_nodes WHERE root_id = ? ORDER BY depth, seq")
      .all(rootId) as any[]
    return rows.map((r: any) => ({
      id: r.id, parent_id: r.parent_id, depth: r.depth, seq: r.seq,
      content: r.content, created_at: r.created_at,
      favorite: r.favorite ?? 0, irrelevant: r.irrelevant ?? 0,
    }))
  }

  private upsertEntry(payload: any): "upserted" | "skipped" {
    const existing = this.store.database
      .prepare("SELECT updated_at, created_at FROM memories WHERE id = ?")
      .get(payload.id) as any
    const incomingTs = payload.updated_at ?? payload.created_at
    if (existing) {
      const localTs = existing.updated_at ?? existing.created_at
      if (localTs >= incomingTs) return "skipped"
    }
    // Upsert root entry
    this.store.database.prepare(`
      INSERT INTO memories (id, prefix, seq, created_at, updated_at, level_1,
        obsolete, favorite, irrelevant, pinned, links, min_role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at=excluded.updated_at, level_1=excluded.level_1,
        obsolete=excluded.obsolete, favorite=excluded.favorite,
        irrelevant=excluded.irrelevant, pinned=excluded.pinned,
        links=excluded.links, min_role=excluded.min_role
    `).run(payload.id, payload.prefix, payload.seq, payload.created_at,
      payload.updated_at, payload.level_1, payload.obsolete, payload.favorite,
      payload.irrelevant, payload.pinned, payload.links, payload.min_role)
    // Upsert nodes
    if (payload.nodes) {
      for (const node of payload.nodes) {
        this.store.database.prepare(`
          INSERT INTO memory_nodes (id, parent_id, root_id, depth, seq, content, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET content=excluded.content
        `).run(node.id, node.parent_id, payload.id, node.depth, node.seq, node.content, node.created_at)
      }
    }
    // Upsert tags
    if (payload.tags?.length) {
      this.store.database.prepare("DELETE FROM memory_tags WHERE entry_id = ?").run(payload.id)
      const insert = this.store.database.prepare("INSERT OR IGNORE INTO memory_tags (entry_id, tag) VALUES (?, ?)")
      for (const tag of payload.tags) insert.run(payload.id, tag)
    }
    return "upserted"
  }
}

/** High-level sync: push then pull for a single database */
export async function syncDatabase(
  store: Store, dbName: string, passphrase: string,
): Promise<{ pushed: number; pulled: number; errors: number }> {
  const cfg = loadConfig()
  if (!cfg) throw new Error("Sync not configured. Run: heimdall sync setup")
  const token = loadToken()
  if (!token) throw new Error("Sync token not found. Run: heimdall sync setup")

  const client = new SyncClient(store, passphrase, cfg.salt, dbName)
  const state = loadState()
  const dbState = state[dbName] ?? { last_push_at: null, last_pull_at: null }

  // Push
  const blobs = client.buildPushPayload(dbState.last_push_at)
  let pushed = 0
  if (blobs.length > 0) {
    pushed = await pushBlobs(cfg.serverUrl, token, blobs)
  }

  // Pull
  const pullResult = await pullBlobs(cfg.serverUrl, token, dbState.last_pull_at)
  let pulled = 0, errors = 0
  for (const b of pullResult.blobs) {
    try {
      const result = client.mergeBlob(b.blob)
      if (result === "upserted") pulled++
    } catch { errors++ }
  }

  // Update state
  const now = pullResult.server_time ?? new Date().toISOString()
  state[dbName] = { last_push_at: now, last_pull_at: now }
  saveState(state)

  return { pushed, pulled, errors }
}
```

- [ ] **Step 4: Create sync/setup.ts**

```typescript
// packages/opencode/src/hmem/sync/setup.ts
import { generateKeyMaterial } from "./crypto"
import { register, fetchSalt } from "./transport"
import { saveConfig, saveToken, type SyncConfig } from "./config"

const DEFAULT_SERVER = "https://bbbee.uber.space"

export interface SetupInput {
  serverUrl?: string
  userId: string
  passphrase: string
}

export interface SetupResult {
  recoveryKey: string
  token: string
}

export async function setupSync(input: SetupInput): Promise<SetupResult> {
  const serverUrl = input.serverUrl ?? DEFAULT_SERVER
  const { salt, recoveryKey } = generateKeyMaterial()
  const token = await register(serverUrl, input.userId, salt)

  const cfg: SyncConfig = {
    serverUrl,
    userId: input.userId,
    salt,
    syncSecrets: false,
    databases: { heimdall: { enabled: true } },
  }
  saveConfig(cfg)
  saveToken(token)

  return { recoveryKey, token }
}

export interface RestoreInput {
  serverUrl?: string
  userId: string
  passphrase: string
  token: string
}

export async function restoreSync(input: RestoreInput): Promise<void> {
  const serverUrl = input.serverUrl ?? DEFAULT_SERVER
  const salt = await fetchSalt(serverUrl, input.userId)

  // Verify token
  const res = await fetch(`${serverUrl}/blobs`, {
    headers: { Authorization: `Bearer ${input.token}` },
  })
  if (!res.ok) throw new Error(`Token verification failed (${res.status})`)

  const cfg: SyncConfig = {
    serverUrl,
    userId: input.userId,
    salt,
    syncSecrets: false,
    databases: { heimdall: { enabled: true } },
  }
  saveConfig(cfg)
  saveToken(input.token)
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/hmem/sync/
git commit -m "feat(hmem): add sync client, transport, setup, and config"
```

---

## Chunk 5: Migration + Cleanup

### Task 11: Migration Logic

**Files:**
- Create: `packages/opencode/src/hmem/migration.ts`

- [ ] **Step 1: Create migration.ts**

```typescript
// packages/opencode/src/hmem/migration.ts
import fs from "fs"
import path from "path"
import os from "os"
import { Global } from "../global"
import { loadState, saveState, saveConfig, saveToken, type SyncConfig, type SyncState } from "./sync/config"

const MIGRATED_PATH = () => path.join(Global.Path.data, "migrated.json")

interface MigratedState {
  hmem?: boolean
  hmemSync?: boolean
  date?: string
}

function loadMigrated(): MigratedState {
  try { return JSON.parse(fs.readFileSync(MIGRATED_PATH(), "utf8")) } catch { return {} }
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

  // Quick count
  try {
    const Database = require("better-sqlite3")
    const db = new Database(oldPath, { readonly: true })
    const row = db.prepare("SELECT COUNT(*) as count FROM memories WHERE seq > 0").get() as any
    db.close()
    return { path: oldPath, entryCount: row.count }
  } catch {
    return { path: oldPath, entryCount: -1 } // can't count but file exists
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

  // Migrate config
  try {
    const cfg = JSON.parse(fs.readFileSync(oldConfig, "utf8"))
    const newCfg: SyncConfig = {
      serverUrl: cfg.serverUrl ?? "https://bbbee.uber.space",
      userId: cfg.userId,
      salt: cfg.salt,
      syncSecrets: cfg.syncSecrets ?? false,
      databases: { heimdall: { enabled: true } },
    }
    saveConfig(newCfg)
  } catch {}

  // Migrate token
  if (fs.existsSync(oldToken)) {
    try {
      const token = fs.readFileSync(oldToken, "utf8").replace(/[^\x21-\x7E]/g, "")
      if (token) saveToken(token)
    } catch {}
  }

  // Migrate state (flat → keyed by "heimdall")
  if (fs.existsSync(oldState)) {
    try {
      const old = JSON.parse(fs.readFileSync(oldState, "utf8"))
      const newState: SyncState = {
        heimdall: {
          last_push_at: old.last_push_at ?? null,
          last_pull_at: old.last_pull_at ?? null,
        },
      }
      saveState(newState)
    } catch {}
  }

  migrated.hmemSync = true
  migrated.date = new Date().toISOString()
  saveMigrated(migrated)
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/hmem/migration.ts
git commit -m "feat(hmem): add migration logic for existing hmem and hmem-sync data"
```

---

### Task 12: Plugin Cleanup

**Files:**
- Modify: `P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/opencode.json` (or `heimdall.json`)
- Modify: `P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/packages/heimdall-hmem/src/index.ts`

- [ ] **Step 1: Remove heimdall-hmem plugin entry from config**

In the Heimdall CLI repo, edit `opencode.json` (or `heimdall.json`):

Remove the `file://...heimdall-hmem...` line from the `"plugin"` array. Keep `heimdall-catalog` if still needed.

- [ ] **Step 2: Add deprecation note to plugin index.ts**

In `P:/.../packages/heimdall-hmem/src/index.ts`, add a console warning at the top:

```typescript
console.warn("[heimdall-hmem] This plugin is deprecated. hmem is now built into Heimdall CLI natively.")
```

- [ ] **Step 3: Commit both repos**

Heimdall CLI repo:
```bash
cd "P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI"
git add opencode.json packages/heimdall-hmem/src/index.ts
git commit -m "chore: deprecate heimdall-hmem plugin — now built into Heimdall CLI"
```

---

### Task 13: Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all hmem tests**

```bash
cd C:/Users/benni/dev/heimdall-opencode/packages/opencode
bun test test/hmem/
```

Expected: All tests pass (store, read-write, bulk-read, tools, sync).

- [ ] **Step 2: Build the fork**

```bash
cd C:/Users/benni/dev/heimdall-opencode/packages/opencode
bun run build
```

Expected: Build succeeds without errors.

- [ ] **Step 3: Run full test suite**

```bash
cd C:/Users/benni/dev/heimdall-opencode/packages/opencode
bun test --timeout 30000
```

Expected: No new failures (existing symlink failures on Windows are pre-existing).

- [ ] **Step 4: Manual verification checklist**

Start Heimdall and verify:
1. First-chat dialog appears (if `.heimdall/config.json` doesn't exist)
2. `hmem_write` tool is available in the tool list
3. `hmem_read` returns entries after writing
4. `hmem_search` finds entries via FTS
5. `hmem_stats` shows correct counts
6. Memory context appears in system prompt (visible in debug logs)
7. `hmem_read_agent` works for Heimdall (returns empty for non-existent agents)

---

## Summary

| Chunk | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-4 | Core hmem module: adapter, types, schema, store, all read/write modules |
| 2 | 5-6 | StoreManager, tool definitions, ToolRegistry registration |
| 3 | 7-8 | System prompt injection, first-chat dialog |
| 4 | 9-10 | hmem-sync: crypto, client, transport, setup |
| 5 | 11-13 | Migration, plugin cleanup, integration verification |

**Total: 13 tasks, ~25 files created, ~5 files modified.**
