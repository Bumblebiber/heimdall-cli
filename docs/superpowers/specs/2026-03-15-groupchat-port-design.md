# /groupchat — Multi-Agent Chat for TypeScript Fork

**Date:** 2026-03-15
**Status:** Draft
**Author:** Bumblebiber + Claude Opus 4.6
**Ported from:** Go implementation on branch `feature/asgard-agent-identity`

## Summary

Port the `/groupchat` feature from the Go-based Heimdall CLI to the TypeScript OpenCode fork. Users start multi-agent conversations within a session, address agents with `@-mentions`, agents respond in parallel with color-coded headers, and the full transcript persists to each agent's native hmem on `/endchat`.

## Goals

1. **User-driven multi-agent chat** — `/groupchat` opens an agent picker, selected agents respond to `@-mentions`
2. **Parallel execution** — multiple agents run concurrently with budget tracking
3. **Context continuity** — agents see prior round summaries for coherent discussion
4. **hmem persistence** — each agent's transcript is saved to their native hmem on `/endchat`
5. **Mid-chat flexibility** — `/invite` adds participants without restart

## Non-Goals

- Coordinator mode (Heimdall as auto-moderator)
- Agent-to-agent direct communication
- Agent streaming (complete responses only)
- `/kick` command for removing participants
- Contract UI (scaffold only — field exists, no editing interface)

---

## 1. User Flow

```
1. User types "/groupchat" or Ctrl+K → "Group Chat"
2. Agent picker dialog: multi-select grouped by department
   - Heimdall pre-selected as observer
   - Minimum 2 active participants
3. Session enters groupchat mode
   - @-autocomplete shows participants + @All before files
   - Status footer: "Group Chat: 3 participants"
4. User: "@THOR @LOKI Review this authentication flow"
   - Mentions parsed, cleaned message dispatched to THOR + LOKI in parallel
   - Budget checked per agent before spawn
5. Responses appear with colored agent name headers
   - Each agent sees prior round summaries as context prefix
6. User: "/invite FENRIR" → adds to participants, assigns color
7. User: "/endchat"
   - Transcript saved to each agent's native hmem
   - Mode deactivated, normal session resumes
```

---

## 2. Groupchat State

A new Solid.js context `GroupchatProvider` manages the state, inline within the existing Session view (no separate route).

### State Shape

```typescript
interface GroupchatState {
  active: boolean
  participants: CatalogAgent[]      // from catalog.json
  observers: string[]               // agent IDs (e.g. "HEIMDALL")
  transcript: TranscriptEntry[]     // raw log for hmem persistence
  contract: string | null           // scaffold: injected as context, no UI
  budget: TaskBudget | null         // per-agent cost tracking
  rounds: RoundResult[]             // history for context injection
  semaphore: number                 // max concurrent agents (default 3)
  participantColors: Record<string, string>  // agent ID → color from theme palette
}

interface TranscriptEntry {
  agent: string                     // "" for user, matches SDK MessageV2 field
  content: string
  timestamp: string                 // ISO 8601
}

interface RoundResult {
  responses: Record<string, SpawnResult>  // plain object for Solid.js reactivity
  duration: number                  // ms
}

interface SpawnResult {
  agent: string
  content: string
  tokensIn: number
  tokensOut: number
  cost: number                      // USD
  duration: number                  // ms
  error?: string
}
```

### Context Provider

```typescript
// packages/opencode/src/cli/cmd/tui/context/groupchat.tsx
export const { use: useGroupchat, provider: GroupchatProvider } =
  createSimpleContext({
    name: "Groupchat",
    init: () => {
      const [store, setStore] = createStore<GroupchatState>({
        active: false,
        participants: [],
        observers: [],
        transcript: [],
        contract: null,
        budget: null,
        rounds: [],
        semaphore: 3,
        participantColors: {},
      })
      return {
        get active() { return store.active },
        get participants() { return store.participants },
        get observers() { return store.observers },
        get transcript() { return store.transcript },
        get rounds() { return store.rounds },
        start(participants, observers) { ... },
        addParticipant(agent) { ... },
        addTranscript(entry) { ... },
        addRound(result) { ... },
        end() { ... },
      }
    },
  })
```

Inserted inside the `Session()` component in `routes/session/index.tsx`, wrapping the session content. This is session-specific state (not app-global), so it does not belong in the top-level provider chain in `app.tsx`.

---

## 3. Agent Catalog Integration

### Data Source

The agent picker reads `catalog.json` directly (not via plugin tools). A lightweight loader in the fork:

```typescript
// packages/opencode/src/catalog/index.ts
interface CatalogAgent {
  id: string                // "THOR"
  name: string              // "Thor the Coder"
  department: string        // "Backend"
  persona: string           // full persona text
  specializations: string[] // ["Go", "Rust"]
  tier: "$" | "$$" | "$$$"
  provider?: string         // "anthropic" — separate field matching catalog.json
  model?: string            // "claude-sonnet-4-5" — model ID without provider prefix
  temperature?: number
  tools?: string            // "coder" | "researcher" | "reviewer" | "writer"
  role?: string
}

// Note: catalog.json stores provider and model as separate fields.
// The loader composes them into Provider.parseModel() format when
// building Agent.Info: `{ providerID: agent.provider, modelID: agent.model }`

function loadCatalog(catalogPath: string): CatalogAgent[]
function groupByDepartment(agents: CatalogAgent[]): Map<string, CatalogAgent[]>
```

### Catalog Location

The fork finds `catalog.json` via config directories (`.heimdall/catalog.json` or `configs/catalog.json` in the project root). The existing `heimdall-catalog` plugin continues providing LLM tools; this loader is only for the TUI agent picker.

---

## 4. TUI Components

### 4.1 Agent Picker Dialog

Triggered by `/groupchat` slash command. Uses the existing `dialog.replace()` overlay system.

```
┌─ Group Chat — Select Agents ────────────────────┐
│                                                  │
│  Backend                                         │
│  [x] THOR — Thor the Coder (Go, Rust)           │
│  [ ] FENRIR — Fenrir the Builder (CI/CD)        │
│                                                  │
│  Security                                        │
│  [x] LOKI — Loki the Trickster (pentesting)     │
│  [ ] HEIMDALL — Observer (pre-selected)     [O]  │
│                                                  │
│  Research                                        │
│  [ ] MIMIR — Mimir the Wise (analysis)          │
│                                                  │
│  Enter: confirm  Space: toggle  Esc: cancel      │
└──────────────────────────────────────────────────┘
```

**Component:** `component/dialog-groupchat.tsx`
**Pattern:** New multi-select component. Uses `DialogSelect` as visual starting point but requires multi-select with grouping — a fundamentally different interaction from the single-select `dialog-agent.tsx`. Reuses existing `fuzzysort` dependency (already in codebase via `autocomplete.tsx`) for fuzzy filtering.

**Props/State:**
```typescript
interface AgentPickerProps {
  agents: CatalogAgent[]               // from loadCatalog()
  onConfirm: (selected: CatalogAgent[], observers: string[]) => void
  onCancel: () => void
}

// Internal state (using createSignal for Set, since Solid.js stores don't proxy Sets):
const [selected, setSelected] = createSignal(new Set<string>())   // agent IDs
const [observers, setObservers] = createSignal(new Set<string>()) // observer IDs
const departments = createMemo(() => groupByDepartment(props.agents))
```

**Behavior:**
- Agents grouped by department with section headers
- Heimdall pre-selected as observer (marked with `[O]`)
- Space toggles selection, Enter confirms (minimum 2 active)
- Esc cancels, returns to normal session
- Fuzzy-filter input at top (like existing dialogs)

### 4.2 Message Rendering with Agent Headers

The existing `AssistantMessage` component already supports `message.agent` and `local.agent.color(message.agent)`. Changes needed:

**When `groupchat.active && message.agent`:**
- Render agent name as bold header above message content:
  ```
  ┃ THOR
  ┃ I've analyzed the authentication module. The JWT rotation...
  ┃ (claude-sonnet-4-5 · 42s)
  ```
- Left border color from groupchat participant color (see below)
- Agent name in same color, bold

> **Note:** The SDK `AssistantMessage` type already has a `message.agent` field (see `types.gen.ts:224`). No schema migration needed — groupchat simply sets this existing field.

**Color assignment:** `local.agent.color()` only knows registered agents — catalog agents like "THOR" would all get the same fallback color. Instead, `GroupchatState` maintains a `participantColors: Record<string, string>` map. Colors are assigned from the theme palette when agents join (on `/groupchat` confirm and `/invite`). The message renderer uses `groupchat.participantColors[message.agent]` when groupchat is active.

**Implementation:** Modify `AssistantMessage` in `routes/session/index.tsx`:
```tsx
// Before the parts loop, if agent is set and groupchat is active:
const gc = useGroupchat()
// ...
<Show when={gc.active && props.message.agent}>
  <text bold fg={gc.participantColors[props.message.agent] ?? local.agent.color(props.message.agent)}>
    {props.message.agent.toUpperCase()}
  </text>
</Show>
```

### 4.3 @-Autocomplete Extension

The existing autocomplete in `component/prompt/autocomplete.tsx` already shows agents. During groupchat mode, the list is filtered to show only participants + `@All`:

```typescript
// In autocomplete.tsx — useGroupchat() MUST be called at component top level (Solid.js rule):
const gc = useGroupchat()

// Then reference gc.active / gc.participants inside the memo:
const agents = createMemo(() => {
  if (gc.active) {
    // Show @All + participants only
    return [
      { value: "All", label: "@All", type: "agent" },
      ...gc.participants.map(a => ({
        value: a.id, label: `@${a.id}`, type: "agent"
      })),
    ]
  }
  // Existing behavior: all non-hidden agents from sync.data.agent
  return sync.data.agent.filter(...)
})
```

### 4.4 Footer Status

When groupchat is active, the session footer shows:
```
Group Chat: THOR, LOKI, FENRIR (+1 observer) | Budget: $0.42/$1.00
```

Modify `routes/session/footer.tsx` to check `groupchat.active`.

---

## 5. Slash Commands

Three new commands registered in the Session scope via `command.register()`:

### /groupchat
- **When:** Always available
- **Action:** Opens agent picker dialog → starts groupchat mode
- **Keybind:** None (Ctrl+K → "Group Chat" also works)

### /endchat
- **When:** Only when `groupchat.active === true`
- **Action:** Saves transcript to hmem, deactivates mode
- **Hidden when:** Groupchat not active

### /invite
- **When:** Only when `groupchat.active === true`
- **Action:** Opens a picker dialog (same component as `/groupchat` but filtered to show only non-participant catalog agents). No argument parsing needed — consistent with existing command UX.

**Registration in `routes/session/index.tsx`:**
```typescript
command.register(() => [
  {
    value: "groupchat",
    title: "Start Group Chat",
    slash: { name: "groupchat" },
    onSelect: (dialog) => openAgentPicker(dialog),
  },
  ...(groupchat.active ? [
    {
      value: "endchat",
      title: "End Group Chat",
      slash: { name: "endchat" },
      onSelect: () => endGroupChat(),
    },
    {
      value: "invite",
      title: "Invite Agent to Group Chat",
      slash: { name: "invite" },
      onSelect: (dialog) => openInviteDialog(dialog),
    },
  ] : []),
])
```

---

## 6. @-Mention Parsing

### Parser

```typescript
// packages/opencode/src/groupchat/mention.ts
function parseMentions(
  text: string,
  participants: string[],
): { mentioned: string[]; cleaned: string }
```

**Rules:**
1. Regex: `@(\w+)` extracts all mentions
2. `@All` / `@all` (case-insensitive) expands to all participants
3. Unknown mentions are left in the cleaned message
4. Known mentions are removed, multiple spaces normalized
5. Duplicates removed (mention same agent twice → appears once)
6. If no valid mentions → message is sent to the default agent as a normal chat message (groupchat mode stays active but the message is treated as a regular prompt, not dispatched to any groupchat participant)

**Examples:**
| Input | Participants | mentioned | cleaned |
|-------|-------------|-----------|---------|
| `@THOR review code` | [THOR, LOKI] | ["THOR"] | "review code" |
| `@THOR @LOKI review` | [THOR, LOKI] | ["THOR", "LOKI"] | "review" |
| `@All review` | [THOR, LOKI] | ["THOR", "LOKI"] | "review" |
| `@UNKNOWN review` | [THOR, LOKI] | [] | "@UNKNOWN review" |
| `no mention` | [THOR, LOKI] | [] | "no mention" |

---

## 7. Agent Execution

### Dispatch Model

Uses server-side dispatch via `SessionProcessor` (same pattern as compaction at `session/compaction.ts`). Catalog agents do NOT go through the agent registry — they are dispatched directly by creating messages and invoking `SessionProcessor.create()` with custom parameters.

**Why not the agent registry:** OpenCode's `Agent.Info` is a Zod schema loaded from config. Catalog agents are ephemeral and potentially hundreds — injecting them into the registry would pollute it. Instead, we build agent parameters inline and dispatch through the processor.

```typescript
// packages/opencode/src/groupchat/dispatch.ts
import { Agent } from "@/agent"
import { PermissionNext } from "@/permission/next"

// Build a full Agent.Info for a catalog agent (required by SessionProcessor):
function buildAgentInfo(
  catalogAgent: CatalogAgent,
  contextPrefix: string,
  contract: string | null,
): Agent.Info {
  return {
    name: catalogAgent.id,
    mode: "subagent",
    permission: resolveToolset(catalogAgent.tools),
    options: {},
    prompt: buildAgentPrompt(catalogAgent, contextPrefix, contract),
    model: catalogAgent.provider && catalogAgent.model
      ? { providerID: catalogAgent.provider, modelID: catalogAgent.model }
      : undefined,  // falls back to session default
    temperature: catalogAgent.temperature,
  }
}

// Compose agent system prompt from persona + contract + context:
function buildAgentPrompt(
  agent: CatalogAgent,
  contextPrefix: string,
  contract: string | null,
): string {
  return [agent.persona, contract, contextPrefix].filter(Boolean).join("\n\n")
}

// Toolset → permission mapping (Config.Permission format, converted via PermissionNext.fromConfig).
// Modeled after existing agent configs in agent.ts (e.g., "explore" agent at line 135-158).
const TOOLSET_CONFIGS: Record<string, Record<string, string>> = {
  coder:      { "*": "allow" },
  researcher: { grep: "allow", glob: "allow", read: "allow", webfetch: "allow", list: "allow", "*": "deny" },
  reviewer:   { grep: "allow", glob: "allow", read: "allow", list: "allow", "*": "deny" },
  writer:     { grep: "allow", glob: "allow", read: "allow", write: "allow", edit: "allow", list: "allow", "*": "deny" },
}

function resolveToolset(toolset?: string): PermissionNext.Ruleset {
  const config = TOOLSET_CONFIGS[toolset ?? "researcher"] ?? TOOLSET_CONFIGS.researcher
  return PermissionNext.fromConfig(config)
}
```

**Dispatch call (3-step pattern, modeled after `compaction.ts:185-240`):**
1. `Session.updateMessage()` — create the assistant message with required fields (`id`, `parentID`, `role: "assistant"`, `agent: catalogAgent.id`, `sessionID`, `modelID`, `providerID`, etc.)
2. `SessionProcessor.create(messageID)` — create processor for that message
3. `processor.process({ user, agent: agentInfo, abort, sessionID, system, messages, tools, model })` — run the LLM stream with resolved tools and system prompts

The processor handles LLM streaming, tool execution, and message persistence. The response message's `agent` field is set to the catalog agent ID for attribution.

### Round Execution

```typescript
// packages/opencode/src/groupchat/round.ts
async function runRound(
  message: RoundMessage,
  state: GroupchatState,
  sessionID: string,
): Promise<RoundResult>
```

**Flow:**
1. Parse mentions from user message
2. Build context prefix from prior rounds
3. For each mentioned agent (up to `semaphore` concurrent):
   - Check budget
   - Build `Agent.Info` via `buildAgentInfo()`
   - Dispatch via `SessionProcessor.create()` with agent-specific params
   - Set `message.agent = catalogAgent.id` on the response for attribution
   - Record response in transcript
4. Return `RoundResult` with all responses

### Context Injection

Each agent receives prior rounds as a prefix:

```
## Prior discussion

### Round 1
THOR:
I analyzed the auth module and found three issues...

LOKI:
From a security perspective, the token rotation is vulnerable...

---

<user's cleaned message>
```

Built by `buildContextPrefix(rounds: RoundResult[])`.

### Concurrency Control

A semaphore limits concurrent agent spawns (default 3). Prevents overloading API rate limits when 10+ agents are mentioned with `@All`.

---

## 8. Budget & Cost Tracking

### TaskBudget

```typescript
// packages/opencode/src/groupchat/budget.ts
interface TaskBudget {
  limit: number              // USD
  spent: number              // cumulative
  estimates: Record<string, number>  // agent → estimated cost
  actuals: Record<string, number>    // agent → actual cost
}

function canAfford(budget: TaskBudget, estimate: number): boolean
function record(budget: TaskBudget, agent: string, cost: number): void
function estimateCost(tier: string): number
```

**Tier defaults:**
- `$` (cheap): $0.02 per call
- `$$` (mid): $0.05 per call
- `$$$` (expensive): $0.10 per call

**Pre-spawn check:** If agent's estimated cost exceeds remaining budget, agent is skipped with error in `SpawnResult`.

**Post-spawn recording:** Actual cost calculated from token counts + model pricing.

**Budget is optional.** If no budget set, all agents proceed without limit.

---

## 9. hmem Persistence on /endchat

### Flow

When user types `/endchat`:
1. For each participant + observer:
   - Open agent's native hmem via `Hmem.openAgentStore(agentId)`
   - Build structured entry (L2 summary, L3 details, L5 raw transcript)
   - Write as P-prefixed entry with tag `#groupchat`
   - Store closes lazily (managed by `Hmem`)
2. Reset groupchat state
3. System message: "Group chat ended. Memory saved for N agents."

### Entry Structure

```
Group chat: <topic from first user message>
	Participants: THOR, LOKI
	Observers: HEIMDALL
	Rounds: 3, Duration: 4m 32s
		User: @THOR @LOKI Review this authentication flow
		THOR: I've analyzed the auth module and found three issues...
		LOKI: From a security perspective, the token rotation is vulnerable...
		User: @All What's the fix?
		THOR: We should implement token rotation with a 15-minute window...
		LOKI: Agreed, and add HMAC verification on the refresh endpoint...
```

**L2** (line 1): Summary title (120 chars max)
**L3** (tab-indented): Participants, observers, stats
**L5** (double-tab-indented): Full raw transcript with `Speaker: content` format

**Concrete write call:**
```typescript
import { write } from "@/hmem/write"
import { Hmem } from "@/hmem"
const store = await Hmem.openAgentStore(agentId)
write(store, "P", formattedTranscript, { tags: ["groupchat"] })
```

---

## 10. Database Schema

**No migration needed.** The SDK `AssistantMessage` type already has an `agent: string` field (see `types.gen.ts:224` and `message-v2.ts:421`). This field is stored in the JSON `data` column of the messages table. Groupchat agent responses simply set `message.agent = "THOR"` — the existing schema supports this out of the box.

---

## 11. Error Handling

| Error | Behavior |
|-------|----------|
| Agent not in catalog | Error before spawn, skip agent |
| Budget exhausted | Error before spawn, skip agent |
| LLM API error | Record error in SpawnResult, continue round |
| Timeout | Cancel agent context, record error |
| All agents fail | Round completes with error messages |
| /invite unknown agent | Error message, no state change |
| /invite duplicate | Warning "already a participant" |

Individual agent failures never abort the entire round. Users see both successful responses and error messages.

---

## 12. Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| View model | Inline in Session (mode toggle) | Session already has messages, autocomplete, colors |
| Agent execution | OpenCode's built-in subagent system | Reuses LLM dispatch, tool resolution, permissions |
| Catalog source | Direct JSON read (not plugin) | Agent picker needs structured data, not tool output |
| State management | New `GroupchatProvider` context | Follows existing pattern (SyncProvider, LocalProvider) |
| @-mention parsing | Regex-based, case-insensitive | Simple, proven in Go implementation |
| Concurrency | Semaphore (default 3) | Prevents API rate limit issues |
| hmem persistence | Native hmem via `Hmem.openAgentStore()` | Already implemented, per-agent isolation |
| Contract | Scaffold only (field + injection) | YAGNI — no UI until needed |
| Multi-provider | Supported via `Agent.Info.model` | Each agent can use different provider/model |
| Budget | Optional, tier-based estimation | Useful but not blocking for MVP |
| Message attribution | Existing `message.agent` field | Already in SDK types, no migration needed |
| Agent dispatch | Direct `SessionProcessor.create()` | Avoids polluting agent registry with ephemeral catalog agents |

---

## 13. File Structure

> All paths are relative to `packages/opencode/` in the fork repository.

### Files to Create

| File | Responsibility |
|------|---------------|
| `src/groupchat/mention.ts` | @-mention parsing |
| `src/groupchat/round.ts` | Round execution, context injection, semaphore |
| `src/groupchat/dispatch.ts` | Agent parameter building, toolset resolution |
| `src/groupchat/budget.ts` | Cost estimation, tracking, budget enforcement |
| `src/groupchat/transcript.ts` | Transcript formatting for hmem |
| `src/groupchat/index.ts` | Public API: startGroupchat, endGroupchat, runRound |
| `src/catalog/index.ts` | Catalog loader (JSON → CatalogAgent[]) |
| `src/cli/cmd/tui/context/groupchat.tsx` | GroupchatProvider context |
| `src/cli/cmd/tui/component/dialog-groupchat.tsx` | Agent multi-select picker dialog |
| `test/groupchat/mention.test.ts` | Mention parsing tests |
| `test/groupchat/round.test.ts` | Round execution tests |
| `test/groupchat/budget.test.ts` | Budget tracking tests |
| `test/groupchat/transcript.test.ts` | hmem formatting tests |

### Files to Modify

| File | Change |
|------|--------|
| `src/cli/cmd/tui/routes/session/index.tsx` | Register slash commands, modify message rendering, wrap with GroupchatProvider, color assignment |
| `src/cli/cmd/tui/routes/session/footer.tsx` | Groupchat status in footer |
| `src/cli/cmd/tui/component/prompt/autocomplete.tsx` | Filter agents during groupchat |

---

## 14. Dependencies

- **Native hmem** (from previous spec) — `Hmem.openAgentStore()` for persistence
- **Agent system** — OpenCode's built-in agent/subagent dispatch
- **Catalog JSON** — `configs/catalog.json` or `.heimdall/catalog.json`
- **TUI framework** — Solid.js, existing dialog/command/autocomplete infrastructure
- **`fuzzysort`** — already in codebase (used by `autocomplete.tsx`), reused for agent picker fuzzy filter
- **No new npm dependencies**
