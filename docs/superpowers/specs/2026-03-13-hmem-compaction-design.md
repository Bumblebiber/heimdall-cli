# hmem as Compaction Engine

**Date:** 2026-03-13
**Status:** Draft
**Branch:** TBD

## Summary

Replace OpenCode's built-in text-summary compaction with hmem-based structured
memory writes. When a session hits its token limit, a specialized agent splits
the conversation into thematic chunks and writes each as a hierarchical hmem
entry (L1–L5). The session retains only a minimal reference message. Future
context is delivered via hmem's BulkRead through the auto-recall hook.

## Motivation

OpenCode's current compaction generates a flat text summary (~3k tokens) that
is included in every subsequent LLM call. This approach:

- Wastes tokens on a static summary in every message
- Loses nuance — a 100k-token conversation becomes 3k of prose
- Knowledge dies with the session — the summary is not queryable or reusable
- Cannot distinguish between project progress, learnings, errors, and decisions

hmem was designed from the start with BulkRead V2 — a smart selection algorithm
that surfaces the right entries at the right time (newest + favorites +
most-accessed). This is exactly what compaction needs: a system that preserves
everything but only shows what matters.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Trigger | Token overflow (existing) | Natural boundary, full conversation available |
| Agent | Dedicated "hmem-compaction" | Focused prompt, no distractions |
| Default model | Haiku (configurable) | Text summarization, not reasoning — cheap is fine |
| Tools | hmem_list, hmem_read, hmem_write, hmem_append, hmem_search, hmem_tag | L1 listing + structured writes + search/tag management |
| Entry placement | Append to matching L1 entry, new root only as fallback | Build the tree, don't scatter |
| L5 content | Full conversation minus tool outputs | Tool outputs are reproducible, dialog is not |
| L5 char limit | None | Archive layer — full original wording |
| Session summary | Minimal reference ("Compacted → P0037.14, L0118") | Safety net, near-zero token cost |
| BulkRead adjustment | L2 full body + session-recency boost (experimental) | Compensate for missing text summary |
| Depth default | 4 (L5 only on explicit read) | Keep BulkRead lean, archive on demand |

## Architecture

### Compaction Flow

```
Token overflow detected (existing SessionCompaction.isOverflow)
  │
  ├─ Spawn hmem-compaction agent (hidden, no bash/edit tools)
  │    │
  │    ├─ Input: full message history + hmem L1 entries (via hmem_read)
  │    │
  │    ├─ Step 1: Identify thematic chunks in conversation
  │    │   - A chunk = one coherent topic (bug fix, feature, discussion, etc.)
  │    │   - Chunk boundaries: topic shifts, user redirections, new tasks
  │    │
  │    ├─ Step 2: For each chunk, decide placement:
  │    │   - Scan L1 entries for matching context
  │    │   - Active [★] project matches → hmem_append(projectId, ...)
  │    │   - Other L1 match (e.g. existing L-entry about same topic) → hmem_append
  │    │   - No match → hmem_write(prefix, ...) as new root entry
  │    │
  │    ├─ Step 3: Write each chunk as hierarchical entry:
  │    │   - L1: One-line summary (max 120 chars)
  │    │   - L2: Extended summary (max 300 chars)
  │    │   - L3: Context, decisions, key details (max 800 chars)
  │    │   - L4: Full narrative with code refs (max 2000 chars)
  │    │   - L5: Original conversation wording (no limit, no tool outputs)
  │    │   - Tags: 1-3 mandatory hashtags per chunk
  │    │   - Prefix: P/L/E/D/T/M as appropriate
  │    │
  │    └─ Step 4: Generate minimal summary message
  │        "Compacted → P0037.14, L0118, E0095. Current task: [brief]"
  │
  ├─ Summary stored as message (summary: true) — safety net
  │
  ├─ Bus.publish(Event.Compacted)
  │
  └─ Session continues (replay or synthetic continue message)
```

### Context Recovery (Auto-Recall)

```
Next LLM call in session (or new session)
  │
  ├─ experimental.chat.system.transform hook fires
  │
  ├─ BulkRead V2 selects entries:
  │   - Per-prefix: 60% newest + 40% most-accessed
  │   - All favorites [♥] and pinned [P] always included
  │   - Session-recency boost: entries < 24h old get full L1-L4 expansion
  │   - Older entries: L1 + L2 full body (not just title)
  │   - Default depth: 4 (L5 excluded)
  │
  ├─ Rendered and injected into system prompt
  │
  └─ Agent has full context from hmem — no text summary needed
```

### Char Limits (Updated)

| Level | Current | New | Purpose |
|-------|---------|-----|---------|
| L1 | 120 | 120 | Title — always visible in BulkRead |
| L2 | 200 | **300** | Extended summary — shown in BulkRead for expanded entries |
| L3 | 300 | **800** | Context, decisions — loaded on demand or session-recency |
| L4 | 400 | **2000** | Full narrative — loaded on demand |
| L5 | 0 (unlimited) | **0 (unlimited)** | Archive — original wording, only explicit read |

### Compaction Agent Definition

```
Agent: hmem-compaction
Mode: primary
Hidden: true
Native: true
Model: haiku (configurable via heimdall.json compaction.model)
Tools: hmem_list, hmem_read, hmem_write, hmem_append, hmem_search, hmem_tag
Prompt: agent/prompt/hmem-compaction.txt
```

### Agent Prompt (Key Instructions)

The compaction agent prompt must cover:

1. **Read L1 entries first** — understand what's already in memory
2. **Identify thematic chunks** — split the conversation at topic boundaries
3. **Categorize each chunk:**
   - P = project progress (append to active project if match)
   - L = lesson learned, best practice discovered
   - E = error encountered and fixed (root cause + fix)
   - D = decision made with rationale
   - T = task noted for future work
   - M = milestone reached
4. **Build L1→L5 hierarchy** — each level summarizes the one below
5. **L5 rules:** include User/Agent dialog verbatim, tool outputs as
   references only ("Read src/store.ts: 150 lines"), no tool results
6. **Tag rules:** 1-3 mandatory hashtags, lowercase, descriptive
7. **Placement rules:**
   - If a chunk matches an existing L1 entry → append there
   - Active [★] projects have priority for project-related chunks
   - Only create new root entries when no match exists
8. **Generate summary message** — one line listing written IDs + current task

### BulkRead Adjustments

Two changes to support compaction replacement:

1. **L2 full body** — expanded entries show the complete L2 content (up to 300
   chars) instead of just the 50-char title truncation. This provides enough
   context for session continuation without needing the text summary.

2. **Session-recency boost** (experimental) — entries written in the last 24
   hours automatically get full expansion (L1-L4) regardless of V2 selection
   slots. This ensures just-compacted entries are fully visible in the next
   message. After 24h they follow normal V2 selection rules.

Both changes are backwards-compatible and improve BulkRead for all use cases,
not just compaction.

### Configuration

In `heimdall.json`:

```json
{
  "compaction": {
    "auto": true,
    "model": {
      "providerID": "anthropic",
      "modelID": "claude-haiku-4-5-20251001"
    }
  }
}
```

Any configured provider/model can be used. Default: Haiku.

## Implementation Scope

### Core Patch (Fork)

- New agent definition: `hmem-compaction` in agent registry
- Agent prompt file: `agent/prompt/hmem-compaction.md`
- Compaction flow: wire hmem-compaction agent instead of default compaction
- Allow hmem tools for the compaction agent (tool access control)

### Plugin Changes (heimdall-hmem)

- Updated char limits: L2→300, L3→800, L4→2000
- BulkRead: L2 full body rendering
- BulkRead: session-recency boost (experimental, behind config flag)
- Remove the compaction prompt injection from current implementation
  (the `experimental.session.compacting` hook becomes unnecessary)

### Not In Scope (Future)

- Tag-based thematic grouping in BulkRead display (mentioned in brainstorm)
- Automatic deduplication of similar entries
- Progressive detail loading in TUI (show L1-L3, load L4-L5 on click)

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| LLM generates poor chunks | Detailed prompt + Haiku is good at structured tasks |
| Too many entries per compaction | Prompt limits: "3-7 chunks per session, merge related topics" |
| hmem DB grows fast with L5 | L5 excluded from BulkRead, sync priced by MB |
| Auto-recall fails (plugin not loaded) | Minimal summary message as safety net |
| Agent writes duplicates | Agent reads L1 first, prompt instructs dedup |
| Upstream OpenCode changes compaction flow | Small, isolated patch — easy to rebase |

## Files Changed/Created

| File | Change |
|------|--------|
| `packages/opencode/src/agent/agent.ts` | Add hmem-compaction agent definition |
| `packages/opencode/src/agent/prompt/hmem-compaction.md` | **New** — compaction agent prompt |
| `packages/opencode/src/session/compaction.ts` | Wire hmem-compaction agent, allow hmem tools |
| `packages/heimdall-hmem/src/types.ts` | Updated CHAR_LIMITS: L2→300, L3→800, L4→2000 |
| `packages/heimdall-hmem/src/render.ts` | BulkRead L2 full body rendering |
| `packages/heimdall-hmem/src/bulk-read.ts` | Session-recency boost logic |
| `packages/heimdall-hmem/src/index.ts` | Remove compaction prompt injection |
