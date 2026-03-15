# Heimdall CLI — Migration to OpenCode Base

**Date:** 2026-03-12
**Status:** Draft
**Author:** Bumblebiber + Claude Opus 4.6

## Summary

Migrate Heimdall CLI from the archived Go-based OpenCode fork (v0.0.56) to a fork of the actively maintained npm-based OpenCode (v1.2.24, TypeScript, `opencode-ai` on npm). Use a hybrid approach: minimal core patches for branding, all features as plugins via `@opencode-ai/plugin`.

## Goals

### MVP (Phase 1)
1. **hmem Memory Plugin** — long-term hierarchical memory via plugin hooks + custom tools
2. **Heimdall Branding** — name, welcome screen, theme, system prompt
3. **Agent Catalog Plugin** — departments, tiers, specializations from JSON

### Phase 2 (later)
- GroupChat (/groupchat, /invite, /endchat, mentions) — leverage `event` hook for agent coordination
- Budget/Cost Tracking per agent — port from Go `internal/agent/budget.go`
- Agent spawning/routing via catalog — port from Go `internal/agent/spawn.go`, `spawn_tool.go`
- Ephemeral agents — port from Go `internal/agent/ephemeral.go`
- GroupChat memory — port from Go `internal/agent/groupchat_memory.go`

## Approach: Hybrid Fork

- **Core patches** (minimal): Branding only (~6-8 files changed)
- **Features as plugins**: hmem and catalog as npm packages or `file://` plugins
- **Upstream mergeability**: Keep diff small, upstream remote for cherry-picks
- **Plugin loading**: OpenCode discovers plugins via the `plugin` array in `opencode.json` — either npm package specifiers or `file://` URLs

## 1. Repository Setup

### Actions
- Archive current Go fork on branch `legacy/go-fork`
- Fork OpenCode (`github.com/sst/opencode`) at current release tag
- Reset `main` to the OpenCode fork
- Keep upstream remote for future merges

### Directory Structure (additions)
```
heimdall-cli/
├── packages/
│   ├── opencode/              # Core (upstream, minimal patches)
│   ├── plugin/                # @opencode-ai/plugin (upstream)
│   ├── heimdall-hmem/         # Memory plugin (new)
│   └── heimdall-catalog/      # Agent catalog plugin (new)
├── skills/                    # Upstream + custom skills
└── ...
```

OpenCode is a Bun-based monorepo using workspaces. Our plugins live alongside upstream packages.

## 2. hmem Memory Plugin

### Location
`packages/heimdall-hmem/`

### Architecture
Implements the OpenCode plugin pattern from `@opencode-ai/plugin`. A plugin is a function `(PluginInput) => Promise<Hooks>` that returns hook handlers and tool registrations. Wraps the hmem SQLite database directly via `better-sqlite3`.

**Note:** OpenCode has no built-in memory system. There is no "memory slot" or `kind: "memory"` concept. hmem provides memory as a fully custom plugin with its own tools and hooks.

**Plugin definition:**
```typescript
import { type Plugin, tool } from "@opencode-ai/plugin"

const hmemPlugin: Plugin = async (ctx) => {
  const store = await HmemStore.open(ctx.directory)

  return {
    // Register custom tools
    tool: {
      hmem_search: tool({
        description: "Search hierarchical long-term memory",
        args: { query: tool.schema.string().describe("Search query") },
        async execute(args, toolCtx) {
          const results = await store.search(args.query)
          return formatResults(results)
        },
      }),
      hmem_read: tool({
        description: "Read a memory entry by ID",
        args: { id: tool.schema.string().describe("Memory ID like P0042") },
        async execute(args, toolCtx) {
          const entry = await store.read(args.id)
          return formatEntry(entry)
        },
      }),
      hmem_write: tool({
        description: "Write a new memory entry",
        args: {
          prefix: tool.schema.string().describe("Category: P/L/E/D/T/M/S/F"),
          content: tool.schema.string().describe("Tab-indented hierarchical content"),
        },
        async execute(args, toolCtx) {
          const id = await store.write(args.prefix, args.content)
          return `Written: ${id}`
        },
      }),
    },

    // Auto-recall: inject relevant memories into system prompt
    "experimental.chat.system.transform": async (input, output) => {
      const memories = await store.bulkRead({ mode: "essentials" })
      if (memories.length > 0) {
        output.system.push(formatMemoriesForContext(memories))
      }
    },

    // Auto-capture: save learnings at end of session
    event: async (input) => {
      // NOTE: event type name is a placeholder — verify against actual OpenCode bus events after forking
      if (input.event.type === "session.completed") {
        await captureSessionLearnings(store, input.event)
      }
    },
  }
}

export default hmemPlugin
```

**Tool names:** `hmem_search`, `hmem_read`, `hmem_write` — no collision risk since OpenCode has no built-in memory tools.

**Native dependency note:** `better-sqlite3` requires native compilation. Use lazy-load + catch pattern to provide a clear error message if compilation fails.

### Ported from Go Fork
The Go implementation at `internal/hmem/` serves as the source of truth:

- **Schema** (`schema.go`) — SQLite tables: `memories`, `memory_nodes`. Ported 1:1.
- **Store API** (`store.go`) — Open, Close with WAL pragma, single-writer.
- **Read** (`read.go`, `bulk_read.go`) — Single entry by ID, BulkRead V2 with Discover/Essentials modes.
- **Write** (`write.go`) — Prefix-based ID generation (P0001, L0042, etc.), tab-indented content parsing into hierarchical nodes.
- **Modify** (`modify.go`) — Update entry/node content, flags (favorite, obsolete, irrelevant, pinned).
- **Append** (`modify.go`) — Add child nodes to existing entries.
- **Delete** (`delete.go`) — Soft delete support.
- **Tags** (`tags.go`) — Hashtag-based cross-cutting search.
- **Related** (`related.go`) — Find entries by shared tags or time proximity.
- **Stats** (`stats.go`) — Memory health metrics, counts by prefix.
- **SessionCache** (`session_cache.go`) — Track seen entries per session for BulkRead optimization.
- **Types** (`types.go`) — MemoryEntry, MemoryNode, WriteOptions, ReadOptions, UpdateFields, AgentRole hierarchy (Worker/AL/PL/CEO).
- **Render** (`render.go`) — Format entries for display with truncation and depth control.
- **Parse** (`parse.go`) — Tab-indented content parsing into hierarchical nodes.
- **Compact** (`compact.go`) — Context compaction for long sessions.

### Go Test Files as Specification
All Go test files (`*_test.go`) serve as the functional specification for TypeScript reimplementation:
- `store_test.go` — Open/Close/schema init
- `parse_test.go` — Tab-indented content parsing
- `bulk_read_test.go` — V2 selection modes
- `render_test.go` — Output formatting
- `schema_test.go` — Migration correctness
- `stats_test.go` — Health metrics
- `related_test.go` — Tag/time-based related entries
- `tags_test.go` — Tag CRUD operations
- `compact_test.go` — Context compaction

### OpenCode Integration
- **Auto-Recall**: `experimental.chat.system.transform` hook — search hmem for relevant context, inject into system prompt array
- **Auto-Capture**: `event` hook — listen for session completion events, save learnings as hmem entries (ported from Go fork's `app.go:writeHmemMemory()`)
- **Tool registration**: `hmem_search`, `hmem_read`, `hmem_write` registered via `Hooks.tool` return object

### Configuration
Plugin is loaded via `opencode.json`:
```json
{
  "plugin": ["file://./packages/heimdall-hmem/dist/index.js"]
}
```

The hmem database path defaults to `~/.hmem/memory.hmem` and can be overridden via `HMEM_PATH` environment variable (consistent with existing hmem MCP server behavior).

## 3. Agent Catalog Plugin

### Location
`packages/heimdall-catalog/`

### Architecture
Config-based catalog loaded from JSON at startup. Read-only in MVP — no runtime agent creation.

### Ported from Go Fork
The Go implementation at `internal/agent/catalog.go` and tests:

- **Catalog structure**: Agents with ID, Name, Department, Tier, Specializations, Model, Persona (+ Temperature, Provider, Tools, Billing, Role — ported 1:1 from Go `AgentSpec`)
- **Departments**: Grouping agents by function (Engineering, Research, Operations, etc.)
- **Tiers**: `$`/`$$`/`$$$` — maps to model cost categories (cheap/mid/expensive)
- **Query functions**: GetByDepartment, GetBySpecialization, FilterByTier, GroupByDepartment, DepartmentNames (renamed from Go's `list_agents` to `catalog_list`/`catalog_search` for plugin namespace clarity)
- **ObscuredView**: Role-restricted catalog view (hides personas, model details from lower roles)

### Plugin Interface
```typescript
import { type Plugin, tool } from "@opencode-ai/plugin"

const catalogPlugin: Plugin = async (ctx) => {
  const catalog = await loadCatalog(ctx.directory)

  return {
    tool: {
      catalog_list: tool({
        description: "List available agents by department and tier",
        args: {
          department: tool.schema.string().optional().describe("Filter by department"),
          tier: tool.schema.string().optional().describe("Filter by tier: cheap/mid/expensive"),
        },
        async execute(args) {
          return formatCatalog(catalog.filter(args))
        },
      }),
      catalog_search: tool({
        description: "Search agents by specialization",
        args: { query: tool.schema.string().describe("Specialization keyword") },
        async execute(args) {
          return formatCatalog(catalog.searchBySpecialization(args.query))
        },
      }),
    },
  }
}

export default catalogPlugin
```

Commands for interactive use (`/catalog`, `/agents`) can be added as custom commands in `opencode.json`:
```json
{
  "command": {
    "catalog": {
      "template": "List all available agents from the catalog using catalog_list tool",
      "description": "Show agent catalog"
    },
    "agents": {
      "template": "Search the agent catalog for: $ARGUMENTS",
      "description": "Search agents by specialization"
    }
  }
}
```

### No Agent Spawning in MVP
Catalog is a reference directory only. Spawning, routing, and multi-agent orchestration deferred to Phase 2 (GroupChat).

### Configuration
```json
{
  "plugin": [
    "file://./packages/heimdall-hmem/dist/index.js",
    "file://./packages/heimdall-catalog/dist/index.js"
  ]
}
```

## 4. Branding (Core Patches)

### Files Changed (~6-8 total)

| File | Change |
|------|--------|
| `packages/opencode/package.json` | `"name": "heimdall-cli"`, `"bin": { "heimdall": "..." }` |
| TUI header/title (locate in `packages/opencode/src/` or `packages/ui/`) | "Heimdall" title, version string |
| Welcome screen component | Bifrost ASCII art (existing designs in `Heimdall_Welcome-Screen_*.txt`) |
| Default theme | Custom color scheme replacing OpenCode defaults |
| System prompt (`packages/opencode/src/agent/`) | "You are Heimdall, an AI coding assistant..." |
| URLs/links | github.com/Bumblebiber/heimdall-cli |

### What Is NOT Changed
- No renaming of internal packages/modules
- No changes to `@opencode-ai/plugin` SDK API
- No changes to monorepo workspace structure
- No changes to upstream feature code

This keeps the upstream diff small and mergeable.

## 5. OpenCode Plugin API Reference

Based on analysis of `@opencode-ai/plugin` (v1.2.24):

### Plugin Type
```typescript
type Plugin = (input: PluginInput) => Promise<Hooks>

type PluginInput = {
  client: OpenCodeClient    // SDK client for API access
  project: Project          // Current project info
  directory: string         // Project directory
  worktree: string          // Git worktree root
  serverUrl: URL            // OpenCode server URL
  $: BunShell               // Bun shell for running commands
}
```

### Available Hooks
| Hook | Purpose | Used by Heimdall |
|------|---------|-----------------|
| `tool` | Register custom tools | hmem tools, catalog tools |
| `event` | React to all bus events | hmem auto-capture |
| `experimental.chat.system.transform` | Inject into system prompt | hmem auto-recall |
| `chat.message` | Intercept new messages | — |
| `chat.params` | Modify LLM parameters | — |
| `command.execute.before` | Before slash command | — |
| `tool.execute.before` / `after` | Before/after tool calls | — |
| `permission.ask` | Override permission prompts | — |
| `shell.env` | Inject environment variables | hmem path config |

### Tool Helper
```typescript
import { tool } from "@opencode-ai/plugin"

tool({
  description: string,
  args: { [key]: tool.schema.<type>().describe(string) },  // tool.schema = zod
  execute(args, context: ToolContext): Promise<string>,
})
```

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Base | OpenCode v1.2.24 fork (npm `opencode-ai`) | Actively maintained, plugin system, Bun monorepo |
| hmem access | Direct SQLite (`better-sqlite3`) | Faster than MCP, same DB file |
| Plugin pattern | `@opencode-ai/plugin` function pattern | Official plugin SDK, `Hooks.tool` + lifecycle hooks |
| Memory injection | `experimental.chat.system.transform` | Only way to inject into system prompt |
| Auto-capture trigger | `event` hook on session events | React to all bus events |
| Tool names | `hmem_*` and `catalog_*` prefix | Clear namespace, no collisions |
| Catalog scope | Read-only JSON + tools | MVP simplicity, spawning in Phase 2 |
| Commands | Config-based (`opencode.json` `command` field) | No core patch needed for slash commands |
| Branding location | Core patches | Branding IS the fork identity |
| Features location | Monorepo `packages/` plugins | Same workspace, clean separation |
| Go code reuse | Types + tests as spec | 1:1 port of schema, API, test cases |
| Build tool | Bun (upstream uses Bun + Turbo) | Consistent with monorepo |

## Migration Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Upstream breaking changes | Small diff, monitor releases, merge regularly |
| hmem schema drift | Same SQLite file, schema versioned with migrations |
| Plugin SDK changes | Pin to known-good version, test after upgrades |
| Go→TS port bugs | Go tests as spec, TDD approach for TypeScript |
| `better-sqlite3` native compilation | Lazy-load + catch pattern, clear error message |
| `experimental.*` hooks changing | Monitor OpenCode releases, adapt if APIs stabilize |
| Bun requirement | OpenCode already requires Bun; no additional dependency |
