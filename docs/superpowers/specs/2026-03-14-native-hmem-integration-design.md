# Native hmem Integration — Design Spec

**Date:** 2026-03-14
**Status:** Draft
**Author:** Bumblebiber + Claude Opus 4.6

## Summary

Integrate hmem (hierarchical long-term memory) and hmem-sync (encrypted cloud sync) natively into the Heimdall CLI binary. No separate npm install, no plugin system — hmem is a first-class built-in feature. Every Heimdall installation has memory out of the box.

## Goals

1. **Zero-config memory** — `heimdall` works with persistent memory immediately after install
2. **Per-agent isolation** — each Asgardian (sub-agent) maintains its own memory database
3. **Local vs. global choice** — user decides per project whether Heimdall's memory is project-scoped or global
4. **Built-in sync** — encrypted push/pull to a remote server, configurable per agent
5. **Migration** — existing `~/.hmem/` data and hmem-sync accounts carry over seamlessly

## Non-Goals

- Group chat shared memory (Phase 2)
- Agent spawning/routing (Phase 2)
- Public sync server / SaaS billing (future — API key field prepared)
- Per-agent local/global choice (agents are always global)

---

## 1. Storage Architecture

### File System Layout

```
{Global.Path.data}/                      # Platform-dependent: see note below
├── memory.hmem                  # Heimdall's global memory
├── agents/
│   ├── THOR.hmem                # Thor's memory
│   ├── LOKI.hmem                # Loki's memory
│   └── {AGENT_ID}.hmem          # One file per agent (uppercase ID)
└── sync/
    ├── config.json              # serverUrl, userId, salt, per-agent sync flags
    ├── token                    # Auth token (file permissions: 600)
    └── state.json               # last_push_at / last_pull_at per DB

Project-local (when user chooses "local"):
{project}/.heimdall/
├── config.json                  # {"memory": "local"}
└── memory.hmem                  # Heimdall's project-local memory
```

**Platform paths:** The base directory uses `Global.Path.data` from the fork's `global/index.ts`, which resolves to:
- Linux: `~/.local/share/heimdall`
- macOS: `~/Library/Application Support/heimdall`
- Windows: `%LOCALAPPDATA%/heimdall`

All paths in this spec use `~/.config/heimdall/` as shorthand for the platform-appropriate data directory.

### Rules

| Actor | Memory Location | Scope |
|-------|----------------|-------|
| Heimdall | `~/.config/heimdall/memory.hmem` OR `{project}/.heimdall/memory.hmem` | User chooses per project |
| Agent (e.g. THOR) | `~/.config/heimdall/agents/THOR.hmem` | Always global (cross-project) |

Agent IDs are normalized to uppercase: `thor` → `THOR.hmem`.

### Access Control

| Actor | Own hmem | Other agent hmems | Heimdall's hmem |
|-------|---------|-------------------|-----------------|
| Heimdall | read + write | **read-only** (all agents) | — |
| Agent | read + write | no access | no access |

### Store Management

```typescript
// Opens the correct store based on actor and project config
HmemStore.openFor("heimdall", projectDir)  // checks config → local or global
HmemStore.openFor("THOR")                  // always ~/.config/heimdall/agents/THOR.hmem
```

Stores are opened lazily (on first access) and closed at session end.

---

## 2. Native Integration in OpenCode Fork

### Module Structure

The hmem code lives inside the OpenCode fork as a built-in module:

```
packages/opencode/src/hmem/
├── store.ts              # Store class (open/close, SQLite, WAL, schema)
├── schema.ts             # DDL + migrations (ported from heimdall-hmem)
├── read.ts               # read, readL1Headers, loadChildren, loadChildrenToDepth
├── write.ts              # write with ID generation + tab-indented parsing
├── modify.ts             # update, append
├── delete.ts             # deleteEntry
├── tags.ts               # setTags, fetchTags
├── related.ts            # findRelated
├── stats.ts              # stats, healthCheck
├── bulk-read.ts          # BulkRead V2 (session-recency boost, L2 full body)
├── render.ts             # Format entries for system prompt injection
├── compact.ts            # parseCompactionResponse, topicToContent
├── parse.ts              # Tab-indented content → node tree
├── types.ts              # All types (MemoryEntry, MemoryNode, etc.)
├── session-cache.ts      # SessionCache for BulkRead optimization
├── sqlite-adapter.ts     # Dynamic import: bun:sqlite (Bun) or better-sqlite3 (Node)
├── sync/
│   ├── client.ts         # Sync logic: entry serialization, merge, state management
│   ├── transport.ts      # HTTP layer: push/pull requests, batching, auth headers
│   ├── crypto.ts         # AES-256-GCM encryption, scrypt key derivation, recovery keys
│   ├── setup.ts          # Registration flow, restore flow, passphrase prompting
│   └── config.ts         # Sync config read/write (serverUrl, userId, salt, databases)
└── index.ts              # Public API: openStore(), tools, autoRecall()
```

### Source

The code is ported 1:1 from the existing `heimdall-hmem` TypeScript plugin package (`packages/heimdall-hmem/src/`). The sync module is ported from the `hmem-sync` npm package (v0.2.7).

### Tool Registration

hmem tools are registered directly in `tool/registry.ts`, alongside built-in tools like `BashTool`, `ReadTool`, etc.:

```typescript
// packages/opencode/src/tool/registry.ts — in the all() function
return [
  BashTool,
  ReadTool,
  GlobTool,
  GrepTool,
  EditTool,
  WriteTool,
  // ...existing tools...
  ...HmemTools,  // hmem_search, hmem_read, hmem_write, hmem_append,
                 // hmem_list, hmem_tag, hmem_stats, hmem_health
]
```

### Heimdall's Extra Tool

Heimdall gets one additional tool that agents don't:

```typescript
hmem_read_agent({
  agent: "THOR",    // required: which agent's memory to read
  id?: "P0001",     // optional: specific entry
  search?: "OAuth", // optional: FTS query
})
```

This tool is only available to the primary agent (Heimdall). Filtering uses the existing `PermissionNext` system: sub-agent definitions deny `hmem_read_agent` via their permission rules, the same way `hmem-compaction` restricts its tool set. The primary agent's permissions allow it.

### System Prompt Injection

Memory context is injected directly in `session/llm.ts`, not via plugin hooks:

```typescript
// After base prompt, before existing Plugin.trigger()
const memories = await Hmem.autoRecall(sessionID, agent)
if (memories) system.push(memories)
```

For Heimdall: BulkRead V2 from Heimdall's store (essentials mode).
For agents: last 50 L1 titles from the agent's store.

### Compaction

The existing `hmem-compaction` agent (implemented in the previous spec) continues to work unchanged. The only difference is that its tools (`hmem_list`, `hmem_read`, `hmem_write`, `hmem_append`, `hmem_search`, `hmem_tag`) now resolve from the built-in module instead of a plugin.

The `resolveCompactionTools()` function in `session/compaction.ts` resolves tools from `ToolRegistry` — since hmem tools are now built-in, they'll be found there without any plugin.

**Note:** hmem tools MUST be registered in `ToolRegistry.all()` before the first compaction cycle runs. Since they're hardcoded in the `all()` function (like `BashTool` etc.), this is guaranteed.

### What Gets Removed

- `heimdall-hmem` plugin package — absorbed into the binary
- `file://...heimdall-hmem...` plugin entry in config — no longer needed
- `experimental.chat.system.transform` hook for memory — replaced by direct injection
- `shell.env` hook for `HMEM_PATH` — replaced by native config

---

## 3. First-Chat Dialog (Local vs. Global)

### Trigger Conditions

On session start, Heimdall checks (in order):
1. `.heimdall/config.json` exists in project dir → read `memory` field
2. `.heimdall/memory.hmem` exists → implicitly "local"
3. Neither exists → show dialog

### Dialog UI

```
┌─ Memory Setup ──────────────────────────────────┐
│                                                  │
│  How should Heimdall remember things?            │
│                                                  │
│  ● Global  (~/.config/heimdall/memory.hmem)      │
│    Memories shared across all projects            │
│                                                  │
│  ○ Local   (.heimdall/memory.hmem)               │
│    Memories scoped to this project only           │
│                                                  │
└──────────────────────────────────────────────────┘
```

### After Selection

- **Local**: creates `.heimdall/config.json` with `{"memory": "local"}` and initializes `.heimdall/memory.hmem`
- **Global**: creates `.heimdall/config.json` with `{"memory": "global"}`, uses `~/.config/heimdall/memory.hmem`

The dialog does not appear again once `.heimdall/config.json` exists. User can delete the file to re-trigger, or edit it manually.

---

## 4. Per-Agent Memory Lifecycle

### Agent Spawn

When an Asgardian is spawned:
1. Open `~/.config/heimdall/agents/{AGENT_ID}.hmem` (create if first time)
2. Read last 50 L1 titles
3. Inject into agent's system prompt:

```
## Your Memory (from previous sessions)
- [P0001] Implemented OAuth2 flow for project X
- [P0002] Debugged token rotation — root cause was stale cache
- [L0003] User prefers functional style over class-based
```

### During Execution

The agent has access to hmem tools (`hmem_read`, `hmem_write`, `hmem_append`, `hmem_search`, `hmem_list`, `hmem_tag`) — all scoped to its own store.

### After Task Completion

Automatic summary entry written to agent's hmem:
- Prefix: `P` (Project)
- Tag: `#task-result`
- Content: `Task: {description}\nResult: {result}`

### Tool Isolation

The hmem tool implementations receive the agent name from the execution context (`ctx.agent`). Store routing uses the agent's mode, not a hardcoded name:

```typescript
// In hmem tool execute():
function resolveStore(ctx: ToolContext): Store {
  const agent = Agent.get(ctx.agent)
  if (agent?.mode === "primary") {
    return HmemStore.openFor("heimdall", ctx.projectDir)
  }
  return HmemStore.openFor(ctx.agent.toUpperCase())
}
```

- Primary agent (mode `"primary"`, currently named `"build"`) → Heimdall's store
- Any sub-agent (e.g. `"THOR"`) → that agent's store

This is resilient to agent name changes and `default_agent` config overrides.

---

## 5. hmem-sync Integration

### Architecture

The sync client from hmem-sync v0.2.7 is ported into the binary. Same protocol, same crypto, same server compatibility.

| Aspect | Details |
|--------|---------|
| Protocol | HTTP/HTTPS REST (JSON) |
| Encryption | AES-256-GCM, scrypt key derivation (N=16384) |
| Auth | Bearer token (32 random hex bytes, SHA-256 hashed server-side) |
| Sync unit | Full entry as encrypted blob (root + nodes + tags) |
| Conflict resolution | Last-Write-Wins on `updated_at` |
| Batch size | 200 entries per request |
| Default server | `https://bbbee.uber.space` |

### CLI Subcommands

```
heimdall sync setup       # Interactive: passphrase, registration, recovery key
heimdall sync push        # Encrypt + upload changed entries
heimdall sync pull        # Download + decrypt + merge
heimdall sync status      # Show last sync time, entry counts
heimdall sync restore     # Connect new device with saved token
```

### TUI Integration

- **Settings menu**: configure sync (server URL, setup flow)
- **Status bar**: last sync timestamp indicator
- **Slash command**: `/sync` triggers push + pull

### Per-Agent Sync Configuration

```json
// ~/.config/heimdall/sync/config.json
{
  "serverUrl": "https://bbbee.uber.space",
  "userId": "abc123",
  "salt": "base64...",
  "syncSecrets": false,
  "databases": {
    "heimdall": { "enabled": true },
    "THOR": { "enabled": true },
    "LOKI": { "enabled": false }
  }
}
```

- Default: `enabled: true` for Heimdall, `enabled: false` for agents
- Per-DB sync state tracked in `state.json`:

```json
{
  "heimdall": { "last_push_at": "2026-03-14T10:00:00Z", "last_pull_at": "2026-03-14T10:05:00Z" },
  "THOR": { "last_push_at": "2026-03-14T09:00:00Z", "last_pull_at": "2026-03-14T09:05:00Z" }
}
```

### Passphrase Strategy

The sync client requires a passphrase to derive the AES encryption key (via scrypt). The passphrase is never stored on disk.

- **CLI mode** (`heimdall sync push/pull`): prompt interactively via stdin, or read from `HMEM_SYNC_PASSPHRASE` env var
- **TUI mode** (`/sync` slash command): show a TUI dialog prompting for the passphrase. Cache the derived key in memory for the session duration (cleared on exit). Subsequent `/sync` calls in the same session reuse the cached key without re-prompting.
- **Setup/Restore**: always interactive, passphrase entered in a TUI dialog or CLI prompt

### Server Compatibility

The sync server API is identical to hmem-sync v0.2.7. Existing server instances (including the Uberspace server) work without changes. The server sees only encrypted blobs — it cannot distinguish whether a blob comes from Heimdall or an agent.

### Per-Agent Blob Separation

All databases share a single `userId` on the server. Entry IDs are globally unique across stores because each store has its own ID sequence (`P0001` in Heimdall's store vs `P0001` in THOR's store would collide). To prevent this, the `id_hash` sent to the server is computed as `SHA-256("{db_name}:{entry_id}")` instead of just `SHA-256("{entry_id}")`. This namespaces blobs without requiring multiple server accounts. The server remains unaware of the separation — it's just different hashes.

### API Key (Future)

Config field `apiKey` is defined but unused in this version. When the website launches:
- API key replaces token-based auth
- Key stored in `sync/config.json`
- Unlocks premium features (higher storage, priority sync)

---

## 6. Migration & Backwards Compatibility

### Existing hmem Data

On first start, if `~/.hmem/memory.hmem` exists (from MCP server or plugin):

```
┌─ Memory Migration ──────────────────────────────┐
│                                                  │
│  Found existing memory at ~/.hmem/memory.hmem    │
│  (247 entries)                                   │
│                                                  │
│  ● Copy to ~/.config/heimdall/memory.hmem        │
│  ○ Skip (keep using MCP server separately)       │
│                                                  │
└──────────────────────────────────────────────────┘
```

- Copies the SQLite file (no move — MCP server may still use it)
- Marked as done: `~/.config/heimdall/migrated.json` with `{"hmem": true, "date": "..."}`

### Existing hmem-sync Config

If hmem-sync config files exist in the home directory:
- `.hmem-sync-config.json` → copied to `~/.config/heimdall/sync/config.json`
- `.hmem-sync-token` → copied to `~/.config/heimdall/sync/token`
- `.hmem-sync.json` → copied to `~/.config/heimdall/sync/state.json` (mapped to new format: existing flat `last_push_at`/`last_pull_at` become the `"heimdall"` key; agent databases start with `null` timestamps since they have never been synced)

Same crypto, same protocol — existing server accounts work without re-registration.

### Plugin Fallback

If `heimdall.json` or `opencode.json` still contains a `file://...heimdall-hmem...` plugin entry:
- The plugin is not loaded (native version takes priority)
- A warning is logged: "hmem plugin entry found in config — using native hmem instead"

---

## 7. Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Integration style | Built-in tools in `tool/registry.ts` | First-class citizen, no plugin API dependency |
| System prompt injection | Direct in `session/llm.ts` | No `experimental.*` hook dependency |
| SQLite access | `bun:sqlite` via `sqlite-adapter.ts` | Native Bun module, no extra dependency; adapter falls back to `better-sqlite3` for Node.js |
| Per-agent storage | Separate `.hmem` files | Simple isolation, independent sync, no schema changes |
| Agent ID normalization | Uppercase | Consistent filesystem naming, case-insensitive matching |
| Sync protocol | Identical to hmem-sync v0.2.7 | Server compatibility, proven crypto, no migration |
| Sync default | Heimdall enabled, agents disabled | Sensible default, user opts-in per agent |
| Local/global choice | TUI dialog on first chat | Zero-config UX, persisted in `.heimdall/config.json` |
| Migration | Copy (not move) | Non-destructive, MCP server keeps working |
| Heimdall reads agent hmem | Read-only via `hmem_read_agent` tool | All-seeing guardian, but agents own their memories |
| Compaction agent | Unchanged from previous spec | Already wired, tools resolve from ToolRegistry |

---

## 8. Dependencies

### From heimdall-hmem Plugin (port into fork)

All source files from `packages/heimdall-hmem/src/`:
- `store.ts`, `schema.ts`, `read.ts`, `write.ts`, `modify.ts`, `delete.ts`
- `tags.ts`, `related.ts`, `stats.ts`, `bulk-read.ts`, `render.ts`
- `compact.ts`, `parse.ts`, `types.ts`, `session-cache.ts`

### From hmem-sync npm Package (port into fork)

From `hmem-sync@0.2.7` dist:
- `sync.ts` — push/pull logic, state management
- `crypto.ts` — AES-256-GCM, scrypt, recovery key generation
- `server.ts` — NOT ported (server stays separate)

### Native Dependencies

- `bun:sqlite` — built into Bun runtime, used via `sqlite-adapter.ts` (ported from heimdall-hmem plugin)
- `node:crypto` — built-in, used for AES-256-GCM + scrypt

No new npm dependencies required. The `sqlite-adapter.ts` pattern (already proven in the plugin) dynamically imports `bun:sqlite` under Bun and falls back to `better-sqlite3` under Node.js.
