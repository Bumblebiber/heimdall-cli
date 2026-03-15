# /groupchat Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/groupchat` slash command that lets users start inline multi-agent conversations with @-mention addressing, color-coded responses, and hmem persistence.

**Architecture:** Extends the existing TUI chat page with a groupchat state machine. Reuses the `GroupChat` controller from `internal/agent/group.go` for parallel dispatch. Adds a multi-select dialog, @-mention parser, `/`-prefix command handler, and hmem persistence on `/endchat`.

**Tech Stack:** Go, Bubble Tea (TUI framework), lipgloss (styling), SQLite (message persistence), hmem (agent memory)

**Spec:** `docs/superpowers/specs/2026-03-12-groupchat-design.md`

---

## Chunk 1: Backend — Mention Parser, Catalog Methods, Transcript

### Task 1: @-Mention Parser

**Files:**
- Create: `internal/agent/mention.go`
- Create: `internal/agent/mention_test.go`

- [ ] **Step 1: Write failing tests**

```go
// internal/agent/mention_test.go
package agent

import (
	"testing"
)

func TestParseMentionsSingleAgent(t *testing.T) {
	mentioned, cleaned := ParseMentions("@THOR review this code", []string{"THOR", "LOKI"})
	if len(mentioned) != 1 || mentioned[0] != "THOR" {
		t.Errorf("expected [THOR], got %v", mentioned)
	}
	if cleaned != "review this code" {
		t.Errorf("expected 'review this code', got %q", cleaned)
	}
}

func TestParseMentionsMultipleAgents(t *testing.T) {
	mentioned, cleaned := ParseMentions("@THOR @LOKI review auth", []string{"THOR", "LOKI"})
	if len(mentioned) != 2 {
		t.Errorf("expected 2 mentioned, got %d", len(mentioned))
	}
	if cleaned != "review auth" {
		t.Errorf("expected 'review auth', got %q", cleaned)
	}
}

func TestParseMentionsAll(t *testing.T) {
	mentioned, _ := ParseMentions("@All review this", []string{"THOR", "LOKI"})
	if len(mentioned) != 2 {
		t.Errorf("@All should expand to all participants, got %v", mentioned)
	}
}

func TestParseMentionsAllCaseInsensitive(t *testing.T) {
	mentioned, _ := ParseMentions("@all review this", []string{"THOR", "LOKI"})
	if len(mentioned) != 2 {
		t.Errorf("@all should expand to all participants, got %v", mentioned)
	}
}

func TestParseMentionsNoMention(t *testing.T) {
	mentioned, cleaned := ParseMentions("just a regular message", []string{"THOR"})
	if len(mentioned) != 0 {
		t.Errorf("expected no mentions, got %v", mentioned)
	}
	if cleaned != "just a regular message" {
		t.Errorf("expected unchanged message, got %q", cleaned)
	}
}

func TestParseMentionsUnknownAgent(t *testing.T) {
	mentioned, _ := ParseMentions("@FENRIR review", []string{"THOR", "LOKI"})
	if len(mentioned) != 0 {
		t.Errorf("unknown agent should be ignored, got %v", mentioned)
	}
}

func TestParseMentionsDeduplicate(t *testing.T) {
	mentioned, _ := ParseMentions("@THOR @THOR review", []string{"THOR", "LOKI"})
	if len(mentioned) != 1 {
		t.Errorf("should deduplicate, got %v", mentioned)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/bbbee/opencode/.worktrees/asgard-agent-identity && go test ./internal/agent/ -run TestParseMentions -v -count=1`
Expected: FAIL — `ParseMentions` not defined

- [ ] **Step 3: Write implementation**

```go
// internal/agent/mention.go
package agent

import (
	"regexp"
	"strings"
)

var mentionRe = regexp.MustCompile(`@(\w+)`)

// ParseMentions extracts @AgentID tokens from a message.
// Returns mentioned agent IDs (deduplicated) and the cleaned message text.
// @All (case-insensitive) expands to all participants.
func ParseMentions(text string, participants []string) (mentioned []string, cleaned string) {
	pset := make(map[string]bool, len(participants))
	for _, p := range participants {
		pset[strings.ToUpper(p)] = true
	}

	seen := make(map[string]bool)
	cleaned = mentionRe.ReplaceAllStringFunc(text, func(match string) string {
		name := strings.ToUpper(match[1:]) // strip @
		if strings.EqualFold(name, "ALL") {
			for _, p := range participants {
				if !seen[p] {
					mentioned = append(mentioned, p)
					seen[p] = true
				}
			}
			return ""
		}
		if pset[name] && !seen[name] {
			// Find the original-cased name from participants
			for _, p := range participants {
				if strings.EqualFold(p, name) {
					mentioned = append(mentioned, p)
					seen[p] = true
					break
				}
			}
			return ""
		}
		return match // keep unknown @mentions as-is
	})
	cleaned = strings.TrimSpace(strings.Join(strings.Fields(cleaned), " "))
	return mentioned, cleaned
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/bbbee/opencode/.worktrees/asgard-agent-identity && go test ./internal/agent/ -run TestParseMentions -v -count=1`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
git add internal/agent/mention.go internal/agent/mention_test.go
git commit -m "feat(agent): add @-mention parser for group chat"
```

---

### Task 2: Catalog GroupByDepartment Method

**Files:**
- Modify: `internal/agent/catalog.go`
- Modify: `internal/agent/catalog_test.go`

- [ ] **Step 1: Write failing test**

Add to `internal/agent/catalog_test.go`:

```go
func TestGroupByDepartment(t *testing.T) {
	cat := &Catalog{
		Agents: map[string]AgentSpec{
			"A": {ID: "A", Department: "Backend"},
			"B": {ID: "B", Department: "Backend"},
			"C": {ID: "C", Department: "Security"},
		},
	}
	groups := cat.GroupByDepartment()
	if len(groups) != 2 {
		t.Errorf("expected 2 departments, got %d", len(groups))
	}
	if len(groups["Backend"]) != 2 {
		t.Errorf("expected 2 backend agents, got %d", len(groups["Backend"]))
	}
}

func TestDepartmentNames(t *testing.T) {
	cat := &Catalog{
		Agents: map[string]AgentSpec{
			"A": {ID: "A", Department: "Backend"},
			"B": {ID: "B", Department: "Frontend"},
			"C": {ID: "C", Department: "Backend"},
		},
	}
	names := cat.DepartmentNames()
	if len(names) != 2 {
		t.Errorf("expected 2 departments, got %d", len(names))
	}
	// Should be sorted
	if names[0] != "Backend" || names[1] != "Frontend" {
		t.Errorf("expected sorted, got %v", names)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/bbbee/opencode/.worktrees/asgard-agent-identity && go test ./internal/agent/ -run "TestGroupByDepartment|TestDepartmentNames" -v -count=1`
Expected: FAIL

- [ ] **Step 3: Write implementation**

Add to `internal/agent/catalog.go`:

```go
// GroupByDepartment returns agents grouped by department name.
func (c *Catalog) GroupByDepartment() map[string][]AgentSpec {
	groups := make(map[string][]AgentSpec)
	for _, spec := range c.Agents {
		groups[spec.Department] = append(groups[spec.Department], spec)
	}
	return groups
}

// DepartmentNames returns sorted unique department names.
func (c *Catalog) DepartmentNames() []string {
	seen := make(map[string]bool)
	for _, spec := range c.Agents {
		seen[spec.Department] = true
	}
	names := make([]string, 0, len(seen))
	for name := range seen {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
```

Add `"sort"` to imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/bbbee/opencode/.worktrees/asgard-agent-identity && go test ./internal/agent/ -run "TestGroupByDepartment|TestDepartmentNames" -v -count=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
git add internal/agent/catalog.go internal/agent/catalog_test.go
git commit -m "feat(agent): add GroupByDepartment and DepartmentNames to catalog"
```

---

### Task 3: Transcript Type and GroupChat Context Injection

**Files:**
- Create: `internal/agent/transcript.go`
- Modify: `internal/agent/group.go` (add context prefix to RunRound)

- [ ] **Step 1: Create transcript types**

```go
// internal/agent/transcript.go
package agent

import (
	"fmt"
	"strings"
	"time"
)

// TranscriptEntry records one message in a group chat.
type TranscriptEntry struct {
	AgentID string // empty string for user messages
	Content string
	Time    time.Time
}

// FormatTranscript renders a transcript for hmem persistence.
// Each entry is prefixed with the speaker name.
func FormatTranscript(entries []TranscriptEntry) string {
	var sb strings.Builder
	for _, e := range entries {
		speaker := "User"
		if e.AgentID != "" {
			speaker = e.AgentID
		}
		sb.WriteString(fmt.Sprintf("%s: %s\n", speaker, e.Content))
	}
	return sb.String()
}

// BuildContextPrefix creates a summary of prior rounds for injection
// into the next round's prompt. Uses SummarizeRound for each round.
func BuildContextPrefix(rounds []RoundResult) string {
	if len(rounds) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("## Prior discussion\n\n")
	for i, round := range rounds {
		sb.WriteString(fmt.Sprintf("### Round %d\n", i+1))
		sb.WriteString(SummarizeRound(&round))
		sb.WriteString("\n")
	}
	sb.WriteString("---\n\n")
	return sb.String()
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
git add internal/agent/transcript.go
git commit -m "feat(agent): add transcript types and context builder for group chat"
```

---

### Task 4: GroupChat hmem Persistence

**Files:**
- Create: `internal/agent/groupchat_memory.go`
- Create: `internal/agent/groupchat_memory_test.go`

- [ ] **Step 1: Write failing test**

```go
// internal/agent/groupchat_memory_test.go
package agent

import (
	"testing"
	"time"
)

func TestFormatGroupChatMemory(t *testing.T) {
	transcript := []TranscriptEntry{
		{AgentID: "", Content: "Review the auth flow", Time: time.Now()},
		{AgentID: "THOR", Content: "The JWT rotation looks solid", Time: time.Now()},
		{AgentID: "LOKI", Content: "I see a timing attack vector", Time: time.Now()},
	}
	participants := []string{"THOR", "LOKI"}
	observers := []string{"HEIMDALL"}
	topic := "Review authentication flow"

	entry := FormatGroupChatMemory(topic, participants, observers, transcript)

	if entry.Summary == "" {
		t.Error("expected non-empty summary")
	}
	if entry.Details == "" {
		t.Error("expected non-empty details")
	}
	if entry.RawTranscript == "" {
		t.Error("expected non-empty transcript")
	}
	if !contains(entry.RawTranscript, "THOR:") {
		t.Error("transcript should contain agent name prefix")
	}
	if !contains(entry.RawTranscript, "User:") {
		t.Error("transcript should contain User prefix")
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(s) > 0 && containsStr(s, sub))
}

func containsStr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/bbbee/opencode/.worktrees/asgard-agent-identity && go test ./internal/agent/ -run TestFormatGroupChatMemory -v -count=1`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```go
// internal/agent/groupchat_memory.go
package agent

import (
	"fmt"
	"strings"
)

// GroupChatMemoryEntry holds the formatted content for hmem persistence.
type GroupChatMemoryEntry struct {
	Summary       string // L2: one-line topic + outcome
	Details       string // L3: participants, key points
	RawTranscript string // L5: full chat log with Speaker: prefix
}

// FormatGroupChatMemory builds an hmem entry for a completed group chat.
func FormatGroupChatMemory(topic string, participants, observers []string, transcript []TranscriptEntry) GroupChatMemoryEntry {
	// Summary line
	summary := fmt.Sprintf("Group chat: %s", topic)

	// Details
	var details strings.Builder
	details.WriteString(fmt.Sprintf("Participants: %s", strings.Join(participants, ", ")))
	if len(observers) > 0 {
		details.WriteString(fmt.Sprintf("\nObservers: %s", strings.Join(observers, ", ")))
	}

	// Raw transcript with Speaker: prefix
	raw := FormatTranscript(transcript)

	return GroupChatMemoryEntry{
		Summary:       summary,
		Details:       details.String(),
		RawTranscript: raw,
	}
}

// BuildHmemContent formats the full hmem entry with proper indentation.
// Output is suitable for hmem write_memory with prefix "P".
func BuildHmemContent(entry GroupChatMemoryEntry) string {
	var sb strings.Builder
	sb.WriteString(entry.Summary)
	sb.WriteString("\n\t")
	sb.WriteString(strings.ReplaceAll(entry.Details, "\n", "\n\t"))
	// Raw transcript at deeper indent (L5)
	for _, line := range strings.Split(entry.RawTranscript, "\n") {
		if line != "" {
			sb.WriteString("\n\t\t")
			sb.WriteString(line)
		}
	}
	return sb.String()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/bbbee/opencode/.worktrees/asgard-agent-identity && go test ./internal/agent/ -run TestFormatGroupChatMemory -v -count=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
git add internal/agent/groupchat_memory.go internal/agent/groupchat_memory_test.go
git commit -m "feat(agent): add group chat hmem persistence formatter"
```

---

## Chunk 2: Database — AgentID Column, Message Model

### Task 5: Database Migration — Add agent_id to messages

**Files:**
- Create: `internal/db/migrations/20260312000000_add_agent_id.sql`
- Modify: `internal/db/sql/messages.sql`

- [ ] **Step 1: Create migration file**

```sql
-- internal/db/migrations/20260312000000_add_agent_id.sql
ALTER TABLE messages ADD COLUMN agent_id TEXT;
```

- [ ] **Step 2: Update sqlc queries**

In `internal/db/sql/messages.sql`, update the INSERT query to include `agent_id`:

Change the CreateMessage query from:
```sql
INSERT INTO messages (
    id, session_id, role, parts, model, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
RETURNING *;
```

To:
```sql
INSERT INTO messages (
    id, session_id, role, parts, model, agent_id, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
RETURNING *;
```

The SELECT queries (`SELECT *`) will automatically include the new column.

- [ ] **Step 3: Regenerate sqlc**

Run: `cd /home/bbbee/opencode/.worktrees/asgard-agent-identity && sqlc generate 2>&1 || echo "sqlc not installed — manual update needed"`

If sqlc is not available, manually update the generated files:
- `internal/db/db.go` — add `AgentID` to the `Message` struct
- `internal/db/messages.sql.go` — add `AgentID` param to `CreateMessage` and scan

- [ ] **Step 4: Update Message model**

In `internal/message/content.go`, add `AgentID` field to the `Message` struct:

```go
type Message struct {
	ID        string
	Role      MessageRole
	SessionID string
	Parts     []ContentPart
	Model     models.ModelID
	AgentID   string  // empty for normal assistant, set for group chat agents
	CreatedAt int64
	UpdatedAt int64
}
```

- [ ] **Step 5: Update CreateMessageParams**

In `internal/message/message.go`, add `AgentID` to `CreateMessageParams`:

```go
type CreateMessageParams struct {
	Role    MessageRole
	Parts   []ContentPart
	Model   models.ModelID
	AgentID string
}
```

Update `service.Create()` to pass `AgentID` through to the DB query.

Update `fromDBItem()` to read `AgentID` from the DB result.

- [ ] **Step 6: Commit**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
git add internal/db/migrations/20260312000000_add_agent_id.sql \
    internal/db/sql/messages.sql \
    internal/message/content.go \
    internal/message/message.go
git add internal/db/  # include any sqlc-generated changes
git commit -m "feat(db): add agent_id column to messages for group chat identity"
```

---

## Chunk 3: TUI Components — MultiSelect, Agent Picker Dialog

### Task 6: Generic MultiSelect Component

**Files:**
- Create: `internal/tui/components/util/multi-select.go`

This component extends the `SimpleList[T]` pattern with checkbox toggle behavior.

- [ ] **Step 1: Write the MultiSelect component**

```go
// internal/tui/components/util/multi-select.go
package util

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/opencode-ai/opencode/internal/tui/styles"
	"github.com/opencode-ai/opencode/internal/tui/theme"
)

// MultiSelectItem is an item that can be toggled in a multi-select list.
type MultiSelectItem interface {
	Title() string
	Description() string
	IsPreSelected() bool
}

// Section groups items under a header in the multi-select.
type Section struct {
	Title    string
	StartIdx int // index into the flat items slice
	EndIdx   int // exclusive
}

// MultiSelectConfirmedMsg is sent when the user confirms selection.
type MultiSelectConfirmedMsg[T MultiSelectItem] struct {
	Selected []T
}

// MultiSelectCancelledMsg is sent when the user cancels.
type MultiSelectCancelledMsg struct{}

type multiSelectCmp[T MultiSelectItem] struct {
	items      []T
	sections   []Section
	selected   map[int]bool
	cursor     int
	maxVis     int
	minSelect  int
	width      int
}

type multiSelectKeyMap struct {
	Up      key.Binding
	Down    key.Binding
	Toggle  key.Binding
	Confirm key.Binding
	Cancel  key.Binding
}

var msKeys = multiSelectKeyMap{
	Up:      key.NewBinding(key.WithKeys("up", "k")),
	Down:    key.NewBinding(key.WithKeys("down", "j")),
	Toggle:  key.NewBinding(key.WithKeys(" ")),
	Confirm: key.NewBinding(key.WithKeys("enter")),
	Cancel:  key.NewBinding(key.WithKeys("esc")),
}

// NewMultiSelect creates a new multi-select with sections.
// minSelect is the minimum number of items that must be selected to confirm.
func NewMultiSelect[T MultiSelectItem](items []T, sections []Section, minSelect int) *multiSelectCmp[T] {
	selected := make(map[int]bool)
	for i, item := range items {
		if item.IsPreSelected() {
			selected[i] = true
		}
	}
	// Skip to first non-section-header position
	cursor := 0
	if len(sections) > 0 {
		cursor = sections[0].StartIdx
	}
	return &multiSelectCmp[T]{
		items:     items,
		sections:  sections,
		selected:  selected,
		cursor:    cursor,
		maxVis:    20,
		minSelect: minSelect,
		width:     60,
	}
}

func (m *multiSelectCmp[T]) Init() tea.Cmd { return nil }

func (m *multiSelectCmp[T]) isSectionHeader(idx int) bool {
	for _, s := range m.sections {
		if s.StartIdx == idx {
			return false // startIdx is an item, not header
		}
	}
	return false
}

func (m *multiSelectCmp[T]) selectedCount() int {
	count := 0
	for _, v := range m.selected {
		if v {
			count++
		}
	}
	return count
}

func (m *multiSelectCmp[T]) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, msKeys.Up):
			if m.cursor > 0 {
				m.cursor--
			}
		case key.Matches(msg, msKeys.Down):
			if m.cursor < len(m.items)-1 {
				m.cursor++
			}
		case key.Matches(msg, msKeys.Toggle):
			m.selected[m.cursor] = !m.selected[m.cursor]
		case key.Matches(msg, msKeys.Confirm):
			if m.selectedCount() >= m.minSelect {
				var sel []T
				for i, item := range m.items {
					if m.selected[i] {
						sel = append(sel, item)
					}
				}
				return m, func() tea.Msg {
					return MultiSelectConfirmedMsg[T]{Selected: sel}
				}
			}
		case key.Matches(msg, msKeys.Cancel):
			return m, func() tea.Msg { return MultiSelectCancelledMsg{} }
		}
	}
	return m, nil
}

func (m *multiSelectCmp[T]) View() string {
	t := theme.CurrentTheme()
	base := styles.BaseStyle()
	var sb strings.Builder

	// Find which section each item belongs to
	sectionForIdx := make(map[int]int) // itemIdx -> sectionIdx
	for si, sec := range m.sections {
		for i := sec.StartIdx; i < sec.EndIdx; i++ {
			sectionForIdx[i] = si
		}
	}

	lastSection := -1
	for i, item := range m.items {
		// Render section header if entering new section
		if si, ok := sectionForIdx[i]; ok && si != lastSection {
			lastSection = si
			header := base.Bold(true).Foreground(t.TextMuted()).
				Render(fmt.Sprintf("  ── %s ──", m.sections[si].Title))
			sb.WriteString(header)
			sb.WriteString("\n")
		}

		check := "[ ]"
		if m.selected[i] {
			check = "[x]"
		}

		line := fmt.Sprintf("  %s %s  %s", check, item.Title(), item.Description())

		if i == m.cursor {
			line = base.Bold(true).Foreground(t.Primary()).Render(line)
		} else {
			line = base.Render(line)
		}
		sb.WriteString(line)
		sb.WriteString("\n")
	}

	footer := fmt.Sprintf("\n  Enter: confirm (%d+ selected)  Space: toggle  Esc: cancel", m.minSelect)
	sb.WriteString(base.Foreground(t.TextMuted()).Render(footer))

	return sb.String()
}

func (m *multiSelectCmp[T]) SetWidth(w int) { m.width = w }
```

- [ ] **Step 2: Commit**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
git add internal/tui/components/util/multi-select.go
git commit -m "feat(tui): add generic MultiSelect component with section headers"
```

---

### Task 7: GroupChat Dialog (Agent Picker)

**Files:**
- Create: `internal/tui/components/dialog/groupchat.go`

- [ ] **Step 1: Write the groupchat dialog**

```go
// internal/tui/components/dialog/groupchat.go
package dialog

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/opencode-ai/opencode/internal/llm/agent"
	"github.com/opencode-ai/opencode/internal/tui/components/util"
)

// agentSelectItem wraps an AgentSpec for the multi-select.
type agentSelectItem struct {
	Spec        agent.AgentSpec
	preSelected bool
}

func (a agentSelectItem) Title() string       { return a.Spec.ID }
func (a agentSelectItem) Description() string {
	return fmt.Sprintf("%-10s %s", a.Spec.Tier, a.Spec.Tools)
}
func (a agentSelectItem) IsPreSelected() bool { return a.preSelected }

// GroupChatStartMsg is emitted when agents are selected and confirmed.
type GroupChatStartMsg struct {
	Active    []agent.AgentSpec
	Observers []agent.AgentSpec
}

// BuildAgentPicker creates a multi-select populated from the catalog,
// grouped by department. HEIMDALL is pre-selected as observer.
func BuildAgentPicker(cat *agent.Catalog) *util.MultiSelectCmp[agentSelectItem] {
	departments := cat.DepartmentNames()
	groups := cat.GroupByDepartment()

	var items []agentSelectItem
	var sections []util.Section

	for _, dept := range departments {
		startIdx := len(items)
		for _, spec := range groups[dept] {
			presel := (spec.ID == "HEIMDALL")
			items = append(items, agentSelectItem{Spec: spec, preSelected: presel})
		}
		sections = append(sections, util.Section{
			Title:    dept,
			StartIdx: startIdx,
			EndIdx:   len(items),
		})
	}

	return util.NewMultiSelect(items, sections, 2)
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
git add internal/tui/components/dialog/groupchat.go
git commit -m "feat(tui): add group chat agent picker dialog"
```

---

## Chunk 4: TUI Integration — State, Commands, Rendering

### Task 8: GroupChat State and Slash-Prefix Handler

**Files:**
- Modify: `internal/tui/page/chat.go`

This is the largest task. It adds:
- `groupChatState` struct to `chatPage`
- `/`-prefix handler in the Update function
- `SendMsg` interception for @-mention dispatch
- `GroupChatResultMsg` handler
- `/endchat` and `/invite` handlers

- [ ] **Step 1: Add groupchat state and color palette to chatPage**

In `internal/tui/page/chat.go`, add to the `chatPage` struct:

```go
import (
	// add these imports
	"hash/fnv"
	"github.com/charmbracelet/lipgloss"
	"github.com/opencode-ai/opencode/internal/llm/agent"
)

// After the chatPage struct definition, add:

type groupChatState struct {
	active       bool
	participants []agent.AgentSpec
	observers    []string
	colors       map[string]lipgloss.Color
	groupChat    *agent.GroupChat
	transcript   []agent.TranscriptEntry
}

var agentColors = []lipgloss.Color{
	"#E06C75", "#61AFEF", "#98C379", "#E5C07B",
	"#C678DD", "#56B6C2", "#BE5046", "#D19A66",
	"#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
	"#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
}

func assignColors(participants []agent.AgentSpec) map[string]lipgloss.Color {
	colors := make(map[string]lipgloss.Color)
	for i, p := range participants {
		colors[p.ID] = agentColors[i%len(agentColors)]
	}
	return colors
}

// Msg types for group chat flow
type GroupChatResultMsg struct {
	Result *agent.RoundResult
	Err    error
}
```

Add `groupChat groupChatState` field to the `chatPage` struct.

- [ ] **Step 2: Add `/`-prefix detection in Update**

In the `tea.KeyMsg` handler in `chatPage.Update()`, after the existing key matches
(around line 103-121), add slash-prefix detection. When the editor content is
exactly `/` + chars, show a command completion popup filtered by the prefix.

This reuses the existing command dialog infrastructure — the slash just triggers
the same command dialog that Ctrl+K opens, pre-filtered by the typed text.

- [ ] **Step 3: Add groupchat command registration**

In `NewChatPage()` or in the command setup, register three new commands:

```go
Command{ID: "groupchat", Title: "Group Chat", Description: "Start multi-agent group chat",
	Handler: func(cmd Command) tea.Cmd { /* show agent picker */ }},
Command{ID: "endchat", Title: "End Group Chat", Description: "End the current group chat",
	Handler: func(cmd Command) tea.Cmd { /* cleanup + hmem persist */ }},
Command{ID: "invite", Title: "Invite Agent", Description: "Add an agent to the group chat",
	Handler: func(cmd Command) tea.Cmd { /* show single-select picker */ }},
```

- [ ] **Step 4: Add SendMsg interception for group chat**

In the `chat.SendMsg` handler (around line 69), add groupchat interception:

```go
case chat.SendMsg:
	if p.groupChat.active {
		cmd := p.handleGroupChatMessage(msg.Text)
		if cmd != nil {
			return p, cmd
		}
	} else {
		cmd := p.sendMessage(msg.Text, msg.Attachments)
		if cmd != nil {
			return p, cmd
		}
	}
```

```go
func (p *chatPage) handleGroupChatMessage(text string) tea.Cmd {
	participantIDs := make([]string, len(p.groupChat.participants))
	for i, p := range p.groupChat.participants {
		participantIDs[i] = p.ID
	}

	mentioned, cleaned := agent.ParseMentions(text, participantIDs)
	if len(mentioned) == 0 {
		// No @-mention: warn user or forward to default agent
		return p.sendMessage(text, nil)
	}

	// Record user message in transcript
	p.groupChat.transcript = append(p.groupChat.transcript, agent.TranscriptEntry{
		Content: text,
		Time:    time.Now(),
	})

	// Build context from prior rounds
	context := agent.BuildContextPrefix(p.groupChat.groupChat.Rounds)
	roundMsg := agent.RoundMessage{
		Targets: mentioned,
		Content: context + cleaned,
	}

	return func() tea.Msg {
		result, err := p.groupChat.groupChat.RunRound(
			context.Background(), roundMsg)
		return GroupChatResultMsg{Result: result, Err: err}
	}
}
```

- [ ] **Step 5: Add GroupChatResultMsg handler**

```go
case GroupChatResultMsg:
	if msg.Err != nil {
		return p, util.ReportError("Group chat error", msg.Err)
	}
	var cmds []tea.Cmd
	for agentID, res := range msg.Result.Responses {
		// Record in transcript
		content := res.Content
		if res.Error != nil {
			content = fmt.Sprintf("ERROR: %v", res.Error)
		}
		p.groupChat.transcript = append(p.groupChat.transcript, agent.TranscriptEntry{
			AgentID: agentID,
			Content: content,
			Time:    time.Now(),
		})

		// Create message with AgentID for rendering
		_, err := p.app.Messages.Create(ctx, p.session.ID, message.CreateMessageParams{
			Role:    message.Assistant,
			Parts:   []message.ContentPart{message.TextContent{Text: content}},
			AgentID: agentID,
		})
		if err != nil {
			cmds = append(cmds, util.ReportError("Failed to save agent response", err))
		}
	}
	return p, tea.Batch(cmds...)
```

- [ ] **Step 6: Commit**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
git add internal/tui/page/chat.go
git commit -m "feat(tui): add groupchat state, slash-prefix, dispatch, and result handler"
```

---

### Task 9: Combined @-Completion Provider (Agents + Files)

**Files:**
- Create: `internal/tui/completions/combined.go`
- Modify: `internal/tui/page/chat.go` (swap provider on groupchat start/end)

`@` currently triggers file completion. In groupchat mode, `@` shows a **combined
list**: agents first, then a separator, then files. No new keybinding needed.

- [ ] **Step 1: Create combined completion provider**

```go
// internal/tui/completions/combined.go
package completions

import (
	"strings"

	"github.com/opencode-ai/opencode/internal/llm/agent"
	"github.com/opencode-ai/opencode/internal/tui/components/dialog"
)

// separatorItem renders a non-selectable divider in the completion list.
type separatorItem struct {
	title string
}

func (s *separatorItem) Render(selected bool, width int) string {
	return "  " + s.title
}
func (s *separatorItem) DisplayValue() string { return s.title }
func (s *separatorItem) GetValue() string     { return "" } // not selectable

// CombinedCompletionProvider shows agents first, then files.
type CombinedCompletionProvider struct {
	Participants []agent.AgentSpec
	FileProvider dialog.CompletionProvider
}

func (p *CombinedCompletionProvider) GetId() string { return "combined" }

func (p *CombinedCompletionProvider) GetEntry() dialog.CompletionItemI {
	return dialog.NewCompletionItem(dialog.CompletionItem{Title: "@", Value: "@"})
}

func (p *CombinedCompletionProvider) GetChildEntries(query string) ([]dialog.CompletionItemI, error) {
	var items []dialog.CompletionItemI

	// Agent entries: @All + participants
	q := strings.ToLower(query)
	if q == "" || strings.HasPrefix("all", q) {
		items = append(items, dialog.NewCompletionItem(dialog.CompletionItem{
			Title: "@All", Value: "@All ",
		}))
	}
	for _, spec := range p.Participants {
		if q == "" || strings.HasPrefix(strings.ToLower(spec.ID), q) {
			items = append(items, dialog.NewCompletionItem(dialog.CompletionItem{
				Title: "@" + spec.ID, Value: "@" + spec.ID + " ",
			}))
		}
	}

	// Separator
	items = append(items, &separatorItem{title: "── Files ──"})

	// File entries (existing behavior)
	fileItems, err := p.FileProvider.GetChildEntries(query)
	if err == nil {
		items = append(items, fileItems...)
	}

	return items, nil
}
```

- [ ] **Step 2: Swap provider on groupchat start/end**

In `internal/tui/page/chat.go`:

```go
// On groupchat start:
fileProvider := completions.NewFileAndFolderContextGroup()
combined := &completions.CombinedCompletionProvider{
	Participants: p.groupChat.participants,
	FileProvider: fileProvider,
}
p.completionDialog = dialog.NewCompletionDialogCmp(combined)

// On /endchat:
p.completionDialog = dialog.NewCompletionDialogCmp(completions.NewFileAndFolderContextGroup())
```

- [ ] **Step 3: Commit**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
git add internal/tui/completions/combined.go internal/tui/page/chat.go
git commit -m "feat(tui): combined @-completion showing agents + files in groupchat mode"
```

---

### Task 10: Color-Coded Agent Message Rendering

**Files:**
- Modify: `internal/tui/components/chat/message.go`

- [ ] **Step 1: Add agent header rendering**

In `renderAssistantMessage()` (around line 117), add agent identity header:

```go
// At the start of renderAssistantMessage, before existing model name logic:
if msg.AgentID != "" {
	// Color lookup — use hash-based fallback if color map not available
	h := fnv.New32a()
	h.Write([]byte(msg.AgentID))
	color := agentColors[h.Sum32()%uint32(len(agentColors))]

	header := baseStyle.
		Foreground(lipgloss.Color(color)).
		Bold(true).
		Render(fmt.Sprintf("%s:", msg.AgentID))
	info = append(info, header)
}
```

Note: The `agentColors` slice must be accessible from this package. Either move it
to a shared `styles` package or duplicate the palette here. The hash-based fallback
is used because the rendering layer doesn't have access to the chat page's color
map, but produces consistent colors for the same agent name.

- [ ] **Step 2: Commit**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
git add internal/tui/components/chat/message.go
git commit -m "feat(tui): render group chat messages with color-coded agent name header"
```

---

### Task 11: Catalog in App and Dependency Wiring

**Files:**
- Modify: `internal/app/app.go`

- [ ] **Step 1: Add Catalog field to App**

In `internal/app/app.go`, add `Catalog *agent.Catalog` to the `App` struct.

In `app.New()`, load the catalog:

```go
cat, err := agent.LoadCatalog("configs/catalog.json")
if err != nil {
	logging.Warn("Agent catalog not found, group chat disabled", "error", err)
}
// ... later in the App struct initialization:
app.Catalog = cat
```

- [ ] **Step 2: Commit**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
git add internal/app/app.go
git commit -m "feat(app): load agent catalog at startup for group chat support"
```

---

## Chunk 5: Integration and End-to-End

### Task 12: /endchat hmem Persistence Wiring

**Files:**
- Modify: `internal/tui/page/chat.go`

- [ ] **Step 1: Wire hmem write into /endchat handler**

```go
func (p *chatPage) endGroupChat() tea.Cmd {
	if !p.groupChat.active {
		return nil
	}

	// Build participant and observer ID lists
	participantIDs := make([]string, len(p.groupChat.participants))
	for i, p := range p.groupChat.participants {
		participantIDs[i] = p.ID
	}

	// Format and persist to hmem for each agent
	entry := agent.FormatGroupChatMemory(
		"group chat session", // TODO: extract topic from first user message
		participantIDs,
		p.groupChat.observers,
		p.groupChat.transcript,
	)
	hmemContent := agent.BuildHmemContent(entry)

	// Write to each participant's hmem
	allAgents := append(participantIDs, p.groupChat.observers...)
	for _, agentID := range allAgents {
		memPath := agent.AgentMemoryPath(agentID)
		store, err := hmem.Open(memPath)
		if err != nil {
			logging.Warn("Failed to open hmem for agent", "agent", agentID, "error", err)
			continue
		}
		store.Write("P", hmemContent, hmem.WriteOptions{})
		store.Close()
	}

	// Reset state
	p.groupChat = groupChatState{}

	// Restore file completion
	fileProvider := completions.NewFileAndFolderContextGroup()
	p.completionDialog = dialog.NewCompletionDialogCmp(fileProvider)

	return util.CmdHandler(chat.SystemMessageMsg{
		Content: fmt.Sprintf("Group chat ended. Memory saved for %d agents.", len(allAgents)),
	})
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
git add internal/tui/page/chat.go
git commit -m "feat(tui): wire hmem persistence into /endchat handler"
```

---

### Task 13: /invite Command

**Files:**
- Modify: `internal/tui/page/chat.go`

- [ ] **Step 1: Add invite handler**

```go
func (p *chatPage) inviteAgent(agentID string) tea.Cmd {
	if !p.groupChat.active {
		return util.ReportWarn("No active group chat")
	}
	if p.app.Catalog == nil {
		return util.ReportWarn("No agent catalog loaded")
	}

	spec, ok := p.app.Catalog.Get(agentID)
	if !ok {
		return util.ReportWarn(fmt.Sprintf("Agent %q not found in catalog", agentID))
	}

	// Check if already a participant
	for _, p := range p.groupChat.participants {
		if p.ID == spec.ID {
			return util.ReportWarn(fmt.Sprintf("%s is already in the group chat", agentID))
		}
	}

	// Add participant
	p.groupChat.participants = append(p.groupChat.participants, spec)
	p.groupChat.colors[spec.ID] = agentColors[len(p.groupChat.participants)-1%len(agentColors)]
	p.groupChat.groupChat.Agents = append(p.groupChat.groupChat.Agents, spec.ID)

	// Update completion provider
	agentProvider := &agentCompletionProvider{participants: p.groupChat.participants}
	p.completionDialog = dialog.NewCompletionDialogCmp(agentProvider)

	return util.CmdHandler(chat.SystemMessageMsg{
		Content: fmt.Sprintf("%s joined the group chat", spec.ID),
	})
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
git add internal/tui/page/chat.go
git commit -m "feat(tui): add /invite command for mid-chat participant addition"
```

---

### Task 14: End-to-End Smoke Test

**Files:**
- Create: `internal/agent/groupchat_test.go`

- [ ] **Step 1: Write integration test**

```go
// internal/agent/groupchat_test.go
package agent

import (
	"testing"
	"time"
)

func TestGroupChatEndToEnd(t *testing.T) {
	// 1. Parse mentions
	mentioned, cleaned := ParseMentions("@THOR @LOKI review auth", []string{"THOR", "LOKI", "HEIMDALL"})
	if len(mentioned) != 2 {
		t.Fatalf("expected 2 mentioned, got %d", len(mentioned))
	}
	if cleaned != "review auth" {
		t.Fatalf("expected 'review auth', got %q", cleaned)
	}

	// 2. Build transcript
	transcript := []TranscriptEntry{
		{Content: "@THOR @LOKI review auth", Time: time.Now()},
		{AgentID: "THOR", Content: "Auth looks solid", Time: time.Now()},
		{AgentID: "LOKI", Content: "Found timing attack", Time: time.Now()},
	}

	// 3. Format for hmem
	entry := FormatGroupChatMemory("Review auth flow", []string{"THOR", "LOKI"}, []string{"HEIMDALL"}, transcript)
	if entry.Summary == "" {
		t.Error("empty summary")
	}

	hmemContent := BuildHmemContent(entry)
	if hmemContent == "" {
		t.Error("empty hmem content")
	}

	// 4. Verify transcript has speaker names
	formatted := FormatTranscript(transcript)
	if !containsStr(formatted, "THOR:") {
		t.Error("missing THOR: prefix")
	}
	if !containsStr(formatted, "User:") {
		t.Error("missing User: prefix")
	}

	// 5. Verify context builder
	round := RoundResult{
		Responses: map[string]SpawnResult{
			"THOR": {AgentID: "THOR", Content: "Auth looks solid"},
			"LOKI": {AgentID: "LOKI", Content: "Found timing attack"},
		},
		Duration: time.Second,
	}
	context := BuildContextPrefix([]RoundResult{round})
	if context == "" {
		t.Error("empty context prefix")
	}
}
```

- [ ] **Step 2: Run test**

Run: `cd /home/bbbee/opencode/.worktrees/asgard-agent-identity && go test ./internal/agent/ -run TestGroupChatEndToEnd -v -count=1`
Expected: PASS

- [ ] **Step 3: Commit and push**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
git add internal/agent/groupchat_test.go
git commit -m "test(agent): add group chat end-to-end smoke test"
git push fork feature/asgard-agent-identity
```
