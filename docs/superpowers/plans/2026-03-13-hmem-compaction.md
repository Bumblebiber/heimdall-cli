# hmem as Compaction Engine — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OpenCode's flat text-summary compaction with hmem-based structured memory writes via a dedicated compaction agent.

**Architecture:** A new "hmem-compaction" agent (hidden, Haiku default) receives the full conversation on token overflow. It reads existing L1 entries via `hmem_read`, splits the conversation into thematic chunks, and writes each as a hierarchical L1–L5 entry via `hmem_write`/`hmem_append`. The session retains only a minimal reference message. Future context comes from BulkRead V2 via the auto-recall hook.

**Tech Stack:** TypeScript, better-sqlite3 (via sqlite-adapter), vitest, OpenCode plugin SDK (`@opencode-ai/plugin`), ai-sdk

**Spec:** `docs/superpowers/specs/2026-03-13-hmem-compaction-design.md`

**Repositories:**
- **Plugin (heimdall-hmem):** `P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/packages/heimdall-hmem/`
- **Fork (opencode):** `C:/Users/benni/dev/heimdall-opencode/packages/opencode/`

---

## File Structure

### Create
| File | Responsibility |
|------|---------------|
| `packages/opencode/src/agent/prompt/hmem-compaction.txt` | System prompt for compaction agent — chunking, categorization, L1–L5 writing instructions |
| `packages/heimdall-hmem/src/bulk-read.test.ts` | Tests for BulkRead L2 body + session-recency boost |

### Modify (heimdall-hmem plugin)
| File | Lines | Change |
|------|-------|--------|
| `src/types.ts` | 26 | CHAR_LIMITS: `[120, 200, 300, 400, 0]` → `[120, 300, 800, 2000, 0]` |
| `src/read.ts` | 145+ | Export `readL1Headers(store)` — all L1 entries without children |
| `src/tools.ts` | 148+ | Add `hmem_list` tool for L1 listing |
| `src/bulk-read.ts` | 68-81 | L2 full body for cached entries + session-recency boost (entries < 24h → L1-L4) |
| `src/read.ts` | 45+ | Add `loadChildrenToDepth(store, id, maxDepth)` helper |
| `src/index.ts` | 29-109 | Remove `compactingSessions` Set, `experimental.session.compacting` hook, and compaction event handler |
| `src/compact.ts` | 10-36 | Remove `COMPACTION_LEARNINGS_CONTEXT` constant |

### Modify (opencode fork)
| File | Lines | Change |
|------|-------|--------|
| `src/agent/agent.ts` | 158-172 | Add `"hmem-compaction"` agent definition (hidden, native, hmem tools allowed) |
| `src/session/compaction.ts` | 102-223 | Use hmem-compaction agent, resolve hmem tools via ToolRegistry |

---

## Chunk 1: Plugin — Char Limits + L1 Listing Tool

### Task 1: Update CHAR_LIMITS

**Files:**
- Modify: `packages/heimdall-hmem/src/types.ts:26`

- [ ] **Step 1: Update the CHAR_LIMITS constant**

Change line 26 from:
```typescript
export const CHAR_LIMITS = [120, 200, 300, 400, 0]
```
to:
```typescript
export const CHAR_LIMITS = [120, 300, 800, 2000, 0]
```

- [ ] **Step 2: Update the comment above it**

Change line 25 from:
```typescript
// L1: 120, L2: 200, L3: 300, L4: 400, L5: unlimited
```
to:
```typescript
// L1: 120, L2: 300, L3: 800, L4: 2000, L5: unlimited
```

- [ ] **Step 3: Verify build**

Run: `cd "P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/packages/heimdall-hmem" && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/heimdall-hmem/src/types.ts
git commit -m "feat(hmem): update char limits — L2:300, L3:800, L4:2000"
```

---

### Task 2: Add L1 Listing to read.ts

**Files:**
- Modify: `packages/heimdall-hmem/src/read.ts`

- [ ] **Step 1: Add readL1Headers function**

Add after the existing exports at the end of `read.ts` (after line 146):

```typescript
/**
 * Read all L1 entries (headers only, no children loaded).
 * Used by the compaction agent to see what's already in memory.
 */
export function readL1Headers(store: Store, opts: { prefix?: string } = {}): MemoryEntry[] {
  let sql = "SELECT * FROM memories WHERE seq > 0"
  const params: any[] = []

  if (opts.prefix) {
    sql += " AND prefix = ?"
    params.push(opts.prefix.toUpperCase())
  }

  sql += " ORDER BY created_at DESC"

  const rows = store.database.prepare(sql).all(...params) as any[]
  return rows.map(scanEntry) // No children loaded — L1 only
}
```

- [ ] **Step 2: Verify build**

Run: `cd "P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/packages/heimdall-hmem" && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/heimdall-hmem/src/read.ts
git commit -m "feat(hmem): add readL1Headers for compaction agent L1 listing"
```

---

### Task 3: Add hmem_list Tool

**Files:**
- Modify: `packages/heimdall-hmem/src/tools.ts`

The compaction agent needs to see all L1 entries before deciding where to place new content. Neither `hmem_read` (single ID) nor `hmem_search` (keyword required) supports this. Add `hmem_list`.

- [ ] **Step 1: Add import for readL1Headers**

In `tools.ts` line 3, change:
```typescript
import { read } from "./read.js"
```
to:
```typescript
import { read, readL1Headers } from "./read.js"
```

- [ ] **Step 2: Add hmem_list tool definition**

Add before the closing `}` of the return object (before the line with `hmem_health`), after `hmem_stats`:

```typescript
    hmem_list: tool({
      description: "List all L1 memory entries (titles only, no children). Use to see existing memory before writing new entries.",
      args: {
        prefix: tool.schema.string().optional().describe("Filter by prefix (P, L, E, D, T, M, etc.)"),
      },
      async execute(args) {
        const entries = readL1Headers(store, { prefix: args.prefix })
        if (entries.length === 0) return "No memories found."
        return render(entries)
      },
    }),
```

- [ ] **Step 3: Verify build**

Run: `cd "P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/packages/heimdall-hmem" && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/heimdall-hmem/src/tools.ts
git commit -m "feat(hmem): add hmem_list tool for L1 header listing"
```

---

## Chunk 2: Plugin — BulkRead Adjustments

### Task 4: Add loadChildrenToDepth Helper

**Files:**
- Modify: `packages/heimdall-hmem/src/read.ts`

BulkRead's session-recency boost needs to load children up to depth 4 (L1-L4). Currently `loadDirectChildren` only loads one level. Add a recursive loader.

- [ ] **Step 1: Add loadChildrenToDepth function**

Add after `loadDirectChildren` (after line 50) in `read.ts`:

```typescript
/**
 * Recursively load children up to maxDepth levels deep.
 * depth=1 is equivalent to loadDirectChildren.
 */
export function loadChildrenToDepth(store: Store, parentId: string, maxDepth: number): MemoryNode[] {
  if (maxDepth <= 0) return []
  const children = loadDirectChildren(store, parentId)
  if (maxDepth > 1) {
    for (const child of children) {
      child.children = loadChildrenToDepth(store, child.id, maxDepth - 1)
    }
  }
  return children
}
```

- [ ] **Step 2: Verify build**

Run: `cd "P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/packages/heimdall-hmem" && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/heimdall-hmem/src/read.ts
git commit -m "feat(hmem): add loadChildrenToDepth recursive helper"
```

---

### Task 5: BulkRead — L2 Full Body + Session-Recency Boost

**Files:**
- Modify: `packages/heimdall-hmem/src/bulk-read.ts`

Two changes:
1. **L2 full body**: Cached entries (5-30 min old) now load L2 children instead of showing only L1.
2. **Session-recency boost**: Entries created < 24h ago get full L1-L4 expansion regardless of cache state.

- [ ] **Step 1: Update import in bulk-read.ts**

Change line 4:
```typescript
import { scanEntry, loadDirectChildren } from "./read.js"
```
to:
```typescript
import { scanEntry, loadDirectChildren, loadChildrenToDepth } from "./read.js"
```

- [ ] **Step 2: Add isRecent helper function**

Add after the `weightedAccessScore` function (after line 10):

```typescript
const RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

function isRecent(entry: MemoryEntry): boolean {
  const created = new Date(entry.createdAt).getTime()
  return (Date.now() - created) < RECENCY_WINDOW_MS
}
```

- [ ] **Step 3: Update the entry loading logic**

Replace the cache-based loading block (lines 70-81):

```typescript
  const result: MemoryEntry[] = []
  for (const e of all) {
    if (!selected.has(e.id)) continue
    if (hidden.has(e.id) && !e.favorite && !e.pinned) continue

    if (cached.has(e.id) && !e.favorite && !e.pinned) {
      result.push(e)
    } else {
      e.children = loadDirectChildren(store, e.id)
      result.push(e)
    }
  }
```

with:

```typescript
  const result: MemoryEntry[] = []
  for (const e of all) {
    if (!selected.has(e.id)) continue
    if (hidden.has(e.id) && !e.favorite && !e.pinned) continue

    if (isRecent(e)) {
      // Session-recency boost: entries < 24h get full L1-L4 expansion
      e.children = loadChildrenToDepth(store, e.id, 3) // depth 3 = L2→L3→L4
    } else {
      // L2 full body: always load direct children (L2 level) for context
      e.children = loadDirectChildren(store, e.id)
    }
    result.push(e)
  }
```

Note: The original code had a "cached" branch that skipped loading children entirely (performance optimization). We intentionally remove that distinction — all selected entries now get at least L2 children loaded. The session-cache still prevents entries from appearing in results (via the `hidden` check above), but the "cached" tier (5-30 min) no longer skips child loading. This is the "L2 full body" change from the spec.

- [ ] **Step 4: Ensure recent entries are always selected**

Add after the favorites/pinned selection (after line 66 — `for (const e of all) { if (e.favorite || e.pinned) selected.add(e.id) }`):

```typescript
  // Session-recency boost: entries < 24h always included
  for (const e of active) {
    if (isRecent(e)) selected.add(e.id)
  }
```

- [ ] **Step 5: Verify build**

Run: `cd "P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/packages/heimdall-hmem" && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/heimdall-hmem/src/bulk-read.ts
git commit -m "feat(hmem): BulkRead L2 full body + session-recency boost (entries <24h → L1-L4)"
```

---

### Task 6: Write BulkRead Tests

**Files:**
- Create: `packages/heimdall-hmem/src/bulk-read.test.ts`

- [ ] **Step 1: Write test file**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "./store.js"
import { write } from "./write.js"
import { bulkReadV2 } from "./bulk-read.js"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"

describe("bulkReadV2", () => {
  let store: Store
  let cleanup: () => void

  beforeEach(async () => {
    const dir = join(tmpdir(), `hmem-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, "test.hmem")
    store = await Store.open(path)
    cleanup = () => {
      store.close()
      try { rmSync(dir, { recursive: true }) } catch {}
    }
  })

  afterEach(() => cleanup())

  it("returns empty array for empty store", () => {
    const result = bulkReadV2(store, {})
    expect(result).toEqual([])
  })

  it("loads L2 children for all selected entries", () => {
    // Write entry with L1 + L2
    write(store, "L", "Test lesson learned\n\tDetailed explanation of the lesson", {
      tags: ["#test"],
    })

    const result = bulkReadV2(store, {})
    expect(result).toHaveLength(1)
    expect(result[0].level1).toBe("Test lesson learned")
    // All entries now get at least L2 children loaded (L2 full body)
    expect(result[0].children.length).toBeGreaterThan(0)
    expect(result[0].children[0].content).toBe("Detailed explanation of the lesson")
  })

  it("session-recency boost loads L2-L4 for entries < 24h", () => {
    // Write entry with L1 → L2 → L3 → L4
    write(store, "P", "Project milestone reached\n\tImplemented feature X\n\t\tUsed pattern Y for Z\n\t\t\tFull implementation details with code references", {
      tags: ["#project"],
    })

    const result = bulkReadV2(store, {})
    expect(result).toHaveLength(1)
    // Should have L2 children
    expect(result[0].children.length).toBeGreaterThan(0)
    // L2 child should have L3 children (recency boost)
    const l2 = result[0].children[0]
    expect(l2.children.length).toBeGreaterThan(0)
    // L3 child should have L4 children (recency boost)
    const l3 = l2.children[0]
    expect(l3.children.length).toBeGreaterThan(0)
  })

  it("old entries get only L2 children (no deep expansion)", () => {
    // Write entry with L1 → L2 → L3 → L4
    write(store, "P", "Old project\n\tOld detail\n\t\tOld deep\n\t\t\tOld deeper", {
      tags: ["#old"],
    })

    // Backdate the entry to 25 hours ago
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    store.database.prepare("UPDATE memories SET created_at = ?").run(oldDate)

    const result = bulkReadV2(store, {})
    expect(result).toHaveLength(1)
    // Should have L2 children (L2 full body)
    expect(result[0].children.length).toBeGreaterThan(0)
    // L2 child should NOT have L3 children (no recency boost for >24h)
    const l2 = result[0].children[0]
    expect(l2.children).toEqual([])
  })

  it("always includes favorites regardless of selection", () => {
    // Write several entries to exceed selection slots
    for (let i = 0; i < 10; i++) {
      write(store, "L", `Lesson ${i}`)
    }
    // Mark the oldest as favorite
    store.database.prepare("UPDATE memories SET favorite = 1 WHERE seq = 1").run()

    const result = bulkReadV2(store, {})
    const favEntry = result.find((e) => e.favorite)
    expect(favEntry).toBeDefined()
  })

  it("write() accepts L2 content up to 300 chars (updated limit)", () => {
    const l2Content = "A".repeat(290) // Under new 300 limit (tolerance: 375)
    write(store, "L", `Short title\n\t${l2Content}`)

    const result = bulkReadV2(store, {})
    expect(result).toHaveLength(1)
    expect(result[0].children[0].content).toBe(l2Content)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd "P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/packages/heimdall-hmem" && npx vitest run src/bulk-read.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/heimdall-hmem/src/bulk-read.test.ts
git commit -m "test(hmem): add BulkRead tests for L2 body + session-recency boost"
```

---

## Chunk 3: Plugin — Remove Old Compaction Hooks

### Task 7: Clean Up index.ts

**Files:**
- Modify: `packages/heimdall-hmem/src/index.ts`

The old approach (inject prompt into compaction → parse HTML comment from summary → write topics) is replaced by the dedicated agent. Remove:
- `compactingSessions` Set
- `experimental.session.compacting` hook
- `session.compacted` event handler logic
- `hmem-topics` stripping from auto-recall (no longer needed)
- Imports: `COMPACTION_LEARNINGS_CONTEXT`, `extractLearningsFromText`, `writeCompactedTopics`

**Note:** Apply Steps 1-6 atomically (all at once) before running the build check in Step 7. The intermediate states between steps will not compile.

- [ ] **Step 1: Remove compact.ts imports**

Remove lines 8-11:
```typescript
import {
  COMPACTION_LEARNINGS_CONTEXT,
  extractLearningsFromText,
  writeCompactedTopics,
} from "./compact.js"
```

- [ ] **Step 2: Remove compactingSessions Set**

Remove line 30-31:
```typescript
  // Track sessions being compacted so we can process their results
  const compactingSessions = new Set<string>()
```

- [ ] **Step 3: Remove hmem-topics stripping from auto-recall hook**

In the `experimental.chat.system.transform` hook, remove lines 42-47:
```typescript
        // Strip any hmem-topics blocks from compacted context (already processed)
        for (let i = 0; i < output.system.length; i++) {
          if (output.system[i].includes("<!--hmem-topics")) {
            const { cleaned } = extractLearningsFromText(output.system[i])
            output.system[i] = cleaned
          }
        }
```

- [ ] **Step 4: Remove the experimental.session.compacting hook entirely**

Remove lines 63-71:
```typescript
    // --- Compaction → hmem Flush: inject learning-extraction prompt ---
    "experimental.session.compacting": async (input, output) => {
      try {
        compactingSessions.add(input.sessionID)
        output.context.push(COMPACTION_LEARNINGS_CONTEXT)
      } catch (err) {
        console.error("[heimdall-hmem] Compaction hook failed:", err)
      }
    },
```

- [ ] **Step 5: Remove the compaction event handler logic**

Remove lines 73-108 (the entire `event` handler):
```typescript
    // --- Event handler: process compacted sessions + session idle ---
    event: async (input) => { ... },
```

- [ ] **Step 6: Change `pluginInput` back to `_input` (unused parameter)**

Line 15: change `const hmemPlugin: Plugin = async (pluginInput) => {` to:
```typescript
const hmemPlugin: Plugin = async (_pluginInput) => {
```

- [ ] **Step 7: Verify the simplified index.ts builds**

Run: `cd "P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/packages/heimdall-hmem" && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/heimdall-hmem/src/index.ts
git commit -m "refactor(hmem): remove old compaction hooks — replaced by dedicated agent"
```

---

### Task 8: Clean Up compact.ts

**Files:**
- Modify: `packages/heimdall-hmem/src/compact.ts`

Remove `COMPACTION_LEARNINGS_CONTEXT` (the prompt injection string). The remaining exports (`extractLearningsFromText`, `writeCompactedTopics`, `parseCompactionResponse`, `topicToContent`) become dead code after Task 7 removes their only consumer. Retain them for now — they may be useful as CLI utilities or for future MCP tool commands. Mark with a TODO comment.

- [ ] **Step 1: Remove COMPACTION_LEARNINGS_CONTEXT**

Remove lines 6-36 (the constant and its JSDoc):
```typescript
/**
 * Additional context injected into the compaction prompt.
 * Asks the LLM to embed structured learnings as an HTML comment at the end.
 */
export const COMPACTION_LEARNINGS_CONTEXT = `
IMPORTANT — Memory Extraction:
...
`
```

- [ ] **Step 2: Verify build**

Run: `cd "P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/packages/heimdall-hmem" && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/heimdall-hmem/src/compact.ts
git commit -m "refactor(hmem): remove compaction prompt constant — agent has own prompt"
```

---

## Chunk 4: Core Patch (Fork) — Agent Definition

### Task 9: Create hmem-compaction Agent Prompt

**Files:**
- Create: `packages/opencode/src/agent/prompt/hmem-compaction.txt`

This is the core of the feature — the system prompt that tells the compaction agent how to chunk, categorize, and write structured memories.

- [ ] **Step 1: Write the prompt file**

Create `C:/Users/benni/dev/heimdall-opencode/packages/opencode/src/agent/prompt/hmem-compaction.txt`:

```
You are the hmem compaction agent. Your job is to extract structured knowledge from a conversation and write it to hierarchical long-term memory (hmem).

## Process

1. First, call hmem_list to see ALL existing L1 entries. Understand what's already in memory.

2. Read the conversation and identify 3-7 thematic chunks. A chunk is one coherent topic:
   - A bug investigation and fix
   - A feature implementation
   - An architecture discussion or decision
   - A lesson learned or best practice
   - A task for future work
   - A milestone reached
   Chunk boundaries: topic shifts, user redirections, new tasks.

3. For each chunk, categorize with a prefix:
   - P = project progress, implementation work
   - L = lesson learned, best practice discovered
   - E = error encountered and fixed (include root cause + fix)
   - D = decision made with rationale
   - T = task noted for future work
   - M = milestone reached

4. For each chunk, decide placement:
   - Check if an existing L1 entry matches this chunk's topic
   - Active projects marked with [★] have priority for project-related chunks
   - If a match exists → use hmem_append to add under that entry
   - If no match → use hmem_write to create a new root entry

5. Write each chunk as hierarchical content (tab-indented):
   - L1 (no indent): One complete sentence summarizing the chunk (max 120 chars)
   - L2 (1 tab): Extended summary with key context (max 300 chars)
   - L3 (2 tabs): Decisions, constraints, technical details (max 800 chars)
   - L4 (3 tabs): Full narrative with code references, file paths (max 2000 chars)
   - L5 (4 tabs): Original conversation wording — User/Agent dialog verbatim.
     For tool calls, write only references: "Read src/store.ts: 150 lines"
     Do NOT include tool output content. No char limit on L5.

6. Each chunk MUST have 1-3 hashtags. Tags are lowercase with # prefix: #typescript, #hmem, #bugfix

7. After writing all chunks, output a single summary line:
   "Compacted → [list of written/appended IDs]. Current task: [what the user was working on]"
   Example: "Compacted → P0037.14, L0118, E0095. Current task: implementing BulkRead session-recency boost"

## Rules

- Merge related topics into the same chunk. Prefer fewer, richer chunks over many thin ones.
- L1 must be a complete, self-contained sentence understandable without context.
- Each level summarizes the level below it. L1 summarizes L2, L2 summarizes L3, etc.
- When appending to an existing entry, only write L2+ content (the parent already has L1).
- Skip trivial actions (routine file reads, simple edits) — focus on root causes, surprises, decisions.
- If nothing noteworthy happened in the conversation, write a single L-entry noting that.
- Always include the current task status so the next agent knows what to continue.
```

- [ ] **Step 2: Commit**

```bash
cd C:/Users/benni/dev/heimdall-opencode
git add packages/opencode/src/agent/prompt/hmem-compaction.txt
git commit -m "feat: add hmem-compaction agent prompt"
```

---

### Task 10: Add hmem-compaction Agent Definition

**Files:**
- Modify: `packages/opencode/src/agent/agent.ts:1-5` (imports) and `158-172` (agent definitions)

- [ ] **Step 1: Add prompt import**

At the top of `agent.ts`, alongside the other prompt imports (around line 7-10), add:

```typescript
import PROMPT_HMEM_COMPACTION from "./prompt/hmem-compaction.txt"
```

- [ ] **Step 2: Add agent definition**

After the existing `compaction` agent definition (after line 172), add the `"hmem-compaction"` entry:

```typescript
      "hmem-compaction": {
        name: "hmem-compaction",
        mode: "primary",
        native: true,
        hidden: true,
        prompt: PROMPT_HMEM_COMPACTION,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            hmem_list: "allow",
            hmem_read: "allow",
            hmem_write: "allow",
            hmem_append: "allow",
            hmem_search: "allow",
            hmem_tag: "allow",
          }),
          user,
        ),
        options: {},
      },
```

Note: The agent allows hmem_list, hmem_read, hmem_write, hmem_append, hmem_search, and hmem_tag. All other tools (bash, edit, etc.) are denied. hmem_search is useful if the agent wants to find related entries by keyword. hmem_tag is useful for adding/correcting tags.

- [ ] **Step 3: Verify TypeScript**

Run: `cd C:/Users/benni/dev/heimdall-opencode && npx tsc --noEmit -p packages/opencode/tsconfig.json`
Expected: No errors related to agent definition

- [ ] **Step 4: Commit**

```bash
cd C:/Users/benni/dev/heimdall-opencode
git add packages/opencode/src/agent/agent.ts
git commit -m "feat: add hmem-compaction agent definition with hmem tool permissions"
```

---

## Chunk 5: Core Patch (Fork) — Compaction Flow Wiring

### Task 11: Wire hmem-compaction Agent in compaction.ts

**Files:**
- Modify: `packages/opencode/src/session/compaction.ts:102-223`

The key changes to `process()`:
1. Try `Agent.get("hmem-compaction")` first, fall back to `"compaction"`
2. When using hmem-compaction agent, resolve hmem tools via `ToolRegistry`
3. Pass resolved tools to `processor.process()` instead of empty `{}`

- [ ] **Step 1: Add imports**

At the top of `compaction.ts`, add imports (after the existing imports around line 16-17):

```typescript
import { ToolRegistry } from "../tool/registry"
import { PermissionNext } from "../permission/next"
import { ProviderTransform } from "@/provider/transform"
import { tool, jsonSchema } from "ai"
```

Note: `ProviderTransform` may already be imported — check line 16. `z` (zod) should already be imported on line 8. The `tool` and `jsonSchema` imports from "ai" are needed to wrap tools in AITool format (same pattern as `session/prompt.ts:797`).

- [ ] **Step 2: Add resolveCompactionTools helper**

Add a helper function inside the `SessionCompaction` namespace (after the `prune` function, around line 100).

**IMPORTANT:** `ToolRegistry.tools()` returns already-initialized tool definitions (with `id`, `description`, `parameters`, `execute`). Do NOT call `.init()` again — it doesn't exist on the returned objects. Use `inputSchema` (not `parameters`) in the `tool()` call — this matches the pattern in `prompt.ts:799`. Apply `ProviderTransform.schema()` for provider compatibility.

```typescript
  async function resolveCompactionTools(input: {
    agent: Agent.Info
    model: Provider.Model
    sessionID: SessionID
    messageID: MessageID
    abort: AbortSignal
  }) {
    if (input.agent.name === "compaction") return {} // Default compaction: no tools

    const allTools = await ToolRegistry.tools(
      { modelID: input.model.id as any, providerID: input.model.providerID },
      input.agent,
    )

    const disabled = PermissionNext.disabled(
      allTools.map((t) => t.id),
      input.agent.permission,
    )

    const tools: Record<string, ReturnType<typeof tool>> = {}
    for (const t of allTools) {
      if (disabled.has(t.id)) continue
      const schema = ProviderTransform.schema(input.model, z.toJSONSchema(t.parameters))
      tools[t.id] = tool({
        id: t.id as any,
        description: t.description,
        inputSchema: jsonSchema(schema as any),
        execute: async (args) => {
          const result = await t.execute(args as any, {
            sessionID: input.sessionID,
            abort: input.abort,
            messageID: input.messageID,
            callID: "",
            agent: input.agent.name,
            messages: [],
            extra: {},
            metadata: () => {},
            ask: async () => {},
          })
          return result.output
        },
      })
    }
    return tools
  }
```

- [ ] **Step 3: Update agent selection in process()**

In `process()`, replace line 132:
```typescript
    const agent = await Agent.get("compaction")
```
with:
```typescript
    const agent = (await Agent.get("hmem-compaction")) ?? (await Agent.get("compaction"))!
```

- [ ] **Step 4: Update message metadata to use resolved agent name**

In the `Session.updateMessage()` call (lines 136-161), change the hardcoded agent name:
```typescript
      agent: "compaction",
```
to:
```typescript
      agent: agent.name,
```

This ensures the assistant message correctly records which agent performed the compaction.

- [ ] **Step 5: Resolve and pass tools**

After the processor creation (after line 167), add tool resolution:

```typescript
    const compactionTools = await resolveCompactionTools({
      agent,
      model,
      sessionID: input.sessionID,
      messageID: msg.id,
      abort: input.abort,
    })
```

Then update the `processor.process()` call. Change line 208:
```typescript
      tools: {},
```
to:
```typescript
      tools: compactionTools,
```

- [ ] **Step 6: Verify TypeScript**

Run: `cd C:/Users/benni/dev/heimdall-opencode && npx tsc --noEmit -p packages/opencode/tsconfig.json`
Expected: No errors. If there are import issues with `tool`/`jsonSchema` from "ai", check the exact import paths used elsewhere in the codebase (e.g., `session/prompt.ts` line 10).

- [ ] **Step 7: Commit**

```bash
cd C:/Users/benni/dev/heimdall-opencode
git add packages/opencode/src/session/compaction.ts
git commit -m "feat: wire hmem-compaction agent with tool resolution in compaction flow"
```

---

### Task 12: Configuration Support

**Files:**
- Modify: `packages/opencode/src/config/config.ts` (if needed)

The compaction model is already configurable via `config.compaction.model` in the existing config schema. Check if it supports the `agent` field.

- [ ] **Step 1: Check existing compaction config**

Read the compaction config schema in `config.ts`. If it already has a `model` field under `compaction`, no changes needed — the agent definition's `model` property (from agent config in `opencode.json`) already handles model selection.

If the user wants to override the compaction model specifically, they can do so via:
```json
{
  "agent": {
    "hmem-compaction": {
      "model": "anthropic/claude-haiku-4-5-20251001"
    }
  }
}
```

This is already supported by the agent config override system (agent.ts lines 206-233).

- [ ] **Step 2: Document in opencode.json**

No code changes needed. The existing agent config system handles model overrides. Document this in the spec if not already there.

- [ ] **Step 3: Commit (skip if no changes)**

Only commit if config.ts was actually modified.

---

### Task 13: Manual Integration Test

This task cannot be automated via unit tests — it requires a running Heimdall instance with the hmem plugin loaded.

- [ ] **Step 1: Build heimdall-hmem plugin**

```bash
cd "P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/packages/heimdall-hmem"
npm run build
```

- [ ] **Step 2: Build opencode fork**

```bash
cd C:/Users/benni/dev/heimdall-opencode
npm run build
```

- [ ] **Step 3: Start Heimdall and trigger compaction**

1. Start Heimdall with the hmem plugin loaded
2. Have a conversation with enough content to trigger token overflow
3. Or manually trigger compaction via `/compact`
4. Verify:
   - [ ] The hmem-compaction agent is invoked (check logs for tool calls)
   - [ ] `hmem_list` is called first (agent reads existing entries)
   - [ ] `hmem_write` and/or `hmem_append` are called (entries created)
   - [ ] The summary message contains entry IDs and current task
   - [ ] `hmem_read` confirms entries were written correctly with L1-L5 hierarchy
   - [ ] BulkRead in next message shows the new entries with full L2 body
   - [ ] New entries (< 24h) show L1-L4 expansion

- [ ] **Step 4: Verify char limits**

1. Check that L2 content up to 300 chars is accepted
2. Check that L3 content up to 800 chars is accepted
3. Check that L4 content up to 2000 chars is accepted
4. Check that L5 has no limit

- [ ] **Step 5: Verify fallback**

1. Remove or disable the hmem plugin
2. Trigger compaction
3. Verify the default "compaction" agent is used (text summary, no tool calls)
4. Session should still work with the minimal summary

---

## Dependency Graph

```
Task 1 (char limits)  ──────────────────────────────────────────┐
Task 2 (readL1Headers) ──→ Task 3 (hmem_list tool)             │
Task 4 (loadChildrenToDepth) ──→ Task 5 (BulkRead changes)     │
                                  ↓                              │
                            Task 6 (BulkRead tests)             │
                                                                 │
Task 7 (clean index.ts) ──→ Task 8 (clean compact.ts)          │
                                                                 │
Task 9 (agent prompt) ──→ Task 10 (agent definition) ──→ Task 11 (compaction wiring)
                                                           ↓
                                                     Task 12 (config)
                                                           ↓
                                                     Task 13 (integration test)
```

**Parallelizable:**
- Tasks 1-6 (plugin changes) are independent of Tasks 9-12 (fork changes)
- Tasks 1, 2, 4 can run in parallel
- Tasks 7-8 can run in parallel with Tasks 1-6

**Sequential:**
- Task 3 depends on Task 2
- Task 5 depends on Task 4
- Task 6 depends on Task 5
- Task 8 depends on Task 7
- Task 10 depends on Task 9
- Task 11 depends on Task 10
- Task 13 depends on all other tasks
