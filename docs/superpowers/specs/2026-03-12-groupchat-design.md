# /groupchat — User-Triggered Multi-Agent Chat

**Date:** 2026-03-12
**Status:** Draft
**Branch:** feature/asgard-agent-identity

## Summary

A `/groupchat` slash command lets the user start a multi-agent conversation inline
in the current session. Agents respond only when addressed with `@Name` or `@All`.
Responses are rendered with color-coded agent headers. The chat ends explicitly
with `/endchat`.

## User Flow

```
1. User types /groupchat (or Ctrl+K → "Group Chat")
2. Agent multi-select appears: all 52 agents grouped by department
   - Heimdall is pre-selected as observer (opt-out possible)
   - Space to toggle, Enter to confirm (minimum 2 active participants)
3. Chat mode active — @-autocomplete shows participants + @All
4. User sends: @THOR @LOKI Review this authentication flow
5. THOR and LOKI spawn in parallel, responses appear after all agents finish
   - Each agent sees prior round summaries as context
   - Heimdall observes silently (reads all, does not respond unless @-mentioned)
6. User can /invite AGENT to add participants mid-chat
7. User sends: /endchat → hmem write for each agent → back to normal mode
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Command access | Both Ctrl+K and `/`-prefix | User expectation from spec; Ctrl+K fits existing infra |
| Agent selection | Single multi-select, grouped by department | Cross-department teams are common; visual grouping keeps it navigable |
| @-Mention | Autocomplete popup (like @-file) | Consistent UX, prevents typos |
| Agent responses | Color-coded name headers | Clearest identification in linear chat |
| Coordination | User-driven (no auto-coordinator) | MVP simplicity; coordinator mode reserved for internal triggers |
| Session model | Inline in current session | User keeps context, no session switching |
| Parallelism | Agents run in parallel | Main benefit of group chat; budget/semaphore already exist |
| Termination | Explicit `/endchat` | Clear boundary, no ambiguity |
| Context sharing | Agents see prior round summaries | Enables real discussion, not isolated answers |
| Heimdall | Auto-joined as observer | Builds context for future coordination; opt-out possible |
| Memory persist | hmem write on /endchat | Summary (L2) + raw transcript (L5) per agent |
| Mid-chat join | `/invite AGENT` command | Flexibility without restart |

## Components

### 1. Slash-Prefix Handler (new)

**Location:** `internal/tui/components/chat/editor.go`

When input starts with `/` **as the first character on an otherwise empty line**,
show an autocomplete popup of registered commands. Reuses the existing `Command`
registry from `dialog/commands.go`. This makes all Ctrl+K commands also accessible
via `/` prefix. The `/` trigger is suppressed when the line already has other content
(e.g. file paths, regex) to avoid false positives.

**Parsing:**
- On each keystroke, if entire input is `/` + optional chars: filter commands by prefix match
- Enter on match: execute command handler
- Esc or backspace past `/`: dismiss

**New commands to register:**
- `/groupchat` — starts group chat flow
- `/endchat` — ends group chat mode, persists to hmem
- `/invite` — add agent mid-chat (only visible during active group chat)

### 2. Agent Multi-Select with Department Groups (new component)

**Location:** `internal/tui/components/dialog/groupchat.go` (new file)
**Generic component:** `internal/tui/components/util/multi-select.go` (new file)

A single multi-select list showing **all agents grouped by department**. Department
names are rendered as non-selectable section headers. Agents within each section
are selectable.

```
┌─ Select Agents ──────────────────────────────┐
│                                              │
│  ── Backend ──                               │
│  [x] THOR      expensive  coder             │
│  [ ] MAGNI     cheap      coder             │
│  [ ] MODI      standard   coder             │
│                                              │
│  ── Security ──                              │
│  [x] LOKI      expensive  researcher        │
│  [ ] FENRIR    standard   reviewer          │
│                                              │
│  ── Coordination ──                          │
│  [x] HEIMDALL  expensive  coordinator  (observer) │
│                                              │
│  Enter: confirm (2+ selected)  Esc: cancel   │
└──────────────────────────────────────────────┘
```

**Heimdall is pre-selected** as observer (marked with "(observer)" badge). He can
be deselected if the user does not want context tracking. Other agents default to
unselected.

```go
type MultiSelect[T MultiSelectItem] struct {
    items      []T
    sections   []Section         // department group headers
    selected   map[int]bool
    cursor     int
    maxVis     int
}

type Section struct {
    Title    string
    StartIdx int  // index into items where this section begins
}

type MultiSelectItem interface {
    Title() string
    Description() string
    IsSelected() bool
}
```

**Keys:**
- Up/Down (or K/J): navigate (skips section headers)
- Space: toggle selection
- Enter: confirm (minimum 2 active participants, observer does not count)
- Esc: cancel

**Data source:** `Catalog.GroupByDepartment()` — **new method** on
`internal/agent/catalog.go`. Returns `map[string][]AgentSpec` with department
names as keys, sorted alphabetically.

### 4. GroupChat State

**Location:** `internal/tui/page/chat.go` (extend existing)

```go
type groupChatState struct {
    Active       bool
    Participants []agent.AgentSpec
    Observers    []string                   // agent IDs in read-only mode (e.g. HEIMDALL)
    Colors       map[string]lipgloss.Color  // agentID → color
    GroupChat     *agent.GroupChat
    Transcript   []TranscriptEntry          // raw log for hmem persistence
}

type TranscriptEntry struct {
    AgentID string    // "" for user messages
    Content string
    Time    time.Time
}

// Initialized from app.App during InitGroupChatMsg handling.
// GroupChat.LSPClients, .Perms, .Files, .Subscriptions are wired from app fields.
// Observers receive round summaries but are not spawned unless @-mentioned.
```

**Color assignment:** Colors are assigned **sequentially** from participants list
(not by hash) to guarantee no collisions within a group chat. The palette has 16
colors; if more than 16 participants (unlikely), it wraps around.

```go
var agentColors = []lipgloss.Color{
    "#E06C75", "#61AFEF", "#98C379", "#E5C07B",
    "#C678DD", "#56B6C2", "#BE5046", "#D19A66",
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
    "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
}

func assignColors(participants []agent.AgentSpec) map[string]lipgloss.Color {
    colors := make(map[string]lipgloss.Color)
    for i, p := range participants {
        colors[p.ID] = agentColors[i % len(agentColors)]
    }
    return colors
}
```

### 5. @-Mention Autocomplete (Combined List)

**Location:** `internal/tui/components/chat/editor.go` (extend existing)

`@` currently triggers file/folder completion. In groupchat mode, `@` shows a
**combined list**: agents first, then files — separated by a visual divider.
This avoids conflicting with file references and needs no new keybinding.

```
@-Completion popup (during groupchat):
  @All
  @THOR
  @LOKI
  @HEIMDALL
  ── Files ──
  src/auth/jwt.go
  src/auth/middleware.go
  ...
```

Implementation: A `combinedCompletionProvider` that wraps both the agent list
and the existing `FileAndFolderContextGroup`. `GetChildEntries(query)` returns
agent matches first, then a separator item, then file matches.

```go
func (p *combinedProvider) GetChildEntries(query string) ([]CompletionItemI, error) {
    var items []CompletionItemI
    // Agent entries (only during active groupchat)
    items = append(items, agentEntries(query, p.participants)...)
    // Separator
    items = append(items, &separatorItem{title: "── Files ──"})
    // File entries (existing behavior)
    fileItems, _ := p.fileProvider.GetChildEntries(query)
    items = append(items, fileItems...)
    return items, nil
}
```

When groupchat is not active, the existing file-only provider is used unchanged.

**@-Mention parsing** (new function in `internal/agent/mention.go`):

```go
// ParseMentions extracts @AgentID tokens from a message.
// Returns the set of mentioned agent IDs and the cleaned message text.
func ParseMentions(text string, participants []string) (mentioned []string, cleaned string)
```

Rules:
- `@All` → all participants
- `@THOR` → just THOR
- `@THOR @LOKI do X` → THOR and LOKI
- No `@` → warning shown: "Use @Name or @All to address agents. Send without @ to talk to the default assistant."
  User can choose: send to default coder agent, or re-edit with @-mention
- Unknown `@Name` → ignored (autocomplete prevents this in practice)
- `@All` matching is case-insensitive

### 6. Parallel Agent Dispatch

**Location:** `internal/tui/page/chat.go` (extend `sendMessage`)

When groupchat is active and message contains @-mentions:

1. Parse mentions from message text
2. Build context prefix from prior rounds via `SummarizeRound()` (already exists)
3. Create `RoundMessage{Targets: mentioned, Content: context + cleaned}`
4. Dispatch via `tea.Cmd` (background goroutine) — **never block the TUI goroutine**
5. `RunRound` executes in the background, returns `RoundResult`
6. Result delivered as `GroupChatResultMsg` back to `Update()`
7. For each response: create a message with `AgentID` set
8. Append all entries (user message + agent responses) to `Transcript`

**Context injection:** Each agent receives a prefix showing what other agents said
in prior rounds. Format: `"THOR: <summary>\nLOKI: <summary>\n\n<user's new message>"`.
This enables agents to build on each other's work.

```go
func (p *chatPage) dispatchGroupRound(roundMsg agent.RoundMessage) tea.Cmd {
    return func() tea.Msg {
        result, err := p.groupChat.GroupChat.RunRound(context.Background(), roundMsg)
        return GroupChatResultMsg{Result: result, Err: err}
    }
}
```

Uses existing `GroupChat.RunRound()` from `internal/agent/group.go`:
- Budget check per agent
- Semaphore-based concurrency limit
- Parallel goroutine execution
- `wg.Wait()` blocks inside the Cmd goroutine, not the TUI thread

### 7. Message Rendering with Agent Identity

**Location:** `internal/message/content.go` + `internal/tui/components/chat/message.go`

**Model change:** Add optional `AgentID` field to `Message`:

```go
type Message struct {
    // ... existing fields
    AgentID string  // empty for normal assistant, set for group chat agents
}
```

**Database migration:** Add `agent_id TEXT` column to messages table (nullable).

**sqlc impact:** Requires updating the sqlc query definitions for messages (INSERT
and SELECT) to include `agent_id`, then regenerating with `sqlc generate`. The
`CreateMessageParams` struct and `service.Create()` must accept the new field.
Existing messages with `NULL` agent_id render as normal assistant messages.

**Rendering change** in `renderAssistantMessage()`:

```go
if msg.AgentID != "" {
    color := colorForAgent(msg.AgentID)
    header := baseStyle.Foreground(color).Bold(true).
        Render(fmt.Sprintf("%s:", msg.AgentID))
    // render header above message content, e.g. "THOR:" in red
}
```

**Important:** The agent name is always shown as text prefix (`THOR: ...`), not
just as color. This ensures the transcript is readable in hmem persistence and
session history reload where colors may not be available.

### 8. `/endchat` Command

Registered alongside `/groupchat`. Handler:

1. Sets `groupChatState.Active = false`
2. Writes hmem for each participant (see section 9)
3. Injects a system message: "Group chat ended. Participants: THOR, LOKI, ..."
4. Clears participants, colors, and transcript
5. @-autocomplete reverts to file mode

### 9. hmem Persistence on `/endchat`

For each participant (including observers), write a memory entry to their `.hmem`:

**Structure:**
- **L2 (summary):** One-line summary of the group chat topic and outcome
- **L3 (details):** Who participated, key decisions, action items
- **L5 (raw transcript):** Full chat log with speaker attribution

```
P
Group chat: Review authentication flow
	Participants: THOR, LOKI, HEIMDALL (observer)
	Key outcome: agreed on JWT rotation strategy
	THOR proposed refresh token rotation every 24h
	LOKI flagged timing attack vector on token validation
		User: @THOR @LOKI Review this authentication flow
		THOR: I've analyzed the auth module. The current implementation...
		LOKI: From a security perspective, I see two concerns...
		User: @THOR Can you address LOKI's timing attack concern?
		THOR: Good catch. We should use constant-time comparison...
```

The transcript includes `AgentName:` prefixes on every entry so it's clear who
said what, even without colors. User messages are prefixed with `User:`.

**Implementation:** `internal/agent/groupchat_memory.go` (new file)

```go
func PersistGroupChat(participants []AgentSpec, observers []string,
    transcript []TranscriptEntry, topic string) error
```

Opens each agent's `.hmem`, writes one P-prefixed entry with the structure above.
Uses the existing `hmem.Open()` + `store.Write()` API.

### 10. `/invite AGENT` Command

Available only during active group chat. Adds a new participant mid-conversation.

1. Validates agent exists in catalog
2. Adds to `groupChatState.Participants`
3. Assigns next sequential color
4. Adds to @-autocomplete list
5. Injects system message: "FENRIR joined the group chat"
6. New agent receives full transcript summary as context on first @-mention

## Data Flow

```
/groupchat
  │
  ├─ AgentMultiSelectMsg → show grouped agent list (Heimdall pre-selected)
  │    └─ AgentsSelectedMsg(active: ["THOR", "LOKI"], observers: ["HEIMDALL"])
  │
  ├─ InitGroupChatMsg → create GroupChat controller, assign colors
  │    └─ groupChatState.Active = true
  │
  └─ (chat mode active)

User types: @THOR @LOKI Review auth flow
  │
  ├─ SendMsg intercepted by groupchat handler
  ├─ ParseMentions → ["THOR", "LOKI"], "Review auth flow"
  ├─ Append user message to Transcript
  ├─ Build context from prior rounds (SummarizeRound)
  ├─ GroupChat.RunRound(ctx, RoundMessage{context + content})
  │    ├─ goroutine: SpawnAgent(THOR, ...) → SpawnResult
  │    └─ goroutine: SpawnAgent(LOKI, ...) → SpawnResult
  │
  ├─ For each result: create Message{AgentID: "THOR", ...}
  │    └─ PubSub → TUI renders with "THOR:" color header
  └─ Append agent responses to Transcript

/invite FENRIR
  └─ Add to participants, assign color, system message

/endchat
  ├─ PersistGroupChat → write hmem for each participant + observer
  │    └─ P entry: summary (L2) + details (L3) + raw transcript (L5)
  └─ groupChatState.Active = false
```

## Dependency Wiring

The TUI needs access to the agent catalog and GroupChat dependencies. Changes to
`app.App`:

```go
type App struct {
    // ... existing fields
    Catalog *agent.Catalog  // loaded once at startup from configs/catalog.json
}
```

`app.New()` loads the catalog during initialization. The `groupChatState`
initialization pulls dependencies from `App`:

```go
gc := agent.NewGroupChat(app.Catalog, agentIDs, task, budget, maxConcurrent)
gc.LSPClients = app.LSPClients
gc.Perms      = app.Permissions
gc.Files      = app.History
gc.Subscriptions = subscriptionsFromConfig()
```

## Re-entry

`/groupchat` can be invoked multiple times in the same session. Each invocation
starts a fresh department/agent selection. The previous group chat state is cleared.
Session messages from prior group chats remain visible with their agent colors
(persisted via `AgentID` in the database).

## Out of Scope (MVP)

- **Coordinator mode** (Heimdall as moderator) — reserved for internally triggered
  group chats (e.g. `/brainstorming`). Different activation path, same GroupChat backend.
- **Agent-to-agent communication** — only user→agent in this mode
- **`/kick AGENT`** — removing participants mid-chat (messages remain visible)
- **Agent streaming** — MVP shows complete responses; streaming per-agent is a follow-up

## Files Changed/Created

| File | Change |
|------|--------|
| `internal/tui/components/chat/editor.go` | Add `/`-prefix handler, @-mention completion switch |
| `internal/tui/components/dialog/groupchat.go` | **New** — grouped agent picker + init logic |
| `internal/tui/components/util/multi-select.go` | **New** — generic multi-select component |
| `internal/tui/page/chat.go` | groupChatState, dispatch interceptor, /endchat |
| `internal/tui/tui.go` | Register /groupchat and /endchat commands |
| `internal/agent/mention.go` | **New** — @-mention parser |
| `internal/message/content.go` | Add AgentID field to Message |
| `internal/db/migrations/` | **New** migration — add agent_id column |
| `internal/tui/components/chat/message.go` | Color-coded agent header rendering |
| `internal/agent/catalog.go` | Add GroupByDepartment() method |
| `internal/agent/groupchat_memory.go` | **New** — PersistGroupChat() hmem writer |
| `internal/app/app.go` | Add Catalog field, load at startup |
| `internal/db/queries/messages.sql` | Add agent_id to INSERT/SELECT queries |
