# Heimdall CLI — npm Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Heimdall CLI from archived Go-based OpenCode (v0.0.56) to a fork of npm-based OpenCode (v1.2.24), adding hmem memory plugin, agent catalog plugin, and Heimdall branding.

**Architecture:** Hybrid fork — minimal core patches for branding (~6-8 files), features as OpenCode plugins in `packages/`. Plugins use `@opencode-ai/plugin` SDK with `Hooks.tool` for tool registration and lifecycle hooks for auto-recall/capture. hmem uses direct SQLite via `better-sqlite3`.

**Tech Stack:** TypeScript, Bun, SQLite (better-sqlite3), Zod, @opencode-ai/plugin, Vitest (OpenCode uses Vitest for testing)

**Spec:** `docs/superpowers/specs/2026-03-12-heimdall-npm-migration-design.md`

---

## File Structure

### New Files (packages/heimdall-hmem/)
```
packages/heimdall-hmem/
├── package.json                    # Package manifest
├── tsconfig.json                   # TypeScript config
├── src/
│   ├── index.ts                    # Plugin entry point (default export)
│   ├── types.ts                    # MemoryEntry, MemoryNode, WriteOptions, etc.
│   ├── schema.ts                   # SQL DDL + migrations
│   ├── store.ts                    # Store class: open/close/init
│   ├── parse.ts                    # Tab-indented content parser
│   ├── write.ts                    # Entry creation + ID generation
│   ├── read.ts                     # Single entry lookup + FTS search
│   ├── bulk-read.ts                # BulkRead V2 selection algorithm
│   ├── modify.ts                   # Update + Append operations
│   ├── delete.ts                   # Hard delete
│   ├── tags.ts                     # Tag CRUD + validation
│   ├── related.ts                  # Related entry lookup (tags + FTS)
│   ├── stats.ts                    # Stats + health check
│   ├── render.ts                   # Output formatting for LLM
│   ├── compact.ts                  # Compaction response parsing
│   ├── session-cache.ts            # Session-level entry caching
│   └── tools.ts                    # Tool definitions (hmem_search, hmem_read, hmem_write)
└── test/
    ├── store.test.ts               # Open/close/schema init
    ├── parse.test.ts               # Tab-indented parsing
    ├── write.test.ts               # Write + ID generation
    ├── read.test.ts                # Read by ID + FTS search
    ├── bulk-read.test.ts           # V2 selection modes
    ├── modify.test.ts              # Update + Append
    ├── delete.test.ts              # Hard delete
    ├── tags.test.ts                # Tag CRUD
    ├── related.test.ts             # Related entries
    ├── stats.test.ts               # Stats + health
    ├── render.test.ts              # Output formatting
    ├── compact.test.ts             # Compaction parsing
    └── session-cache.test.ts       # Cache timing logic
```

### New Files (packages/heimdall-catalog/)
```
packages/heimdall-catalog/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Plugin entry point
│   ├── types.ts                    # AgentSpec, Tier, BillingType, etc.
│   ├── catalog.ts                  # Catalog class: load, query, filter
│   ├── format.ts                   # Output formatting (ObscuredView, list)
│   └── tools.ts                    # Tool definitions (catalog_list, catalog_search)
└── test/
    ├── catalog.test.ts             # Load, query, filter tests
    └── format.test.ts              # Formatting tests
```

### Modified Files (Branding — Core Patches)
```
packages/opencode/package.json     # name, bin
packages/opencode/src/agent/       # System prompt (exact file TBD after fork)
packages/opencode/src/             # TUI title, welcome screen, URLs (exact files TBD after fork)
opencode.json                       # Plugin + command config
```

---

## Chunk 1: Repository Setup

### Task 1: Fork OpenCode and Set Up Monorepo

**Files:**
- Create: (fork from github.com/sst/opencode)
- Modify: `package.json` (workspace config)

- [ ] **Step 1: Archive current Go fork**

```bash
git checkout main
git checkout -b legacy/go-fork
git push origin legacy/go-fork
```

- [ ] **Step 2: Fork OpenCode source from GitHub**

Go to https://github.com/sst/opencode and fork to Bumblebiber/heimdall-cli.
Then reset main to the fork:

```bash
git remote add upstream https://github.com/sst/opencode.git
git fetch upstream
git checkout -b npm-migration upstream/dev
```

> **NOTE:** This is a destructive operation on `main`. Ensure `legacy/go-fork` branch is safely pushed first. The user must confirm which upstream branch/tag to use (likely `dev` or a release tag).

- [ ] **Step 3: Verify monorepo builds**

```bash
bun install
bun run build
```

Expected: Successful build of all upstream packages.

- [ ] **Step 4: Add workspace entries for Heimdall packages**

In root `package.json`, add to workspaces array:
```json
"packages/heimdall-hmem",
"packages/heimdall-catalog"
```

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: add heimdall plugin workspace entries"
```

---

### Task 2: Scaffold heimdall-hmem Package

**Files:**
- Create: `packages/heimdall-hmem/package.json`
- Create: `packages/heimdall-hmem/tsconfig.json`
- Create: `packages/heimdall-hmem/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "heimdall-hmem",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target bun",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "workspace:*",
    "@types/better-sqlite3": "^7.6.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create stub index.ts**

```typescript
import type { Plugin } from "@opencode-ai/plugin"

const hmemPlugin: Plugin = async (ctx) => {
  return {}
}

export default hmemPlugin
```

- [ ] **Step 4: Install dependencies and verify**

```bash
bun install
cd packages/heimdall-hmem && bun run build
```

Expected: Successful build producing `dist/index.js`.

- [ ] **Step 5: Commit**

```bash
git add packages/heimdall-hmem/
git commit -m "feat(hmem): scaffold heimdall-hmem plugin package"
```

---

### Task 3: Scaffold heimdall-catalog Package

**Files:**
- Create: `packages/heimdall-catalog/package.json`
- Create: `packages/heimdall-catalog/tsconfig.json`
- Create: `packages/heimdall-catalog/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "heimdall-catalog",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target bun",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "workspace:*",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create stub index.ts**

```typescript
import type { Plugin } from "@opencode-ai/plugin"

const catalogPlugin: Plugin = async (ctx) => {
  return {}
}

export default catalogPlugin
```

- [ ] **Step 3: Install and verify**

```bash
bun install
cd packages/heimdall-catalog && bun run build
```

- [ ] **Step 4: Commit**

```bash
git add packages/heimdall-catalog/
git commit -m "feat(catalog): scaffold heimdall-catalog plugin package"
```

---

## Chunk 2: hmem Core — Types, Schema, Store, Parse

### Task 4: Define TypeScript Types

**Files:**
- Create: `packages/heimdall-hmem/src/types.ts`
- Test: `packages/heimdall-hmem/test/types.test.ts` (type-level only, no runtime tests needed)

- [ ] **Step 1: Write types.ts**

Port all types from Go `internal/hmem/types.go`:

```typescript
// Agent roles (access control hierarchy)
export type AgentRole = "worker" | "al" | "pl" | "ceo"

export const ROLE_LEVEL: Record<AgentRole, number> = {
  worker: 0,
  al: 1,
  pl: 2,
  ceo: 3,
}

export function allowedRoles(role: AgentRole): AgentRole[] {
  const level = ROLE_LEVEL[role]
  return (Object.keys(ROLE_LEVEL) as AgentRole[]).filter(
    (r) => ROLE_LEVEL[r] <= level,
  )
}

// Valid memory prefixes
export const VALID_PREFIXES = [
  "P", "L", "T", "E", "D", "M", "S", "N", "H", "R", "F",
] as const
export type Prefix = (typeof VALID_PREFIXES)[number]

// Character limits by depth (index = depth - 1)
// L1: 120, L2: 200, L3: 300, L4: 400, L5: unlimited
export const CHAR_LIMITS = [120, 200, 300, 400, 0]
export const CHAR_TOLERANCE = 1.25 // 125%

export interface MemoryEntry {
  id: string             // "L0001", "P0005"
  prefix: string
  seq: number
  createdAt: string      // RFC3339
  updatedAt: string
  title: string
  level1: string
  links: string[]
  minRole: AgentRole
  obsolete: boolean
  favorite: boolean
  irrelevant: boolean
  pinned: boolean
  accessCount: number
  lastAccessed: string | null
  promoted: string
  tags: string[]
  children: MemoryNode[]
}

export interface MemoryNode {
  id: string             // "L0001.2.1"
  parentId: string
  rootId: string
  depth: number          // 1-5
  seq: number
  title: string
  content: string
  createdAt: string
  accessCount: number
  favorite: boolean
  irrelevant: boolean
  tags: string[]
  children: MemoryNode[]
}

export interface WriteOptions {
  links?: string[]
  minRole?: AgentRole
  favorite?: boolean
  pinned?: boolean
  tags?: string[]
}

export interface WriteResult {
  id: string
  timestamp: string
}

export interface AppendResult {
  count: number
  ids: string[]
}

export interface ReadOptions {
  id?: string
  prefix?: string
  search?: string
  agentRole?: AgentRole
  limit?: number
  after?: string         // ISO date
  before?: string        // ISO date
}

export interface UpdateFields {
  content?: string
  links?: string[]
  minRole?: AgentRole
  obsolete?: boolean
  favorite?: boolean
  irrelevant?: boolean
  pinned?: boolean
}

export interface RelatedEntry {
  id: string
  title: string
  createdAt: string
  tags: string[]
  matchType: "tags" | "fts"
}

export interface StatsResult {
  total: number
  byPrefix: Record<string, number>
  totalChars: number
}

export interface HealthResult {
  brokenLinks: string[]
  orphanedEntries: string[]
  staleFavorites: string[]
  brokenObsoleteChains: string[]
  tagOrphans: number
}

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

export interface ParseTreeResult {
  title: string
  level1: string
  nodes: ParsedNode[]
}

export interface ParsedNode {
  id: string
  parentId: string
  depth: number
  seq: number
  content: string
  title: string
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/heimdall-hmem && bun run build
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/heimdall-hmem/src/types.ts
git commit -m "feat(hmem): add TypeScript type definitions ported from Go"
```

---

### Task 5: Define SQL Schema

**Files:**
- Create: `packages/heimdall-hmem/src/schema.ts`

- [ ] **Step 1: Write schema.ts**

Port SQL from Go `internal/hmem/schema.go`:

```typescript
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS memories (
    id            TEXT PRIMARY KEY,
    prefix        TEXT NOT NULL,
    seq           INTEGER NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT,
    level_1       TEXT NOT NULL,
    level_2       TEXT,
    level_3       TEXT,
    level_4       TEXT,
    level_5       TEXT,
    access_count  INTEGER DEFAULT 0,
    last_accessed TEXT,
    links         TEXT,
    min_role      TEXT DEFAULT 'worker',
    obsolete      INTEGER DEFAULT 0,
    favorite      INTEGER DEFAULT 0,
    irrelevant    INTEGER DEFAULT 0,
    title         TEXT,
    pinned        INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prefix ON memories(prefix);
CREATE INDEX IF NOT EXISTS idx_created ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_access ON memories(access_count);
CREATE INDEX IF NOT EXISTS idx_role ON memories(min_role);

CREATE TABLE IF NOT EXISTS memory_nodes (
    id            TEXT PRIMARY KEY,
    parent_id     TEXT NOT NULL,
    root_id       TEXT NOT NULL,
    depth         INTEGER NOT NULL,
    seq           INTEGER NOT NULL,
    content       TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT,
    access_count  INTEGER DEFAULT 0,
    last_accessed TEXT,
    title         TEXT,
    favorite      INTEGER DEFAULT 0,
    irrelevant    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON memory_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_root   ON memory_nodes(root_id);

CREATE TABLE IF NOT EXISTS schema_version (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS hmem_fts USING fts5(
    level_1,
    node_content,
    content='',
    tokenize='unicode61'
);
CREATE TABLE IF NOT EXISTS hmem_fts_rowid_map (
    fts_rowid INTEGER PRIMARY KEY,
    root_id   TEXT NOT NULL,
    node_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_fts_rm_root ON hmem_fts_rowid_map(root_id);
CREATE INDEX IF NOT EXISTS idx_fts_rm_node ON hmem_fts_rowid_map(node_id);

CREATE TRIGGER IF NOT EXISTS hmem_fts_mem_ai
AFTER INSERT ON memories WHEN new.seq > 0
BEGIN
    INSERT INTO hmem_fts(level_1, node_content) VALUES (coalesce(new.level_1,''),'');
    INSERT INTO hmem_fts_rowid_map(fts_rowid, root_id, node_id)
        VALUES (last_insert_rowid(), new.id, NULL);
END;

CREATE TRIGGER IF NOT EXISTS hmem_fts_node_ai
AFTER INSERT ON memory_nodes
BEGIN
    INSERT INTO hmem_fts(level_1, node_content) VALUES ('', coalesce(new.content,''));
    INSERT INTO hmem_fts_rowid_map(fts_rowid, root_id, node_id)
        VALUES (last_insert_rowid(), new.root_id, new.id);
END;

CREATE TRIGGER IF NOT EXISTS hmem_fts_mem_au
AFTER UPDATE OF level_1 ON memories WHEN new.seq > 0
BEGIN
    INSERT INTO hmem_fts(hmem_fts, rowid, level_1, node_content)
        VALUES ('delete', (SELECT fts_rowid FROM hmem_fts_rowid_map WHERE root_id=old.id AND node_id IS NULL), old.level_1,'');
    INSERT INTO hmem_fts(level_1, node_content) VALUES (coalesce(new.level_1,''),'');
    UPDATE hmem_fts_rowid_map SET fts_rowid=last_insert_rowid()
        WHERE root_id=new.id AND node_id IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS hmem_fts_mem_bd
BEFORE DELETE ON memories
BEGIN
    INSERT INTO hmem_fts(hmem_fts, rowid, level_1, node_content)
        VALUES ('delete', (SELECT fts_rowid FROM hmem_fts_rowid_map WHERE root_id=old.id AND node_id IS NULL), old.level_1,'');
    DELETE FROM hmem_fts_rowid_map WHERE root_id=old.id;
END;

CREATE TRIGGER IF NOT EXISTS hmem_fts_node_bd
BEFORE DELETE ON memory_nodes
BEGIN
    INSERT INTO hmem_fts(hmem_fts, rowid, level_1, node_content)
        VALUES ('delete', (SELECT fts_rowid FROM hmem_fts_rowid_map WHERE node_id=old.id),'', old.content);
    DELETE FROM hmem_fts_rowid_map WHERE node_id=old.id;
END;

CREATE TABLE IF NOT EXISTS memory_tags (
    entry_id TEXT NOT NULL,
    tag      TEXT NOT NULL,
    PRIMARY KEY (entry_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON memory_tags(tag);
`

export const MIGRATIONS: string[] = [
  "ALTER TABLE memories ADD COLUMN min_role TEXT DEFAULT 'worker'",
  "ALTER TABLE memories ADD COLUMN obsolete INTEGER DEFAULT 0",
  "ALTER TABLE memories ADD COLUMN favorite INTEGER DEFAULT 0",
  "ALTER TABLE memories ADD COLUMN title TEXT",
  "ALTER TABLE memory_nodes ADD COLUMN title TEXT",
  "ALTER TABLE memories ADD COLUMN irrelevant INTEGER DEFAULT 0",
  "ALTER TABLE memory_nodes ADD COLUMN favorite INTEGER DEFAULT 0",
  "ALTER TABLE memory_nodes ADD COLUMN irrelevant INTEGER DEFAULT 0",
  "CREATE TABLE IF NOT EXISTS memory_tags (entry_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (entry_id, tag))",
  "CREATE INDEX IF NOT EXISTS idx_tags_tag ON memory_tags(tag)",
  "ALTER TABLE memories ADD COLUMN pinned INTEGER DEFAULT 0",
  "ALTER TABLE memories ADD COLUMN updated_at TEXT",
  "ALTER TABLE memory_nodes ADD COLUMN updated_at TEXT",
]
```

- [ ] **Step 2: Commit**

```bash
git add packages/heimdall-hmem/src/schema.ts
git commit -m "feat(hmem): add SQL schema and migrations ported from Go"
```

---

### Task 6: Implement Store (Open/Close)

**Files:**
- Create: `packages/heimdall-hmem/src/store.ts`
- Create: `packages/heimdall-hmem/test/store.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/store.test.ts
import { describe, it, expect, afterEach } from "vitest"
import { Store } from "../src/store"
import { existsSync, mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("Store", () => {
  let store: Store
  let tempDir: string

  afterEach(() => {
    store?.close()
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  })

  it("creates .hmem file on open", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "hmem-"))
    const dbPath = join(tempDir, "test.hmem")
    store = await Store.open(dbPath)
    expect(existsSync(dbPath)).toBe(true)
  })

  it("is idempotent on multiple opens", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "hmem-"))
    const dbPath = join(tempDir, "test.hmem")
    const store1 = await Store.open(dbPath)
    store1.close()
    store = await Store.open(dbPath)
    expect(existsSync(dbPath)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/heimdall-hmem && bun run test
```

Expected: FAIL — `Store` not found.

- [ ] **Step 3: Implement store.ts**

```typescript
// src/store.ts
import Database from "better-sqlite3"
import { SCHEMA_DDL, MIGRATIONS } from "./schema"
import { SessionCache } from "./session-cache"

export class Store {
  private db: Database.Database
  readonly path: string
  readonly cache: SessionCache

  private constructor(db: Database.Database, path: string) {
    this.db = db
    this.path = path
    this.cache = new SessionCache()
  }

  static async open(hmemPath: string): Promise<Store> {
    // Ensure parent directory exists (Go: os.MkdirAll)
    const { mkdirSync } = await import("fs")
    const { dirname } = await import("path")
    mkdirSync(dirname(hmemPath), { recursive: true })

    const db = new Database(hmemPath)
    db.pragma("journal_mode = WAL")
    // Single writer — SQLite does this naturally with WAL

    const store = new Store(db, hmemPath)
    store.initSchema()
    return store
  }

  private initSchema(): void {
    this.db.exec(SCHEMA_DDL)
    for (const migration of MIGRATIONS) {
      try {
        this.db.exec(migration)
      } catch {
        // Idempotent — column may already exist
      }
    }
  }

  close(): void {
    this.db.close()
  }

  /** Expose db for internal use by other modules */
  get database(): Database.Database {
    return this.db
  }
}
```

- [ ] **Step 4: Create minimal session-cache.ts stub** (needed by store.ts)

```typescript
// src/session-cache.ts
export class SessionCache {
  private entries = new Map<string, number>()

  record(id: string): void {
    if (!this.entries.has(id)) {
      this.entries.set(id, Date.now())
    }
  }

  recordAll(ids: string[]): void {
    for (const id of ids) this.record(id)
  }

  isHidden(id: string): boolean {
    const seen = this.entries.get(id)
    if (!seen) return false
    return Date.now() - seen < 5 * 60 * 1000 // 5 min
  }

  isCached(id: string): boolean {
    const seen = this.entries.get(id)
    if (!seen) return false
    const age = Date.now() - seen
    return age >= 5 * 60 * 1000 && age < 30 * 60 * 1000 // 5-30 min
  }

  hiddenAndCachedSets(): { hidden: Set<string>; cached: Set<string> } {
    const hidden = new Set<string>()
    const cached = new Set<string>()
    const now = Date.now()
    for (const [id, seen] of this.entries) {
      const age = now - seen
      if (age < 5 * 60 * 1000) hidden.add(id)
      else if (age < 30 * 60 * 1000) cached.add(id)
    }
    return { hidden, cached }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/heimdall-hmem && bun run test
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/heimdall-hmem/src/store.ts packages/heimdall-hmem/src/session-cache.ts packages/heimdall-hmem/test/store.test.ts
git commit -m "feat(hmem): implement Store open/close with WAL mode"
```

---

### Task 7: Implement Parse (Tab-Indented Content)

**Files:**
- Create: `packages/heimdall-hmem/src/parse.ts`
- Create: `packages/heimdall-hmem/test/parse.test.ts`

- [ ] **Step 1: Write the failing tests**

Port from Go `parse_test.go`:

```typescript
// test/parse.test.ts
import { describe, it, expect } from "vitest"
import { parseTree, parseRelativeTree, autoExtractTitle } from "../src/parse"

describe("parseTree", () => {
  it("parses single line", () => {
    const result = parseTree("Hello world", "L0001")
    expect(result.level1).toBe("Hello world")
    expect(result.title).toBeTruthy()
    expect(result.nodes).toHaveLength(0)
  })

  it("parses with children", () => {
    const content = "Root content\n\tChild one\n\tChild two\n\t\tGrandchild"
    const result = parseTree(content, "L0001")
    expect(result.level1).toBe("Root content")
    expect(result.nodes).toHaveLength(3)
    // Child one
    expect(result.nodes[0].depth).toBe(2)
    expect(result.nodes[0].parentId).toBe("L0001")
    expect(result.nodes[0].id).toBe("L0001.1")
    // Child two
    expect(result.nodes[1].depth).toBe(2)
    expect(result.nodes[1].id).toBe("L0001.2")
    // Grandchild
    expect(result.nodes[2].depth).toBe(3)
    expect(result.nodes[2].parentId).toBe("L0001.2")
    expect(result.nodes[2].id).toBe("L0001.2.1")
  })

  it("extracts title from two L1 lines", () => {
    const content = "Title line\nSecond L1 line"
    const result = parseTree(content, "L0001")
    expect(result.title).toBe("Title line")
    expect(result.level1).toContain("Second L1 line")
  })

  it("handles multiple siblings", () => {
    const content = "Root\n\tA\n\tB\n\tC"
    const result = parseTree(content, "L0001")
    const children = result.nodes.filter((n) => n.depth === 2)
    expect(children).toHaveLength(3)
    expect(children[0].seq).toBe(1)
    expect(children[1].seq).toBe(2)
    expect(children[2].seq).toBe(3)
  })
})

describe("parseRelativeTree", () => {
  it("parses relative to parent", () => {
    const content = "Direct child\n\tGrandchild"
    const nodes = parseRelativeTree(content, "L0001.2", 2, 3)
    expect(nodes).toHaveLength(2)
    expect(nodes[0].depth).toBe(3) // parent depth + 1
    expect(nodes[0].seq).toBe(3) // startSeq
    expect(nodes[0].parentId).toBe("L0001.2")
    expect(nodes[1].depth).toBe(4)
  })
})

describe("autoExtractTitle", () => {
  it("extracts before separator", () => {
    expect(autoExtractTitle("Project goals. Detailed description")).toBe("Project goals")
  })

  it("truncates long text", () => {
    const long = "A".repeat(100)
    const title = autoExtractTitle(long)
    expect(title.length).toBeLessThanOrEqual(41) // 40 + "…"
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/heimdall-hmem && bun run test -- test/parse.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement parse.ts**

```typescript
// src/parse.ts
import type { ParseTreeResult, ParsedNode } from "./types"

const MAX_DEPTH = 5

export function autoExtractTitle(text: string): string {
  const separators = [". ", ": ", " — ", " - "]
  let bestPos = -1
  for (const sep of separators) {
    const pos = text.indexOf(sep)
    if (pos > 0 && pos < 60) {
      if (bestPos === -1 || pos < bestPos) bestPos = pos
    }
  }
  if (bestPos > 0) return text.slice(0, bestPos)
  if (text.length <= 40) return text
  return text.slice(0, 40) + "\u2026"
}

function detectIndentUnit(lines: string[]): { type: "tab" | "space"; size: number } {
  for (const line of lines) {
    if (line.startsWith("\t")) return { type: "tab", size: 1 }
  }
  // Detect space indent unit
  for (const line of lines) {
    const match = line.match(/^( +)/)
    if (match) return { type: "space", size: match[1].length }
  }
  return { type: "tab", size: 1 }
}

function getDepth(line: string, indent: { type: "tab" | "space"; size: number }): number {
  if (indent.type === "tab") {
    let count = 0
    for (const ch of line) {
      if (ch === "\t") count++
      else break
    }
    return count
  }
  const match = line.match(/^( +)/)
  if (!match) return 0
  return Math.floor(match[1].length / indent.size)
}

function stripIndent(line: string, indent: { type: "tab" | "space"; size: number }, depth: number): string {
  if (indent.type === "tab") return line.slice(depth)
  return line.slice(depth * indent.size)
}

export function parseTree(content: string, rootId: string): ParseTreeResult {
  const lines = content.split("\n").filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { title: "", level1: "", nodes: [] }

  const indent = detectIndentUnit(lines)

  // Collect L1 lines (depth 0)
  const l1Lines: string[] = []
  const childLines: { depth: number; text: string }[] = []

  for (const line of lines) {
    const d = getDepth(line, indent)
    if (d === 0) {
      l1Lines.push(line.trim())
    } else {
      childLines.push({ depth: Math.min(d, MAX_DEPTH - 1), text: stripIndent(line, indent, d).trim() })
    }
  }

  // Title + level1
  let title: string
  let level1: string
  if (l1Lines.length >= 2) {
    title = l1Lines[0]
    level1 = l1Lines.slice(1).join(" | ") // Go: strings.Join(l1Lines[1:], " | ")
  } else {
    level1 = l1Lines[0] || ""
    title = autoExtractTitle(level1)
  }

  // Build nodes with parent tracking
  const nodes: ParsedNode[] = []
  const parentStack: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }]
  const seqCounters = new Map<string, number>() // parentId → next seq

  for (const { depth, text } of childLines) {
    // Pop stack until we find the parent
    while (parentStack.length > 1 && parentStack[parentStack.length - 1].depth >= depth + 1) {
      parentStack.pop()
    }
    const parent = parentStack[parentStack.length - 1]

    const nextSeq = (seqCounters.get(parent.id) ?? 0) + 1
    seqCounters.set(parent.id, nextSeq)

    const nodeId = `${parent.id}.${nextSeq}`

    nodes.push({
      id: nodeId,
      parentId: parent.id,
      depth: depth + 1, // depth 0 = L1, depth 1 = L2, etc.
      seq: nextSeq,
      content: text,
      title: autoExtractTitle(text),
    })

    parentStack.push({ id: nodeId, depth: depth + 1 })
  }

  return { title, level1, nodes }
}

export function parseRelativeTree(
  content: string,
  parentId: string,
  parentDepth: number,
  startSeq: number,
): ParsedNode[] {
  const lines = content.split("\n").filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []

  const indent = detectIndentUnit(lines)
  const nodes: ParsedNode[] = []
  const parentStack: { id: string; depth: number }[] = [{ id: parentId, depth: parentDepth }]
  const seqCounters = new Map<string, number>()
  seqCounters.set(parentId, startSeq - 1) // so first increment gives startSeq

  for (const line of lines) {
    const relDepth = getDepth(line, indent)
    const absDepth = parentDepth + relDepth + 1
    const text = stripIndent(line, indent, relDepth).trim()

    // Pop stack to find parent
    while (parentStack.length > 1 && parentStack[parentStack.length - 1].depth >= absDepth) {
      parentStack.pop()
    }
    const parent = parentStack[parentStack.length - 1]

    const nextSeq = (seqCounters.get(parent.id) ?? 0) + 1
    seqCounters.set(parent.id, nextSeq)

    const nodeId = `${parent.id}.${nextSeq}`

    nodes.push({
      id: nodeId,
      parentId: parent.id,
      depth: absDepth,
      seq: nextSeq,
      content: text,
      title: autoExtractTitle(text),
    })

    parentStack.push({ id: nodeId, depth: absDepth })
  }

  return nodes
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/heimdall-hmem && bun run test -- test/parse.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/heimdall-hmem/src/parse.ts packages/heimdall-hmem/test/parse.test.ts
git commit -m "feat(hmem): implement tab-indented content parser"
```

---

## Chunk 3: hmem CRUD — Write, Read, BulkRead

### Task 8: Implement Write (Entry Creation + ID Generation)

**Files:**
- Create: `packages/heimdall-hmem/src/write.ts`
- Create: `packages/heimdall-hmem/test/write.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/write.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("write", () => {
  let store: Store
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "hmem-"))
    store = await Store.open(join(tempDir, "test.hmem"))
  })

  afterEach(() => {
    store.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("creates entry with generated ID", async () => {
    const result = write(store, "L", "Test entry content")
    expect(result.id).toBe("L0001")
    expect(result.timestamp).toBeTruthy()
  })

  it("rejects invalid prefix", () => {
    expect(() => write(store, "X", "content")).toThrow()
  })

  it("increments sequence per prefix", () => {
    const r1 = write(store, "L", "First")
    const r2 = write(store, "L", "Second")
    expect(r1.id).toBe("L0001")
    expect(r2.id).toBe("L0002")
  })

  it("keeps independent sequences per prefix", () => {
    const l1 = write(store, "L", "Learning")
    const p1 = write(store, "P", "Project")
    expect(l1.id).toBe("L0001")
    expect(p1.id).toBe("P0001")
  })

  it("writes with children from tab-indented content", () => {
    const content = "Root content\n\tChild one\n\tChild two"
    const result = write(store, "L", content)
    expect(result.id).toBe("L0001")
    // Verify children exist by reading back
    const row = store.database.prepare("SELECT COUNT(*) as c FROM memory_nodes WHERE root_id = ?").get(result.id) as any
    expect(row.c).toBe(2)
  })

  it("allows unlimited L5 content", () => {
    const longContent = "Title\n\tL2\n\t\tL3\n\t\t\tL4\n\t\t\t\t" + "A".repeat(10000)
    expect(() => write(store, "L", longContent)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/heimdall-hmem && bun run test -- test/write.test.ts
```

- [ ] **Step 3: Implement write.ts**

```typescript
// src/write.ts
import type { Store } from "./store"
import type { WriteOptions, WriteResult } from "./types"
import { VALID_PREFIXES, CHAR_LIMITS, CHAR_TOLERANCE } from "./types"
import { parseTree } from "./parse"

function nextSeq(store: Store, prefix: string): number {
  const row = store.database
    .prepare("SELECT MAX(seq) as m FROM memories WHERE prefix = ?")
    .get(prefix) as { m: number | null } | undefined
  return (row?.m ?? 0) + 1
}

function checkCharLimit(content: string, depth: number): void {
  const limit = CHAR_LIMITS[depth] ?? 0
  if (limit === 0) return // unlimited (L5)
  const tolerance = Math.floor(limit * CHAR_TOLERANCE)
  if (content.length > tolerance) {
    throw new Error(
      `Content at depth ${depth + 1} exceeds limit: ${content.length} > ${tolerance} (limit: ${limit})`,
    )
  }
}

export function write(
  store: Store,
  prefix: string,
  content: string,
  opts: WriteOptions = {},
): WriteResult {
  const upper = prefix.toUpperCase()
  if (!VALID_PREFIXES.includes(upper as any)) {
    throw new Error(`Invalid prefix: ${prefix}. Valid: ${VALID_PREFIXES.join(", ")}`)
  }

  const seq = nextSeq(store, upper)
  const id = `${upper}${String(seq).padStart(4, "0")}`
  const now = new Date().toISOString()

  const parsed = parseTree(content, id)

  // Check char limits on L1
  checkCharLimit(parsed.level1, 0)

  // Check char limits on children
  for (const node of parsed.nodes) {
    checkCharLimit(node.content, node.depth - 1)
  }

  const db = store.database

  const insertEntry = db.prepare(`
    INSERT INTO memories (id, prefix, seq, created_at, updated_at, level_1, title, links, min_role, favorite, pinned)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertNode = db.prepare(`
    INSERT INTO memory_nodes (id, parent_id, root_id, depth, seq, content, created_at, updated_at, title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertTag = db.prepare(`
    INSERT INTO memory_tags (entry_id, tag) VALUES (?, ?)
  `)

  const transaction = db.transaction(() => {
    insertEntry.run(
      id,
      upper,
      seq,
      now,
      now,
      parsed.level1,
      parsed.title,
      JSON.stringify(opts.links ?? []),
      opts.minRole ?? "worker",
      opts.favorite ? 1 : 0,
      opts.pinned ? 1 : 0,
    )

    for (const node of parsed.nodes) {
      insertNode.run(node.id, node.parentId, id, node.depth, node.seq, node.content, now, now, node.title)
    }

    // Tags: placed on first child if children exist, else on root
    if (opts.tags && opts.tags.length > 0) {
      const tagTarget = parsed.nodes.length > 0 ? parsed.nodes[0].id : id
      for (const tag of opts.tags) {
        insertTag.run(tagTarget, tag.toLowerCase())
      }
    }
  })

  transaction()

  return { id, timestamp: now }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/heimdall-hmem && bun run test -- test/write.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/heimdall-hmem/src/write.ts packages/heimdall-hmem/test/write.test.ts
git commit -m "feat(hmem): implement write with ID generation and char limits"
```

---

### Task 9: Implement Read (Single Entry + FTS Search)

**Files:**
- Create: `packages/heimdall-hmem/src/read.ts`
- Create: `packages/heimdall-hmem/test/read.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/read.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { read } from "../src/read"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("read", () => {
  let store: Store
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "hmem-"))
    store = await Store.open(join(tempDir, "test.hmem"))
  })

  afterEach(() => {
    store.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("reads entry by ID with children", () => {
    write(store, "L", "Root content\n\tChild one\n\tChild two")
    const entries = read(store, { id: "L0001" })
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe("L0001")
    expect(entries[0].level1).toBe("Root content")
    expect(entries[0].children).toHaveLength(2)
  })

  it("reads node by compound ID", () => {
    write(store, "L", "Root\n\tChild content here")
    const entries = read(store, { id: "L0001.1" })
    expect(entries).toHaveLength(1)
    expect(entries[0].level1).toContain("Child content here")
  })

  it("searches via FTS", () => {
    write(store, "L", "TypeScript programming guide")
    write(store, "L", "Python data science tutorial")
    const entries = read(store, { search: "TypeScript" })
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(entries[0].level1).toContain("TypeScript")
  })

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      write(store, "L", `Entry number ${i}`)
    }
    const entries = read(store, { limit: 2 })
    expect(entries).toHaveLength(2)
  })

  it("bumps access count on read", () => {
    write(store, "L", "Access tracking test")
    read(store, { id: "L0001" })
    read(store, { id: "L0001" })
    const entries = read(store, { id: "L0001" })
    expect(entries[0].accessCount).toBe(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/heimdall-hmem && bun run test -- test/read.test.ts
```

- [ ] **Step 3: Implement read.ts**

```typescript
// src/read.ts
import type { Store } from "./store"
import type { MemoryEntry, MemoryNode, ReadOptions } from "./types"

function scanEntry(row: any): MemoryEntry {
  return {
    id: row.id,
    prefix: row.prefix,
    seq: row.seq,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? "",
    title: row.title ?? "",
    level1: row.level_1,
    links: row.links ? JSON.parse(row.links) : [],
    minRole: row.min_role ?? "worker",
    obsolete: !!row.obsolete,
    favorite: !!row.favorite,
    irrelevant: !!row.irrelevant,
    pinned: !!row.pinned,
    accessCount: row.access_count ?? 0,
    lastAccessed: row.last_accessed ?? null,
    promoted: row.favorite || row.pinned ? "favorite" : "",
    tags: [],
    children: [],
  }
}

function scanNode(row: any): MemoryNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    rootId: row.root_id,
    depth: row.depth,
    seq: row.seq,
    title: row.title ?? "",
    content: row.content,
    createdAt: row.created_at,
    accessCount: row.access_count ?? 0,
    favorite: !!row.favorite,
    irrelevant: !!row.irrelevant,
    tags: [],
    children: [],
  }
}

function loadDirectChildren(store: Store, parentId: string): MemoryNode[] {
  const rows = store.database
    .prepare("SELECT * FROM memory_nodes WHERE parent_id = ? ORDER BY seq ASC")
    .all(parentId) as any[]
  return rows.map(scanNode)
}

function bumpAccess(store: Store, id: string): void {
  try {
    store.database
      .prepare("UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?")
      .run(new Date().toISOString(), id)
  } catch {
    // Non-fatal
  }
}

function readRootById(store: Store, id: string): MemoryEntry[] {
  const row = store.database.prepare("SELECT * FROM memories WHERE id = ?").get(id) as any
  if (!row) return []
  const entry = scanEntry(row)
  entry.children = loadDirectChildren(store, id)
  bumpAccess(store, id)
  return [entry]
}

function readNodeById(store: Store, id: string): MemoryEntry[] {
  const row = store.database.prepare("SELECT * FROM memory_nodes WHERE id = ?").get(id) as any
  if (!row) return []
  const node = scanNode(row)
  const children = loadDirectChildren(store, id)

  // Wrap in synthetic MemoryEntry
  const entry: MemoryEntry = {
    id: node.id,
    prefix: "",
    seq: 0,
    createdAt: node.createdAt,
    updatedAt: "",
    title: node.title,
    level1: `[${node.id}] ${node.content}`,
    links: [],
    minRole: "worker",
    obsolete: false,
    favorite: node.favorite,
    irrelevant: node.irrelevant,
    pinned: false,
    accessCount: node.accessCount,
    lastAccessed: null,
    promoted: "",
    tags: [],
    children,
  }
  return [entry]
}

function readBySearch(store: Store, query: string, limit: number): MemoryEntry[] {
  const rows = store.database
    .prepare(`
      SELECT DISTINCT m.root_id
      FROM hmem_fts f
      JOIN hmem_fts_rowid_map m ON m.fts_rowid = f.rowid
      WHERE hmem_fts MATCH ?
      LIMIT ?
    `)
    .all(query, limit) as any[]

  const entries: MemoryEntry[] = []
  for (const row of rows) {
    const found = readRootById(store, row.root_id)
    entries.push(...found)
  }
  return entries
}

export function read(store: Store, opts: ReadOptions = {}): MemoryEntry[] {
  if (opts.id) {
    return opts.id.includes(".")
      ? readNodeById(store, opts.id)
      : readRootById(store, opts.id)
  }

  if (opts.search) {
    return readBySearch(store, opts.search, opts.limit ?? 20)
  }

  // Default: bulk read (will be replaced by bulk-read.ts)
  const limit = opts.limit ?? 100
  const rows = store.database
    .prepare("SELECT * FROM memories WHERE seq > 0 ORDER BY created_at DESC LIMIT ?")
    .all(limit) as any[]

  return rows.map((row) => {
    const entry = scanEntry(row)
    entry.children = loadDirectChildren(store, entry.id)
    return entry
  })
}

// Export helpers for reuse in bulk-read
export { scanEntry, scanNode, loadDirectChildren, bumpAccess }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/heimdall-hmem && bun run test -- test/read.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/heimdall-hmem/src/read.ts packages/heimdall-hmem/test/read.test.ts
git commit -m "feat(hmem): implement read by ID, node ID, and FTS search"
```

---

### Task 10: Implement BulkRead V2

**Files:**
- Create: `packages/heimdall-hmem/src/bulk-read.ts`
- Create: `packages/heimdall-hmem/test/bulk-read.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/bulk-read.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { bulkReadV2 } from "../src/bulk-read"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("bulkReadV2", () => {
  let store: Store
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "hmem-"))
    store = await Store.open(join(tempDir, "test.hmem"))
  })

  afterEach(() => {
    store.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("includes favorites always", () => {
    write(store, "L", "Normal entry")
    write(store, "L", "Favorite entry", { favorite: true })
    // Record all in cache to test favorites bypass
    store.cache.recordAll(["L0001", "L0002"])
    // Wait — can't wait in tests. Instead just verify favorites are in result
    const entries = bulkReadV2(store, {})
    const ids = entries.map((e) => e.id)
    expect(ids).toContain("L0002")
  })

  it("filters obsolete entries", () => {
    write(store, "L", "Active entry")
    write(store, "L", "Obsolete entry")
    store.database.prepare("UPDATE memories SET obsolete = 1 WHERE id = ?").run("L0002")
    const entries = bulkReadV2(store, {})
    const ids = entries.map((e) => e.id)
    expect(ids).not.toContain("L0002")
  })

  it("hides irrelevant entries", () => {
    write(store, "L", "Relevant entry")
    write(store, "L", "Irrelevant entry")
    store.database.prepare("UPDATE memories SET irrelevant = 1 WHERE id = ?").run("L0002")
    const entries = bulkReadV2(store, {})
    const ids = entries.map((e) => e.id)
    expect(ids).not.toContain("L0002")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/heimdall-hmem && bun run test -- test/bulk-read.test.ts
```

- [ ] **Step 3: Implement bulk-read.ts**

```typescript
// src/bulk-read.ts
import type { Store } from "./store"
import type { MemoryEntry, ReadOptions } from "./types"
import { ROLE_LEVEL, allowedRoles } from "./types"
import { scanEntry, loadDirectChildren } from "./read"

function weightedAccessScore(entry: MemoryEntry): number {
  const created = new Date(entry.createdAt).getTime()
  const ageDays = (Date.now() - created) / (1000 * 60 * 60 * 24)
  return entry.accessCount / Math.log2(ageDays + 2)
}

function readBulkAll(store: Store, opts: ReadOptions): MemoryEntry[] {
  let sql = "SELECT * FROM memories WHERE seq > 0"
  const params: any[] = []

  if (opts.prefix) {
    sql += " AND prefix = ?"
    params.push(opts.prefix.toUpperCase())
  }
  if (opts.agentRole) {
    const roles = allowedRoles(opts.agentRole)
    sql += ` AND min_role IN (${roles.map(() => "?").join(",")})`
    params.push(...roles)
  }
  if (opts.after) {
    sql += " AND created_at > ?"
    params.push(opts.after)
  }
  if (opts.before) {
    sql += " AND created_at < ?"
    params.push(opts.before)
  }

  sql += " ORDER BY created_at DESC"

  const rows = store.database.prepare(sql).all(...params) as any[]
  return rows.map(scanEntry)
}

export function bulkReadV2(store: Store, opts: ReadOptions): MemoryEntry[] {
  // 1. Fetch all matching entries
  const all = readBulkAll(store, opts)

  // 2-3. Filter irrelevant + obsolete
  const active = all.filter((e) => !e.irrelevant && !e.obsolete)

  // 4. Group by prefix
  const byPrefix = new Map<string, MemoryEntry[]>()
  for (const e of active) {
    const group = byPrefix.get(e.prefix) ?? []
    group.push(e)
    byPrefix.set(e.prefix, group)
  }

  // 5. Per-prefix selection: newest 60% + most-accessed 40%
  const selected = new Set<string>()
  for (const [, group] of byPrefix) {
    const newestCount = Math.ceil(group.length * 0.6)
    // Already sorted by created_at DESC
    for (let i = 0; i < newestCount && i < group.length; i++) {
      selected.add(group[i].id)
    }
    // Most-accessed 40%
    const accessCount = Math.ceil(group.length * 0.4)
    const byAccess = [...group].sort((a, b) => weightedAccessScore(b) - weightedAccessScore(a))
    for (let i = 0; i < accessCount && i < byAccess.length; i++) {
      selected.add(byAccess[i].id)
    }
  }

  // 6. Always include favorites/pinned
  for (const e of all) {
    if (e.favorite || e.pinned) selected.add(e.id)
  }

  // 7. Session cache awareness
  const { hidden, cached } = store.cache.hiddenAndCachedSets()

  const result: MemoryEntry[] = []
  for (const e of all) {
    if (!selected.has(e.id)) continue
    if (hidden.has(e.id) && !e.favorite && !e.pinned) continue

    if (cached.has(e.id) && !e.favorite && !e.pinned) {
      // Title-only (no children)
      result.push(e)
    } else {
      // Full entry with children
      e.children = loadDirectChildren(store, e.id)
      result.push(e)
    }
  }

  // 9. Record in session cache
  store.cache.recordAll(result.map((e) => e.id))

  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/heimdall-hmem && bun run test -- test/bulk-read.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/heimdall-hmem/src/bulk-read.ts packages/heimdall-hmem/test/bulk-read.test.ts
git commit -m "feat(hmem): implement BulkRead V2 selection algorithm"
```

---

## Chunk 4: hmem Operations — Modify, Delete, Tags, Related, Stats, Render, Compact

### Task 11: Implement Modify (Update + Append)

**Files:**
- Create: `packages/heimdall-hmem/src/modify.ts`
- Create: `packages/heimdall-hmem/test/modify.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/modify.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { read } from "../src/read"
import { update, append } from "../src/modify"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("modify", () => {
  let store: Store
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "hmem-"))
    store = await Store.open(join(tempDir, "test.hmem"))
  })

  afterEach(() => {
    store.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("updates favorite flag", () => {
    write(store, "L", "Test entry")
    update(store, "L0001", { favorite: true })
    const [entry] = read(store, { id: "L0001" })
    expect(entry.favorite).toBe(true)
  })

  it("updates obsolete and content", () => {
    write(store, "L", "Original content")
    update(store, "L0001", { obsolete: true, content: "Updated content" })
    const [entry] = read(store, { id: "L0001" })
    expect(entry.obsolete).toBe(true)
    expect(entry.level1).toBe("Updated content")
  })

  it("updates node favorite", () => {
    write(store, "L", "Root\n\tChild")
    update(store, "L0001.1", { favorite: true })
    const row = store.database.prepare("SELECT favorite FROM memory_nodes WHERE id = ?").get("L0001.1") as any
    expect(row.favorite).toBe(1)
  })

  it("appends children to root", () => {
    write(store, "L", "Root entry")
    const result = append(store, "L0001", "New child\n\tGrandchild")
    expect(result.count).toBe(2)
    expect(result.ids).toHaveLength(2)
    expect(result.ids[0]).toBe("L0001.1")
  })

  it("appends to existing children", () => {
    write(store, "L", "Root\n\tExisting child")
    const result = append(store, "L0001", "Another child")
    expect(result.ids[0]).toBe("L0001.2") // seq continues after existing
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/heimdall-hmem && bun run test -- test/modify.test.ts
```

- [ ] **Step 3: Implement modify.ts**

```typescript
// src/modify.ts
import type { Store } from "./store"
import type { UpdateFields, AppendResult } from "./types"
import { parseRelativeTree } from "./parse"

function rootIdFrom(id: string): string {
  const dot = id.indexOf(".")
  return dot === -1 ? id : id.slice(0, dot)
}

function getParentDepth(store: Store, parentId: string): number {
  if (!parentId.includes(".")) return 1 // root
  const row = store.database
    .prepare("SELECT depth FROM memory_nodes WHERE id = ?")
    .get(parentId) as { depth: number } | undefined
  return row?.depth ?? 1
}

export function update(store: Store, id: string, fields: UpdateFields): void {
  const now = new Date().toISOString()
  const isNode = id.includes(".")

  if (isNode) {
    if (fields.content !== undefined) {
      store.database
        .prepare("UPDATE memory_nodes SET content = ?, updated_at = ? WHERE id = ?")
        .run(fields.content, now, id)
    }
    if (fields.favorite !== undefined) {
      store.database
        .prepare("UPDATE memory_nodes SET favorite = ? WHERE id = ?")
        .run(fields.favorite ? 1 : 0, id)
    }
    if (fields.irrelevant !== undefined) {
      store.database
        .prepare("UPDATE memory_nodes SET irrelevant = ? WHERE id = ?")
        .run(fields.irrelevant ? 1 : 0, id)
    }
  } else {
    if (fields.content !== undefined) {
      store.database
        .prepare("UPDATE memories SET level_1 = ?, updated_at = ? WHERE id = ?")
        .run(fields.content, now, id)
    }
    if (fields.favorite !== undefined) {
      store.database
        .prepare("UPDATE memories SET favorite = ? WHERE id = ?")
        .run(fields.favorite ? 1 : 0, id)
    }
    if (fields.obsolete !== undefined) {
      store.database
        .prepare("UPDATE memories SET obsolete = ? WHERE id = ?")
        .run(fields.obsolete ? 1 : 0, id)
    }
    if (fields.irrelevant !== undefined) {
      store.database
        .prepare("UPDATE memories SET irrelevant = ? WHERE id = ?")
        .run(fields.irrelevant ? 1 : 0, id)
    }
    if (fields.pinned !== undefined) {
      store.database
        .prepare("UPDATE memories SET pinned = ? WHERE id = ?")
        .run(fields.pinned ? 1 : 0, id)
    }
    if (fields.links !== undefined) {
      store.database
        .prepare("UPDATE memories SET links = ? WHERE id = ?")
        .run(JSON.stringify(fields.links), id)
    }
    if (fields.minRole !== undefined) {
      store.database
        .prepare("UPDATE memories SET min_role = ? WHERE id = ?")
        .run(fields.minRole, id)
    }
  }
}

export function append(store: Store, parentId: string, content: string): AppendResult {
  const rootId = rootIdFrom(parentId)
  const parentDepth = getParentDepth(store, parentId)

  // Find next sibling seq
  const row = store.database
    .prepare("SELECT MAX(seq) as m FROM memory_nodes WHERE parent_id = ?")
    .get(parentId) as { m: number | null } | undefined
  const startSeq = (row?.m ?? 0) + 1

  const nodes = parseRelativeTree(content, parentId, parentDepth, startSeq)
  const now = new Date().toISOString()

  const insertNode = store.database.prepare(`
    INSERT INTO memory_nodes (id, parent_id, root_id, depth, seq, content, created_at, title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const transaction = store.database.transaction(() => {
    for (const node of nodes) {
      insertNode.run(node.id, node.parentId, rootId, node.depth, node.seq, node.content, now, node.title)
    }
  })

  transaction()

  return {
    count: nodes.length,
    ids: nodes.map((n) => n.id),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/heimdall-hmem && bun run test -- test/modify.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/heimdall-hmem/src/modify.ts packages/heimdall-hmem/test/modify.test.ts
git commit -m "feat(hmem): implement update and append operations"
```

---

### Task 12: Implement Delete

**Files:**
- Create: `packages/heimdall-hmem/src/delete.ts`
- Create: `packages/heimdall-hmem/test/delete.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/delete.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { read } from "../src/read"
import { deleteEntry } from "../src/delete"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("deleteEntry", () => {
  let store: Store
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "hmem-"))
    store = await Store.open(join(tempDir, "test.hmem"))
  })

  afterEach(() => {
    store.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("removes entry and children", () => {
    write(store, "L", "Root\n\tChild\n\t\tGrandchild")
    const deleted = deleteEntry(store, "L0001")
    expect(deleted).toBe(true)
    const entries = read(store, { id: "L0001" })
    expect(entries).toHaveLength(0)
  })

  it("returns false for non-existent", () => {
    expect(deleteEntry(store, "L9999")).toBe(false)
  })
})
```

- [ ] **Step 2: Implement delete.ts**

```typescript
// src/delete.ts
import type { Store } from "./store"

export function deleteEntry(store: Store, id: string): boolean {
  const exists = store.database.prepare("SELECT 1 FROM memories WHERE id = ?").get(id)
  if (!exists) return false

  const transaction = store.database.transaction(() => {
    store.database.prepare("DELETE FROM memory_tags WHERE entry_id = ? OR entry_id LIKE ?").run(id, `${id}.%`)
    store.database.prepare("DELETE FROM memory_nodes WHERE root_id = ?").run(id)
    store.database.prepare("DELETE FROM memories WHERE id = ?").run(id)
  })

  transaction()
  return true
}
```

- [ ] **Step 3: Run tests**

```bash
cd packages/heimdall-hmem && bun run test -- test/delete.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/heimdall-hmem/src/delete.ts packages/heimdall-hmem/test/delete.test.ts
git commit -m "feat(hmem): implement hard delete with cascade"
```

---

### Task 13: Implement Tags

**Files:**
- Create: `packages/heimdall-hmem/src/tags.ts`
- Create: `packages/heimdall-hmem/test/tags.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/tags.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { validateTags, setTags, fetchTags, fetchTagsBulk, assignBulkTags } from "../src/tags"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("tags", () => {
  let store: Store
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "hmem-"))
    store = await Store.open(join(tempDir, "test.hmem"))
  })

  afterEach(() => {
    store.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("validates and lowercases tags", () => {
    const result = validateTags(["#Valid", "#UPPER", "invalid", "#ok-tag"])
    expect(result).toContain("#valid")
    expect(result).toContain("#upper")
    expect(result).toContain("#ok-tag")
    expect(result).not.toContain("invalid")
  })

  it("caps at 10 tags", () => {
    const tags = Array.from({ length: 15 }, (_, i) => `#tag${i}`)
    expect(validateTags(tags)).toHaveLength(10)
  })

  it("deduplicates case-insensitively", () => {
    expect(validateTags(["#foo", "#FOO", "#Foo"])).toHaveLength(1)
  })

  it("sets and fetches tags", () => {
    write(store, "L", "Entry")
    setTags(store, "L0001", ["#test", "#coding"])
    const tags = fetchTags(store, "L0001")
    expect(tags).toContain("#coding")
    expect(tags).toContain("#test")
  })

  it("replaces all tags on set", () => {
    write(store, "L", "Entry")
    setTags(store, "L0001", ["#old"])
    setTags(store, "L0001", ["#new"])
    const tags = fetchTags(store, "L0001")
    expect(tags).toEqual(["#new"])
  })

  it("bulk fetches tags", () => {
    write(store, "L", "One")
    write(store, "L", "Two")
    setTags(store, "L0001", ["#a"])
    setTags(store, "L0002", ["#b"])
    const bulk = fetchTagsBulk(store, ["L0001", "L0002"])
    expect(bulk["L0001"]).toContain("#a")
    expect(bulk["L0002"]).toContain("#b")
  })

  it("returns empty map for empty input", () => {
    expect(fetchTagsBulk(store, [])).toEqual({})
  })
})
```

- [ ] **Step 2: Implement tags.ts**

```typescript
// src/tags.ts
import type { Store } from "./store"
import type { MemoryEntry, MemoryNode } from "./types"

const TAG_PATTERN = /^#[a-z0-9_-]{1,49}$/
const MAX_TAGS = 10

export function validateTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const tag of tags) {
    const lower = tag.toLowerCase().trim()
    if (TAG_PATTERN.test(lower) && !seen.has(lower)) {
      seen.add(lower)
      result.push(lower)
      if (result.length >= MAX_TAGS) break
    }
  }
  return result
}

export function setTags(store: Store, entryId: string, tags: string[]): void {
  const valid = validateTags(tags)
  const transaction = store.database.transaction(() => {
    store.database.prepare("DELETE FROM memory_tags WHERE entry_id = ?").run(entryId)
    const insert = store.database.prepare("INSERT INTO memory_tags (entry_id, tag) VALUES (?, ?)")
    for (const tag of valid) {
      insert.run(entryId, tag)
    }
  })
  transaction()
}

export function fetchTags(store: Store, entryId: string): string[] {
  const rows = store.database
    .prepare("SELECT tag FROM memory_tags WHERE entry_id = ? ORDER BY tag ASC")
    .all(entryId) as { tag: string }[]
  return rows.map((r) => r.tag)
}

export function fetchTagsBulk(store: Store, ids: string[]): Record<string, string[]> {
  if (ids.length === 0) return {}

  const result: Record<string, string[]> = {}
  const CHUNK_SIZE = 500

  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE)
    const placeholders = chunk.map(() => "?").join(",")
    const rows = store.database
      .prepare(`SELECT entry_id, tag FROM memory_tags WHERE entry_id IN (${placeholders}) ORDER BY tag ASC`)
      .all(...chunk) as { entry_id: string; tag: string }[]

    for (const row of rows) {
      if (!result[row.entry_id]) result[row.entry_id] = []
      result[row.entry_id].push(row.tag)
    }
  }

  return result
}

function collectIds(entries: MemoryEntry[]): string[] {
  const ids: string[] = []
  function walkNodes(nodes: MemoryNode[]): void {
    for (const n of nodes) {
      ids.push(n.id)
      walkNodes(n.children)
    }
  }
  for (const e of entries) {
    ids.push(e.id)
    walkNodes(e.children)
  }
  return ids
}

function assignToNodes(nodes: MemoryNode[], tagMap: Record<string, string[]>): void {
  for (const n of nodes) {
    n.tags = tagMap[n.id] ?? []
    assignToNodes(n.children, tagMap)
  }
}

export function assignBulkTags(store: Store, entries: MemoryEntry[]): void {
  const ids = collectIds(entries)
  const tagMap = fetchTagsBulk(store, ids)
  for (const e of entries) {
    e.tags = tagMap[e.id] ?? []
    assignToNodes(e.children, tagMap)
  }
}
```

- [ ] **Step 3: Run tests**

```bash
cd packages/heimdall-hmem && bun run test -- test/tags.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/heimdall-hmem/src/tags.ts packages/heimdall-hmem/test/tags.test.ts
git commit -m "feat(hmem): implement tag CRUD with validation and bulk fetch"
```

---

### Task 14: Implement Related, Stats, Render, Compact

**Files:**
- Create: `packages/heimdall-hmem/src/related.ts`
- Create: `packages/heimdall-hmem/src/stats.ts`
- Create: `packages/heimdall-hmem/src/render.ts`
- Create: `packages/heimdall-hmem/src/compact.ts`
- Create: `packages/heimdall-hmem/test/stats.test.ts`
- Create: `packages/heimdall-hmem/test/render.test.ts`
- Create: `packages/heimdall-hmem/test/compact.test.ts`
- Create: `packages/heimdall-hmem/test/related.test.ts`

These four modules are smaller and share a test pattern. Implement them together for efficiency.

- [ ] **Step 1: Write stats tests**

```typescript
// test/stats.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { stats, healthCheck } from "../src/stats"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("stats", () => {
  let store: Store
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "hmem-"))
    store = await Store.open(join(tempDir, "test.hmem"))
  })

  afterEach(() => {
    store.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("returns zero for empty store", () => {
    const s = stats(store)
    expect(s.total).toBe(0)
  })

  it("counts by prefix and chars", () => {
    write(store, "L", "Learning entry")
    write(store, "P", "Project entry")
    write(store, "L", "Another learning")
    const s = stats(store)
    expect(s.total).toBe(3)
    expect(s.byPrefix["L"]).toBe(2)
    expect(s.byPrefix["P"]).toBe(1)
    expect(s.totalChars).toBeGreaterThan(0)
  })

  it("reports clean health on empty db", () => {
    const h = healthCheck(store)
    expect(h.brokenLinks).toHaveLength(0)
    expect(h.tagOrphans).toBe(0)
  })
})
```

- [ ] **Step 2: Write render tests**

```typescript
// test/render.test.ts
import { describe, it, expect } from "vitest"
import { render } from "../src/render"
import type { MemoryEntry } from "../src/types"

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: "L0001", prefix: "L", seq: 1, createdAt: "", updatedAt: "",
    title: "Test", level1: "Test entry", links: [], minRole: "worker",
    obsolete: false, favorite: false, irrelevant: false, pinned: false,
    accessCount: 0, lastAccessed: null, promoted: "", tags: [], children: [],
    ...overrides,
  }
}

describe("render", () => {
  it("renders entries with children", () => {
    const entry = makeEntry({
      children: [{
        id: "L0001.1", parentId: "L0001", rootId: "L0001", depth: 2,
        seq: 1, title: "", content: "Child text", createdAt: "",
        accessCount: 0, favorite: false, irrelevant: false, tags: [], children: [],
      }],
    })
    const out = render([entry])
    expect(out).toContain("L0001")
    expect(out).toContain("Test entry")
    expect(out).toContain("Child text")
  })

  it("returns empty for empty array", () => {
    expect(render([])).toBe("")
  })

  it("skips obsolete entries", () => {
    const out = render([makeEntry({ obsolete: true })])
    expect(out).not.toContain("L0001")
  })

  it("marks favorites", () => {
    const out = render([makeEntry({ favorite: true })])
    expect(out).toContain("\u2665") // ♥
  })
})
```

- [ ] **Step 3: Write compact tests**

```typescript
// test/compact.test.ts
import { describe, it, expect } from "vitest"
import { parseCompactionResponse, topicToContent } from "../src/compact"

describe("compact", () => {
  it("parses valid response", () => {
    const json = JSON.stringify({
      summary: "Session summary",
      topics: [{ prefix: "L", tags: ["#test"], l1: "Title", l2: "Summary", l3: "", l4: "", l5: "" }],
    })
    const result = parseCompactionResponse(json)
    expect(result.summary).toBe("Session summary")
    expect(result.topics).toHaveLength(1)
    expect(result.topics[0].prefix).toBe("L")
  })

  it("strips code fences", () => {
    const json = "```json\n" + JSON.stringify({ summary: "ok", topics: [] }) + "\n```"
    const result = parseCompactionResponse(json)
    expect(result.summary).toBe("ok")
  })

  it("throws on invalid JSON", () => {
    expect(() => parseCompactionResponse("not json")).toThrow()
  })

  it("corrects invalid prefix to L", () => {
    const json = JSON.stringify({
      summary: "", topics: [{ prefix: "Z", tags: [], l1: "x", l2: "", l3: "", l4: "", l5: "" }],
    })
    const result = parseCompactionResponse(json)
    expect(result.topics[0].prefix).toBe("L")
  })

  it("converts topic to tab-indented content", () => {
    const content = topicToContent({ prefix: "L", tags: [], l1: "Title", l2: "Details", l3: "More", l4: "", l5: "" })
    expect(content).toBe("Title\n\tDetails\n\t\tMore")
  })

  it("skips empty levels", () => {
    const content = topicToContent({ prefix: "L", tags: [], l1: "Title", l2: "", l3: "Deep", l4: "", l5: "" })
    expect(content).toBe("Title\n\t\tDeep")
  })
})
```

- [ ] **Step 4: Write related tests**

```typescript
// test/related.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Store } from "../src/store"
import { write } from "../src/write"
import { setTags } from "../src/tags"
import { findRelated } from "../src/related"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("findRelated", () => {
  let store: Store
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "hmem-"))
    store = await Store.open(join(tempDir, "test.hmem"))
  })

  afterEach(() => {
    store.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("finds related by shared tags", () => {
    write(store, "L", "Entry one")
    write(store, "L", "Entry two")
    setTags(store, "L0001", ["#coding", "#typescript"])
    setTags(store, "L0002", ["#coding", "#typescript"])
    const related = findRelated(store, "L0001", 10)
    expect(related.some((r) => r.id === "L0002")).toBe(true)
  })

  it("returns empty when no matches", () => {
    write(store, "L", "Lonely entry")
    expect(findRelated(store, "L0001", 10)).toHaveLength(0)
  })
})
```

- [ ] **Step 5: Implement all four modules**

Implement `stats.ts`, `render.ts`, `compact.ts`, `related.ts` (full implementations following Go source patterns — see spec for details).

- [ ] **Step 6: Run all tests**

```bash
cd packages/heimdall-hmem && bun run test
```

Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/heimdall-hmem/src/related.ts packages/heimdall-hmem/src/stats.ts packages/heimdall-hmem/src/render.ts packages/heimdall-hmem/src/compact.ts packages/heimdall-hmem/test/
git commit -m "feat(hmem): implement related, stats, render, and compact modules"
```

---

## Chunk 5: hmem Plugin Integration

### Task 15: Implement Tool Definitions

**Files:**
- Create: `packages/heimdall-hmem/src/tools.ts`

- [ ] **Step 1: Write tools.ts**

```typescript
// src/tools.ts
import { tool } from "@opencode-ai/plugin"
import type { Store } from "./store"
import { read } from "./read"
import { write } from "./write"
import { render } from "./render"

export function createHmemTools(store: Store) {
  return {
    hmem_search: tool({
      description: "Search hierarchical long-term memory (hmem). Returns matching entries by keyword.",
      args: {
        query: tool.schema.string().describe("Search query (keywords or FTS syntax)"),
        limit: tool.schema.number().optional().describe("Max results (default 20)"),
      },
      async execute(args) {
        const entries = read(store, { search: args.query, limit: args.limit ?? 20 })
        if (entries.length === 0) return "No matching memories found."
        return render(entries)
      },
    }),

    hmem_read: tool({
      description: "Read a specific memory entry by ID (e.g., P0042, L0001.2)",
      args: {
        id: tool.schema.string().describe("Memory ID like P0042 or node ID like L0001.2"),
      },
      async execute(args) {
        const entries = read(store, { id: args.id })
        if (entries.length === 0) return `Memory ${args.id} not found.`
        return render(entries)
      },
    }),

    hmem_write: tool({
      description: "Write a new memory entry. Uses tab-indented hierarchical format.",
      args: {
        prefix: tool.schema.string().describe("Category prefix: P(project), L(learning), T(task), E(event), D(decision), M(meeting), S(snippet), N(note), H(human), R(reference), F(feedback)"),
        content: tool.schema.string().describe("Tab-indented hierarchical content. L1=title, \\tL2=details, \\t\\tL3=deep details"),
      },
      async execute(args) {
        const result = write(store, args.prefix, args.content)
        return `Written: ${result.id} at ${result.timestamp}`
      },
    }),
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/heimdall-hmem/src/tools.ts
git commit -m "feat(hmem): define plugin tool wrappers for search, read, write"
```

---

### Task 16: Wire Plugin Entry Point

**Files:**
- Modify: `packages/heimdall-hmem/src/index.ts`

- [ ] **Step 1: Wire up index.ts with hooks**

```typescript
// src/index.ts
import type { Plugin } from "@opencode-ai/plugin"
import { Store } from "./store"
import { createHmemTools } from "./tools"
import { bulkReadV2 } from "./bulk-read"
import { render } from "./render"
import { homedir } from "os"
import { join } from "path"

const hmemPlugin: Plugin = async (ctx) => {
  const hmemPath = process.env.HMEM_PATH ?? join(homedir(), ".hmem", "memory.hmem")

  let store: Store
  try {
    store = await Store.open(hmemPath)
  } catch (err) {
    console.error(`[heimdall-hmem] Failed to open hmem database at ${hmemPath}:`, err)
    return {}
  }

  return {
    // Register tools
    tool: createHmemTools(store),

    // Auto-recall: inject relevant memories into system prompt
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        const memories = bulkReadV2(store, {})
        if (memories.length > 0) {
          output.system.push(
            "# Long-term Memory (hmem)\n\n" +
            "The following are your persistent memories from previous sessions:\n\n" +
            render(memories),
          )
        }
      } catch (err) {
        console.error("[heimdall-hmem] Auto-recall failed:", err)
      }
    },

    // Auto-capture: save learnings when session ends
    // NOTE: event type is a placeholder — verify against OpenCode bus events after forking
    event: async (input) => {
      try {
        if (input.event.type === "session.completed" || input.event.type === "session.end") {
          // TODO: Implement captureSessionLearnings — analyze session, save as hmem entries
          // Ported from Go fork's app.go:writeHmemMemory()
          console.log("[heimdall-hmem] Session ended — auto-capture hook triggered")
        }
      } catch (err) {
        console.error("[heimdall-hmem] Auto-capture failed:", err)
      }
    },

    // Inject HMEM_PATH into shell environment
    "shell.env": async () => ({
      env: { HMEM_PATH: hmemPath },
    }),
  }
}

export default hmemPlugin
```

- [ ] **Step 2: Build and verify**

```bash
cd packages/heimdall-hmem && bun run build
```

Expected: PASS

- [ ] **Step 3: Run full test suite**

```bash
cd packages/heimdall-hmem && bun run test
```

Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add packages/heimdall-hmem/src/index.ts
git commit -m "feat(hmem): wire plugin entry point with tools and auto-recall hook"
```

---

## Chunk 6: Agent Catalog Plugin

### Task 17: Implement Catalog Types + Loading

**Files:**
- Create: `packages/heimdall-catalog/src/types.ts`
- Create: `packages/heimdall-catalog/src/catalog.ts`
- Create: `packages/heimdall-catalog/test/catalog.test.ts`

- [ ] **Step 1: Write catalog tests**

Port from Go `catalog_test.go`:

```typescript
// test/catalog.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { Catalog } from "../src/catalog"
import { writeFileSync, mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const TEST_CATALOG = {
  _version: "1.0",
  agents: {
    THOR: {
      name: "Thor", persona: "Thorough coder", department: "Backend",
      specializations: ["APIs", "Go"], temperature: 0.3,
      model: "claude-4-opus", provider: "anthropic", tier: "$$$",
      tools: "coder", billing: "api", role: "al",
    },
    MAGNI: {
      name: "Magni", persona: "Debugger", department: "Backend",
      specializations: ["Debugging"], temperature: 0.2,
      model: "claude-3.5-haiku", provider: "anthropic", tier: "$",
      tools: "coder", billing: "api", role: "worker",
    },
    FRIGG: {
      name: "Frigg", persona: "Frontend expert", department: "Frontend",
      specializations: ["React", "CSS"], temperature: 0.4,
      model: "gemini-2.5", provider: "gemini", tier: "$$",
      tools: "coder", billing: "api", role: "al",
    },
  },
}

describe("Catalog", () => {
  let tempDir: string
  let catalog: Catalog

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "catalog-"))
    const path = join(tempDir, "catalog.json")
    writeFileSync(path, JSON.stringify(TEST_CATALOG))
    catalog = Catalog.load(path)
  })

  it("loads and populates IDs", () => {
    const thor = catalog.get("THOR")
    expect(thor).toBeDefined()
    expect(thor!.id).toBe("THOR")
    expect(thor!.temperature).toBe(0.3)
  })

  it("gets by department (case-insensitive)", () => {
    const backend = catalog.getByDepartment("backend")
    expect(backend).toHaveLength(2)
  })

  it("gets by specialization (substring)", () => {
    const apis = catalog.getBySpecialization("APIs")
    expect(apis).toHaveLength(1)
    expect(apis[0].id).toBe("THOR")
  })

  it("filters by tier (at or below)", () => {
    expect(catalog.filterByTier("$")).toHaveLength(1)
    expect(catalog.filterByTier("$$")).toHaveLength(2)
  })

  it("groups by department", () => {
    const groups = catalog.groupByDepartment()
    expect(groups["Backend"]).toHaveLength(2)
    expect(groups["Frontend"]).toHaveLength(1)
  })

  it("returns sorted department names", () => {
    expect(catalog.departmentNames()).toEqual(["Backend", "Frontend"])
  })

  it("obscured view hides model names", () => {
    const view = catalog.obscuredView()
    expect(view).toContain("THOR")
    expect(view).toContain("FRIGG")
    expect(view).not.toContain("claude-4-opus")
    expect(view).not.toContain("gemini-2.5")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/heimdall-catalog && bun run test
```

- [ ] **Step 3: Write types.ts**

```typescript
// src/types.ts
export type Tier = "$" | "$$" | "$$$"
export type BillingType = "api" | "subscription"
export type ToolSet = "coder" | "researcher" | "writer" | "reviewer"
export type AgentRole = "ceo" | "pl" | "al" | "assistant" | "worker"

export interface AgentSpec {
  id: string
  name: string
  persona: string
  department: string
  specializations: string[]
  temperature: number
  model: string
  provider: string
  tier: Tier
  tools: ToolSet
  billing: BillingType
  role: AgentRole
}

export interface CatalogData {
  _version: string
  agents: Record<string, Omit<AgentSpec, "id">>
}

export const TIER_RANK: Record<Tier, number> = { "$": 1, "$$": 2, "$$$": 3 }
```

- [ ] **Step 4: Write catalog.ts**

```typescript
// src/catalog.ts
import { readFileSync } from "fs"
import type { AgentSpec, CatalogData, Tier } from "./types"
import { TIER_RANK } from "./types"

export class Catalog {
  readonly version: string
  private agents: Map<string, AgentSpec>

  private constructor(version: string, agents: Map<string, AgentSpec>) {
    this.version = version
    this.agents = agents
  }

  static load(path: string): Catalog {
    const data: CatalogData = JSON.parse(readFileSync(path, "utf-8"))
    const agents = new Map<string, AgentSpec>()
    for (const [id, spec] of Object.entries(data.agents)) {
      agents.set(id.toUpperCase(), { ...spec, id: id.toUpperCase() })
    }
    return new Catalog(data._version, agents)
  }

  get(id: string): AgentSpec | undefined {
    return this.agents.get(id.toUpperCase())
  }

  getByDepartment(dept: string): AgentSpec[] {
    const lower = dept.toLowerCase()
    return [...this.agents.values()].filter(
      (a) => a.department.toLowerCase() === lower,
    )
  }

  getBySpecialization(...keywords: string[]): AgentSpec[] {
    const result: AgentSpec[] = []
    for (const agent of this.agents.values()) {
      for (const kw of keywords) {
        if (agent.specializations.some((s) => s.toLowerCase().includes(kw.toLowerCase()))) {
          result.push(agent)
          break
        }
      }
    }
    return result
  }

  filterByTier(maxTier: Tier): AgentSpec[] {
    const maxRank = TIER_RANK[maxTier]
    return [...this.agents.values()].filter((a) => TIER_RANK[a.tier] <= maxRank)
  }

  groupByDepartment(): Record<string, AgentSpec[]> {
    const groups: Record<string, AgentSpec[]> = {}
    for (const agent of this.agents.values()) {
      if (!groups[agent.department]) groups[agent.department] = []
      groups[agent.department].push(agent)
    }
    return groups
  }

  departmentNames(): string[] {
    const names = new Set<string>()
    for (const agent of this.agents.values()) names.add(agent.department)
    return [...names].sort()
  }

  all(): AgentSpec[] {
    return [...this.agents.values()]
  }

  obscuredView(): string {
    let out = "Available specialists:\n\n"
    for (const [id, spec] of this.agents) {
      const specs = spec.specializations.join(", ")
      out += `  ${id.padEnd(12)} ${(spec.department + "(" + specs + ")").padEnd(40)} ${spec.tier}\n`
    }
    out += "\nChoose agents by SPECIALTY, not by price.\nThe budget system handles cost optimization.\n"
    return out
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd packages/heimdall-catalog && bun run test
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/heimdall-catalog/src/types.ts packages/heimdall-catalog/src/catalog.ts packages/heimdall-catalog/test/catalog.test.ts
git commit -m "feat(catalog): implement catalog loading and query functions"
```

---

### Task 18: Wire Catalog Plugin Entry Point

**Files:**
- Create: `packages/heimdall-catalog/src/tools.ts`
- Modify: `packages/heimdall-catalog/src/index.ts`

- [ ] **Step 1: Write tools.ts**

```typescript
// src/tools.ts
import { tool } from "@opencode-ai/plugin"
import type { Catalog } from "./catalog"
import type { AgentSpec, Tier } from "./types"
import { TIER_RANK } from "./types"

function formatAgentList(agents: AgentSpec[]): string {
  if (agents.length === 0) return "No agents found matching the criteria."
  let out = "Available specialists:\n\n"
  for (const a of agents) {
    const specs = a.specializations.join(", ")
    out += `  ${a.id.padEnd(12)} ${a.tier.padEnd(5)} ${a.department} (${specs})\n`
  }
  return out
}

export function createCatalogTools(catalog: Catalog) {
  return {
    catalog_list: tool({
      description: "List available agents by department and tier",
      args: {
        department: tool.schema.string().optional().describe("Filter by department (e.g., Backend, Frontend, QA)"),
        tier: tool.schema.string().optional().describe("Max tier filter: $ (cheap), $$ (mid), $$$ (expensive)"),
      },
      async execute(args) {
        let agents: AgentSpec[]
        if (args.department) {
          agents = catalog.getByDepartment(args.department)
        } else {
          agents = catalog.all()
        }
        if (args.tier) {
          agents = agents.filter((a) => TIER_RANK[a.tier] <= TIER_RANK[args.tier as Tier])
        }
        return formatAgentList(agents)
      },
    }),

    catalog_search: tool({
      description: "Search agents by specialization keyword",
      args: {
        query: tool.schema.string().describe("Specialization keyword (e.g., APIs, Testing, CSS)"),
      },
      async execute(args) {
        const agents = catalog.getBySpecialization(args.query)
        return formatAgentList(agents)
      },
    }),
  }
}
```

- [ ] **Step 2: Wire index.ts**

```typescript
// src/index.ts
import type { Plugin } from "@opencode-ai/plugin"
import { Catalog } from "./catalog"
import { createCatalogTools } from "./tools"
import { join } from "path"
import { existsSync } from "fs"

const catalogPlugin: Plugin = async (ctx) => {
  const catalogPath = process.env.HEIMDALL_CATALOG_PATH
    ?? join(ctx.directory, "heimdall-catalog.json")

  if (!existsSync(catalogPath)) {
    // Try configs/ subdirectory
    const altPath = join(ctx.directory, "configs", "catalog.json")
    if (!existsSync(altPath)) {
      console.warn(`[heimdall-catalog] No catalog found at ${catalogPath}`)
      return {}
    }
    const catalog = Catalog.load(altPath)
    return { tool: createCatalogTools(catalog) }
  }

  const catalog = Catalog.load(catalogPath)
  return { tool: createCatalogTools(catalog) }
}

export default catalogPlugin
```

- [ ] **Step 3: Build and verify**

```bash
cd packages/heimdall-catalog && bun run build
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/heimdall-catalog/src/
git commit -m "feat(catalog): wire plugin entry point with catalog_list and catalog_search tools"
```

---

## Chunk 7: Branding (Core Patches)

### Task 19: Apply Branding Patches

> **NOTE:** Exact file paths depend on the OpenCode source structure after forking. The paths below are based on analysis of the upstream repo structure. Verify after Task 1 (fork) is complete.

**Files:**
- Modify: `packages/opencode/package.json`
- Modify: `packages/opencode/src/agent/` (system prompt file — locate exact file)
- Modify: TUI components (header, title — locate exact files)
- Create: `opencode.json` (project config with plugins + commands)

- [ ] **Step 1: Update package.json**

In `packages/opencode/package.json`:
```json
{
  "name": "heimdall-cli",
  "bin": {
    "heimdall": "./bin/opencode"
  }
}
```

- [ ] **Step 2: Update system prompt**

Locate the system prompt in the agent directory. Search for the string containing "You are" or the agent name. Replace with:

```
You are Heimdall, an AI coding assistant built on OpenCode. You help developers write, debug, and understand code.
```

- [ ] **Step 3: Update TUI title and version string**

Find where "OpenCode" or "opencode" appears in UI components and replace with "Heimdall". Keep the version from `package.json`.

- [ ] **Step 4: Update URLs**

Replace `github.com/sst/opencode` references with `github.com/Bumblebiber/heimdall-cli`.

- [ ] **Step 5: Create project opencode.json config**

```json
{
  "plugin": [
    "file://./packages/heimdall-hmem/dist/index.js",
    "file://./packages/heimdall-catalog/dist/index.js"
  ],
  "command": {
    "catalog": {
      "template": "List all available agents from the catalog using the catalog_list tool",
      "description": "Show agent catalog"
    },
    "agents": {
      "template": "Search the agent catalog for: $ARGUMENTS",
      "description": "Search agents by specialization"
    }
  }
}
```

- [ ] **Step 6: Build entire monorepo**

```bash
bun install && bun run build
```

Expected: Successful build.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: apply Heimdall branding and configure plugins"
```

---

## Chunk 8: Integration Test + Smoke Test

### Task 20: End-to-End Verification

- [ ] **Step 1: Run all test suites**

```bash
bun run test
```

Expected: ALL PASS across all packages.

- [ ] **Step 2: Smoke test — launch Heimdall**

```bash
cd /tmp/test-project && heimdall
```

Verify:
- App launches with "Heimdall" title
- hmem tools appear in tool list (hmem_search, hmem_read, hmem_write)
- catalog tools appear (catalog_list, catalog_search)
- `/catalog` command works

- [ ] **Step 3: Smoke test — hmem integration**

In a Heimdall session:
- Ask it to search memory: should use hmem_search
- Ask it to write a memory: should use hmem_write
- Verify memories persist in `~/.hmem/memory.hmem`

- [ ] **Step 4: Final commit + tag**

```bash
git tag v1.0.0-alpha.1
git push origin npm-migration --tags
```
