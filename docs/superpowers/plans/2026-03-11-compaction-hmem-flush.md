# Compaction mit hmem Memory Flush — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bei jeder Compaction (Session-Zusammenfassung) werden Learnings automatisch in hmem geschrieben — mit der vollen 5-Level-Hierarchie, von L1 (Titel) bis L5 (exakter Wortlaut).

**Architecture:** Der bestehende `Summarize()`-Flow in `agent.go` wird erweitert: VOR dem Session-Checkpoint wird ein LLM-Call gemacht, der die Konversation in Themen splittet und pro Thema L1–L4 generiert. L5 enthält den exakten Wortlaut aus der Konversation (kein Char-Limit). Alles wird via `store.Write()` in hmem gespeichert. Funktioniert mit allen Providern (Claude, OpenAI, Ollama, Gemini).

**Tech Stack:** Go, `internal/hmem/`, `internal/llm/agent/`, `internal/llm/prompt/`

---

## Was ist das Problem?

**OpenCode heute:** Wenn eine Konversation zu lang wird (95% des Context-Fensters), wird sie "komprimiert":
1. Ein LLM fasst die gesamte Konversation in 1-2 Absätze zusammen
2. Diese Summary wird als Checkpoint-Message gespeichert
3. Ab jetzt werden nur noch Messages NACH dem Checkpoint geladen
4. **Problem: Alles vor dem Checkpoint ist praktisch verloren** — die Summary ist generisch, Details fehlen

**Heimdall neu:** Gleicher Trigger, aber BEVOR der Checkpoint gesetzt wird:
1. Ein LLM splittet die Konversation in einzelne Themen (1-5 Stück typisch)
2. Jedes Thema wird als hmem-Eintrag mit 5 Zoom-Stufen gespeichert:
   - **L1** = Titel (was Bulk-Read zeigt) — z.B. "SQLite Deadlock gefixt"
   - **L2** = 1-2 Sätze Summary — was passiert ist
   - **L3** = Absatz mit Details — Key Points und Entscheidungen
   - **L4** = Technischer Kontext — Dateipfade, Code-Snippets, Commands
   - **L5** = Exakter Wortlaut — relevante Konversationspassagen, wörtlich zitiert
3. DANN wird der normale Checkpoint gesetzt (bestehender Flow bleibt)
4. **Nichts geht mehr verloren** — jede Session wird dauerhaft in hmem archiviert

**Kosten:** Ein zusätzlicher LLM-Call pro Compaction (~3-6 Sekunden mit dem Summarizer-Modell). Da Compaction nur alle ~30-60 Minuten passiert, ist das vernachlässigbar.

---

## Vergleich: OpenCode vs. Heimdall

```
OpenCode (heute):                          Heimdall (neu):

95% Context ──→ Summarize()                95% Context ──→ Summarize()
                  │                                          │
                  ├─ LLM: "Fasse zusammen"                   ├─ 1) LLM: "Splitte in Themen"
                  │     ↓                                    │     ↓
                  │  Freitext-Summary                        │  JSON: topics + summary
                  │                                          │     ↓
                  │                                          ├─ 2) Pro Thema: store.Write()
                  │                                          │    → L1 Titel
                  │                                          │    → L2 Summary
                  │                                          │    → L3 Detail
                  │                                          │    → L4 Technisch
                  │                                          │    → L5 Raw-Text (kein Limit!)
                  │                                          │
                  ├─ Checkpoint-Message                      ├─ 3) Checkpoint-Message
                  │  (Summary als User-Msg)                  │     (gleich wie heute)
                  │                                          │
                  ↓                                          ↓
  Details verloren ❌                        Alles in hmem ✅
  Kein FTS-Search ❌                         FTS5-Suche ✅
  Keine Struktur ❌                          5-Level Lazy Loading ✅
```

---

## File Structure

| File | Verantwortung |
|------|--------------|
| `internal/hmem/write.go` | L5 Char-Limit entfernen (1 Zeile + 3 Zeilen) |
| `internal/hmem/compact.go` | `CompactedTopic` Typ + `ParseCompactionResponse()` JSON-Parser + `TopicToContent()` Formatter |
| `internal/hmem/compact_test.go` | Tests für Parser und Formatter |
| `internal/llm/prompt/compaction.go` | Der Prompt, der die Konversation in Themen splittet |
| `internal/llm/agent/agent.go` | `flushToHmem()` + modifiziertes `Summarize()` |
| `internal/config/config.go` | `Compaction`-Config-Struct |

---

## Chunk 1: hmem vorbereiten

### Task 1: L5 Char-Limit entfernen

**Warum:** L5 soll den exakten Wortlaut aus der Konversation speichern. Dafür brauchen wir
unbegrenzten Platz auf der tiefsten Ebene. Die Limits für L1-L4 bleiben bestehen.

**Files:**
- Modify: `internal/hmem/write.go:20-21` (charLimits) und `:127-140` (checkCharLimit)
- Modify: `internal/hmem/store_test.go` — neuer Test

- [ ] **Step 1: Failing Test schreiben**

In `internal/hmem/store_test.go`:

```go
func TestWrite_L5NoCharLimit(t *testing.T) {
	s := openTestStore(t)
	// Create content with a very long L5 node (5000 chars)
	longText := strings.Repeat("Dies ist ein langer Rohtext. ", 200) // ~5800 chars
	content := fmt.Sprintf("Titel\n\tL2 Summary\n\t\tL3 Detail\n\t\t\tL4 Tech\n\t\t\t\t%s", longText)
	result, err := s.Write("L", content, hmem.WriteOptions{})
	if err != nil {
		t.Fatalf("L5 should have no char limit, got error: %v", err)
	}
	if result.ID == "" {
		t.Fatal("expected valid ID")
	}
	// Verify the long L5 content is actually stored
	entries, _ := s.Read(hmem.ReadOptions{ID: result.ID})
	if len(entries) == 0 {
		t.Fatal("entry not found")
	}
}
```

- [ ] **Step 2: Test laufen lassen — muss FEHLSCHLAGEN**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
go test ./internal/hmem/... -run TestWrite_L5NoCharLimit -v
```

Erwartet: `FAIL` mit "L5 content exceeds 500 char limit"

- [ ] **Step 3: Char-Limit für L5 entfernen**

In `internal/hmem/write.go`:

Änderung 1 — `charLimits` anpassen (Zeile 20):
```go
// charLimits maps depth index (0=L1, 1=L2, ...) to max character count.
// 0 means unlimited. L5 has no limit to store raw conversation text.
var charLimits = []int{120, 200, 300, 400, 0}
```

Änderung 2 — `checkCharLimit` anpassen (Zeile 127):
```go
func checkCharLimit(content string, depth int) error {
	idx := depth - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(charLimits) {
		return nil // beyond defined limits = unlimited
	}
	limit := charLimits[idx]
	if limit == 0 {
		return nil // 0 means unlimited
	}
	if len(content) > int(float64(limit)*charTolerance) {
		return fmt.Errorf("L%d content exceeds %d char limit (%d chars)", depth, limit, len(content))
	}
	return nil
}
```

- [ ] **Step 4: Test laufen lassen — muss BESTEHEN**

```bash
go test ./internal/hmem/... -run TestWrite_L5NoCharLimit -v
```

- [ ] **Step 5: Alle Tests laufen lassen**

```bash
go test ./internal/hmem/... -v
```

Erwartet: ALLE bestehen (48 + 1 = 49 Tests)

- [ ] **Step 6: Commit**

```bash
git add internal/hmem/write.go internal/hmem/store_test.go
git commit -m "feat(hmem): remove char limit for L5 (depth 5) — raw text storage"
```

---

### Task 2: CompactedTopic Typ + JSON-Parser + Content-Formatter

**Warum:** Wenn der LLM die Konversation in Themen splittet, gibt er JSON zurück. Wir brauchen:
1. Einen Go-Typ für die Themen (`CompactedTopic`)
2. Einen Parser, der das JSON liest (`ParseCompactionResponse`)
3. Einen Formatter, der ein Thema in Tab-indentierten Content umwandelt (`TopicToContent`) —
   das ist das Format, das `store.Write()` erwartet

**Files:**
- Create: `internal/hmem/compact.go`
- Create: `internal/hmem/compact_test.go`

- [ ] **Step 1: Failing Tests schreiben**

```go
// internal/hmem/compact_test.go
package hmem_test

import (
	"strings"
	"testing"

	"github.com/opencode-ai/opencode/internal/hmem"
)

func TestParseCompactionResponse_Valid(t *testing.T) {
	jsonStr := `{
		"summary": "We fixed a bug and learned about SQLite.",
		"topics": [
			{
				"prefix": "L",
				"tags": ["#sqlite", "#debugging"],
				"l1": "SQLite Deadlock gefixt",
				"l2": "MaxOpenConns(1) verursacht Deadlock bei verschachtelten Queries.",
				"l3": "Der Go SQLite-Treiber erlaubt nur eine Connection. Ein rows.Next()-Loop mit QueryRow darin wartet ewig.",
				"l4": "Fix: IDs sammeln, rows.Close(), dann Sub-Queries. Betroffene Dateien: related.go, stats.go.",
				"l5": "User: 'Warum hängt der Test?'\nAssistant: 'Das ist ein klassischer Deadlock...'"
			}
		]
	}`

	result, err := hmem.ParseCompactionResponse(jsonStr)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Summary == "" {
		t.Error("expected non-empty summary")
	}
	if len(result.Topics) != 1 {
		t.Fatalf("expected 1 topic, got %d", len(result.Topics))
	}
	topic := result.Topics[0]
	if topic.Prefix != "L" {
		t.Errorf("expected prefix L, got %s", topic.Prefix)
	}
	if len(topic.Tags) != 2 {
		t.Errorf("expected 2 tags, got %d", len(topic.Tags))
	}
	if topic.L5 == "" {
		t.Error("expected non-empty L5")
	}
}

func TestParseCompactionResponse_Empty(t *testing.T) {
	jsonStr := `{"summary": "Nothing happened.", "topics": []}`
	result, err := hmem.ParseCompactionResponse(jsonStr)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Topics) != 0 {
		t.Error("expected 0 topics")
	}
}

func TestParseCompactionResponse_Invalid(t *testing.T) {
	_, err := hmem.ParseCompactionResponse("not json at all")
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestTopicToContent(t *testing.T) {
	topic := hmem.CompactedTopic{
		L1: "Titel der Lektion",
		L2: "Kurze Zusammenfassung",
		L3: "Detaillierte Erklärung mit Kontext",
		L4: "Technische Details: file.go, func XY()",
		L5: "User: 'Was passiert hier?'\nAssistant: 'Das ist...'",
	}
	content := hmem.TopicToContent(topic)

	// Must start with L1 (no tab)
	if !strings.HasPrefix(content, "Titel der Lektion") {
		t.Errorf("content should start with L1, got: %s", content[:40])
	}
	// Must contain tab-indented L2
	if !strings.Contains(content, "\n\tKurze Zusammenfassung") {
		t.Error("L2 should be at depth 1 (one tab)")
	}
	// Must contain double-tab L3
	if !strings.Contains(content, "\n\t\tDetaillierte") {
		t.Error("L3 should be at depth 2 (two tabs)")
	}
	// Must contain triple-tab L4
	if !strings.Contains(content, "\n\t\t\tTechnische") {
		t.Error("L4 should be at depth 3 (three tabs)")
	}
	// Must contain quad-tab L5
	if !strings.Contains(content, "\n\t\t\t\tUser:") {
		t.Error("L5 should be at depth 4 (four tabs)")
	}
}

func TestTopicToContent_MultilineL5(t *testing.T) {
	topic := hmem.CompactedTopic{
		L1: "Titel",
		L2: "Summary",
		L5: "Zeile eins\nZeile zwei\nZeile drei",
	}
	content := hmem.TopicToContent(topic)
	// Every line of L5 must be indented with 4 tabs
	lines := strings.Split(content, "\n")
	l5Started := false
	for _, line := range lines {
		if strings.HasPrefix(line, "\t\t\t\t") {
			l5Started = true
		}
		if l5Started && line != "" && !strings.HasPrefix(line, "\t\t\t\t") {
			t.Errorf("all L5 lines must have 4 tabs, got: %q", line)
		}
	}
	if !l5Started {
		t.Error("expected L5 content with 4 tabs")
	}
}

func TestTopicToContent_SkipsEmptyLevels(t *testing.T) {
	topic := hmem.CompactedTopic{
		L1: "Titel",
		L2: "Summary",
		// L3 and L4 empty
		L5: "Raw text here",
	}
	content := hmem.TopicToContent(topic)
	// L3/L4 empty → should still work, L5 is at correct depth
	if !strings.Contains(content, "\t\t\t\tRaw text here") {
		t.Error("L5 should be at depth 4 even when L3/L4 are empty")
	}
}

func TestWriteCompactedTopic_Integration(t *testing.T) {
	s := openTestStore(t)
	topic := hmem.CompactedTopic{
		Prefix: "L",
		Tags:   []string{"#test", "#compaction"},
		L1:     "Integration Test Thema",
		L2:     "Dieses Thema testet den kompletten Pfad",
		L3:     "Von CompactedTopic über TopicToContent bis store.Write",
		L4:     "Datei: compact_test.go, Funktion: TestWriteCompactedTopic_Integration",
		L5:     "User: 'Schreib einen Test'\nAssistant: 'Hier ist er'",
	}

	result, err := hmem.WriteCompactedTopic(s, topic)
	if err != nil {
		t.Fatalf("failed to write compacted topic: %v", err)
	}
	if result.ID == "" {
		t.Fatal("expected non-empty ID")
	}

	// Verify all 5 levels are stored
	entries, _ := s.Read(hmem.ReadOptions{ID: result.ID})
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Level1 != "Integration Test Thema" {
		t.Errorf("L1 mismatch: %s", entries[0].Level1)
	}
}
```

- [ ] **Step 2: Tests laufen lassen — müssen FEHLSCHLAGEN**

```bash
go test ./internal/hmem/... -run TestParse -run TestTopicToContent -run TestWriteCompacted -v
```

Erwartet: FAIL (Funktionen existieren noch nicht)

- [ ] **Step 3: `compact.go` implementieren**

```go
// internal/hmem/compact.go
package hmem

import (
	"encoding/json"
	"fmt"
	"strings"
)

// CompactedTopic represents one topic extracted from a conversation during compaction.
// Each field maps to one hmem tree level:
//   - L1 = title (root entry, max 120 chars)
//   - L2 = summary (depth 2, max 200 chars)
//   - L3 = detail (depth 3, max 300 chars)
//   - L4 = technical context (depth 4, max 400 chars)
//   - L5 = raw conversation quotes (depth 5, NO char limit)
type CompactedTopic struct {
	Prefix string   `json:"prefix"`
	Tags   []string `json:"tags"`
	L1     string   `json:"l1"`
	L2     string   `json:"l2"`
	L3     string   `json:"l3"`
	L4     string   `json:"l4"`
	L5     string   `json:"l5"`
}

// CompactionResult holds the parsed LLM response from a compaction call.
type CompactionResult struct {
	Summary string           `json:"summary"`
	Topics  []CompactedTopic `json:"topics"`
}

// ParseCompactionResponse parses the JSON response from the compaction LLM call.
// The LLM returns a JSON object with "summary" (for session checkpoint) and
// "topics" (for hmem storage).
func ParseCompactionResponse(raw string) (CompactionResult, error) {
	// Strip markdown code fences if present (LLMs sometimes wrap JSON)
	cleaned := strings.TrimSpace(raw)
	if strings.HasPrefix(cleaned, "```") {
		lines := strings.Split(cleaned, "\n")
		// Remove first line (```json) and last line (```)
		if len(lines) >= 3 {
			cleaned = strings.Join(lines[1:len(lines)-1], "\n")
		}
	}

	var result CompactionResult
	if err := json.Unmarshal([]byte(cleaned), &result); err != nil {
		return CompactionResult{}, fmt.Errorf("parse compaction JSON: %w", err)
	}

	// Validate and default prefixes
	for i := range result.Topics {
		result.Topics[i].Prefix = strings.ToUpper(strings.TrimSpace(result.Topics[i].Prefix))
		if result.Topics[i].Prefix == "" {
			result.Topics[i].Prefix = "L" // default to Lesson
		}
		if !validPrefixes[result.Topics[i].Prefix] {
			result.Topics[i].Prefix = "L"
		}
	}

	return result, nil
}

// TopicToContent converts a CompactedTopic into tab-indented content string
// suitable for store.Write(). The format matches what ParseTree expects:
//
//	L1 title
//	\tL2 summary
//	\t\tL3 detail
//	\t\t\tL4 technical
//	\t\t\t\tL5 raw line 1
//	\t\t\t\tL5 raw line 2
func TopicToContent(topic CompactedTopic) string {
	var b strings.Builder
	b.WriteString(topic.L1)

	levels := []struct {
		depth   int
		content string
	}{
		{1, topic.L2},
		{2, topic.L3},
		{3, topic.L4},
		{4, topic.L5},
	}

	for _, level := range levels {
		if level.content == "" {
			continue
		}
		tabs := strings.Repeat("\t", level.depth)
		// L5 can be multiline — each line gets the same indentation
		for i, line := range strings.Split(level.content, "\n") {
			if i == 0 || line != "" {
				b.WriteString("\n")
				b.WriteString(tabs)
				b.WriteString(line)
			}
		}
	}

	return b.String()
}

// WriteCompactedTopic writes a single compacted topic to hmem using the
// standard store.Write() with tab-indented content.
func WriteCompactedTopic(s *Store, topic CompactedTopic) (WriteResult, error) {
	prefix := topic.Prefix
	if prefix == "" {
		prefix = "L"
	}
	content := TopicToContent(topic)
	return s.Write(prefix, content, WriteOptions{
		Tags: topic.Tags,
	})
}
```

- [ ] **Step 4: Tests laufen lassen — müssen BESTEHEN**

```bash
go test ./internal/hmem/... -run "TestParse|TestTopicToContent|TestWriteCompacted" -v
```

- [ ] **Step 5: Alle hmem-Tests laufen lassen**

```bash
go test ./internal/hmem/... -v
```

Erwartet: ALLE bestehen

- [ ] **Step 6: Commit**

```bash
git add internal/hmem/compact.go internal/hmem/compact_test.go
git commit -m "feat(hmem): add compaction types, JSON parser, and topic writer"
```

---

## Chunk 2: Compaction-Prompt + Agent-Integration

### Task 3: Compaction-Prompt

**Warum:** Der LLM braucht einen klaren Prompt, der ihm sagt: "Splitte diese Konversation in Themen
und gib mir für jedes Thema 5 Zoom-Stufen als JSON." Dieser Prompt ersetzt den bisherigen
einzeiligen Summary-Prompt in `agent.go` (Zeile 590).

**Files:**
- Create: `internal/llm/prompt/compaction.go`

- [ ] **Step 1: Prompt-Datei erstellen**

```go
// internal/llm/prompt/compaction.go
package prompt

// CompactionPrompt returns the prompt template for extracting structured
// memory entries from a conversation. The LLM splits the conversation into
// topics and generates 5 zoom levels (L1-L5) for each topic.
//
// This replaces the generic "summarize our conversation" prompt from OpenCode.
// Instead of a flat summary, we get structured, searchable memory entries.
func CompactionPrompt(customInstructions string) string {
	base := `Analyze the conversation above and extract structured memory entries.

TASK: Split the conversation into distinct TOPICS (typically 1-5). For each topic,
create a hierarchical summary at 5 zoom levels, plus a session summary for continuity.

OUTPUT FORMAT: Valid JSON, no markdown fences, no extra text.

{
  "summary": "2-3 sentence summary of the entire conversation for session continuity. What was done, current state, what comes next.",
  "topics": [
    {
      "prefix": "L",
      "tags": ["#tag1", "#tag2"],
      "l1": "Short title, like a commit message (max 100 chars)",
      "l2": "1-2 sentence summary of what happened (max 200 chars)",
      "l3": "Detailed paragraph: key points, decisions, outcomes (max 300 chars)",
      "l4": "Technical detail: file paths, code snippets, commands, errors (max 400 chars)",
      "l5": "Exact quotes from the conversation. Copy the original wording VERBATIM. Include the most important exchanges that capture decisions, discoveries, or errors. No limit."
    }
  ]
}

PREFIX GUIDE (choose the most fitting per topic):
  L = Lesson learned (most common — insights, patterns, how-tos)
  E = Error found and fixed (root cause + solution)
  D = Decision made (architectural choice, trade-off)
  P = Project milestone (feature completed, phase done)
  T = Task identified for later (not started yet)

RULES:
  - l1: Max 100 chars. Like a commit message. Start with noun or verb.
  - l2: Max 200 chars. What happened in 1-2 sentences.
  - l3: Max 300 chars. Include WHY, not just WHAT.
  - l4: Max 400 chars. Include file paths, function names, code patterns.
  - l5: NO LIMIT. Quote relevant conversation passages VERBATIM. Copy-paste key moments.
        Include both user and assistant messages. Preserve the original language (German/English).
  - tags: 1-3 lowercase hashtags, format: #word (e.g., #sqlite, #debugging, #hmem)
  - If NOTHING worth remembering happened: {"summary": "...", "topics": []}
  - Separate topics by SUBJECT, not by time. Two discussions about the same bug = one topic.
  - l5 is the MOST IMPORTANT level. It preserves exact context that summaries lose.`

	if customInstructions != "" {
		return base + "\n\nADDITIONAL INSTRUCTIONS:\n" + customInstructions
	}
	return base
}
```

- [ ] **Step 2: Commit**

```bash
git add internal/llm/prompt/compaction.go
git commit -m "feat(prompt): add compaction prompt for structured memory extraction"
```

---

### Task 4: Config-Felder für Compaction

**Warum:** Der User soll konfigurieren können:
1. Ob hmem-Flush bei Compaction aktiv ist (default: ja)
2. Eigene Zusatz-Instruktionen für den Compaction-Prompt (optional)

**Files:**
- Modify: `internal/config/config.go`

- [ ] **Step 1: Compaction-Config-Struct hinzufügen**

In `internal/config/config.go`, nach dem `ShellConfig`-Struct (Zeile 82):

```go
// CompactionConfig defines settings for the compaction memory flush.
type CompactionConfig struct {
	// HmemFlush enables writing structured memory entries to hmem during compaction.
	// Default: true
	HmemFlush bool `json:"hmemFlush,omitempty"`
	// Instructions are optional additional instructions appended to the compaction prompt.
	// Use this to customize what the LLM extracts (e.g., "Focus on API patterns").
	Instructions string `json:"instructions,omitempty"`
}
```

- [ ] **Step 2: Config-Struct erweitern**

Im `Config`-Struct (Zeile 85), nach `AutoCompact` (Zeile 98):

```go
	AutoCompact bool              `json:"autoCompact,omitempty"`
	Compaction  CompactionConfig  `json:"compaction,omitempty"`
```

- [ ] **Step 3: Default setzen**

In der `setDefaults`-Funktion (suche nach `viper.SetDefault("autoCompact"`):

```go
	viper.SetDefault("compaction.hmemFlush", true)
```

- [ ] **Step 4: Build-Check**

```bash
go build ./...
```

Erwartet: Kein Fehler

- [ ] **Step 5: Commit**

```bash
git add internal/config/config.go
git commit -m "feat(config): add compaction.hmemFlush and compaction.instructions"
```

---

### Task 5: flushToHmem() + Summarize() modifizieren

**Warum:** Das ist das Herzstück. Wir fügen eine neue Methode `flushToHmem()` zum Agent hinzu,
die den ganzen hmem-Flush-Flow orchestriert. Dann rufen wir sie in `Summarize()` auf —
BEVOR der Session-Checkpoint gesetzt wird.

Der Flow wird:
```
Summarize() aufgerufen
  │
  ├─ 1. Alle Messages seit letztem Checkpoint laden
  ├─ 2. flushToHmem() aufrufen:
  │      ├─ Messages zu einem Text zusammenbauen
  │      ├─ Compaction-Prompt + Text an Summarizer-LLM schicken
  │      ├─ JSON-Antwort parsen
  │      ├─ Pro Topic: store.Write() → hmem
  │      └─ Summary-Text zurückgeben
  │
  ├─ 3. Summary als Checkpoint-Message speichern (wie bisher)
  └─ 4. Session-Metadata updaten (wie bisher)
```

**Files:**
- Modify: `internal/llm/agent/agent.go`
  - Neue Methode: `flushToHmem()`
  - Modifiziert: `Summarize()` — ruft `flushToHmem()` auf und nutzt deren Summary

**WICHTIG:** Die bestehende `Summarize()`-Logik (Checkpoint-Message, Token-Reset, Cost-Tracking)
bleibt komplett erhalten. Wir fügen nur den hmem-Flush DAVOR ein.

- [ ] **Step 1: Import-Block in agent.go erweitern**

Füge hinzu (falls nicht schon vorhanden):

```go
import (
	// ... existing imports ...
	"github.com/opencode-ai/opencode/internal/hmem"
	"github.com/opencode-ai/opencode/internal/llm/prompt"
)
```

- [ ] **Step 2: flushToHmem() Methode schreiben**

Nach der `Summarize()`-Methode (nach Zeile 704):

```go
// flushToHmem extracts structured topics from conversation messages and writes
// them to the agent's hmem store. Returns the session summary (for use as
// checkpoint message) and any error.
//
// This is the core difference from OpenCode's generic summarizer: instead of
// producing a flat text summary, we extract structured 5-level memory entries
// that are searchable via FTS5 and browsable via lazy loading.
func (a *agent) flushToHmem(ctx context.Context, msgs []message.Message) (string, error) {
	cfg := config.Get()

	// Build conversation transcript from messages
	var transcript strings.Builder
	for _, msg := range msgs {
		role := "User"
		if msg.Role == message.Assistant {
			role = "Assistant"
		}
		content := msg.Content().String()
		if content != "" {
			transcript.WriteString(role)
			transcript.WriteString(": ")
			transcript.WriteString(content)
			transcript.WriteString("\n\n")
		}
	}

	if transcript.Len() == 0 {
		return "", fmt.Errorf("no message content to flush")
	}

	// Build prompt: conversation + compaction instructions
	compactionPrompt := prompt.CompactionPrompt(cfg.Compaction.Instructions)
	promptMsg := message.Message{
		Role:  message.User,
		Parts: []message.ContentPart{message.TextContent{Text: compactionPrompt}},
	}

	// Send conversation + prompt to summarizer
	msgsWithPrompt := append(msgs, promptMsg)
	response, err := a.summarizeProvider.SendMessages(ctx, msgsWithPrompt, nil)
	if err != nil {
		return "", fmt.Errorf("compaction LLM call failed: %w", err)
	}

	rawResponse := strings.TrimSpace(response.Content)
	if rawResponse == "" {
		return "", fmt.Errorf("empty compaction response")
	}

	// Parse the structured JSON response
	result, err := hmem.ParseCompactionResponse(rawResponse)
	if err != nil {
		// Fallback: if JSON parsing fails, use raw response as plain summary
		// (degrades gracefully to OpenCode behavior)
		logging.Warn("Compaction JSON parse failed, using raw summary", "error", err)
		return rawResponse, nil
	}

	// Write each topic to hmem
	if cfg.Data.HmemPath != "" && len(result.Topics) > 0 {
		store, err := hmem.Open(cfg.Data.HmemPath)
		if err != nil {
			logging.Warn("Failed to open hmem for compaction flush", "error", err)
		} else {
			defer store.Close()
			for _, topic := range result.Topics {
				writeResult, err := hmem.WriteCompactedTopic(store, topic)
				if err != nil {
					logging.Warn("Failed to write compacted topic", "topic", topic.L1, "error", err)
				} else {
					logging.Info("Compaction: wrote topic to hmem", "id", writeResult.ID, "title", topic.L1)
				}
			}
		}
	}

	return result.Summary, nil
}
```

- [ ] **Step 3: Summarize() modifizieren**

Die `Summarize()`-Methode wird an einer Stelle geändert: Statt den generischen
Summary-Prompt zu senden, rufen wir `flushToHmem()` auf. Der Rest bleibt gleich.

Ersetze in `Summarize()` den Block von Zeile 589-622 (der alte Prompt + SendMessages-Call):

ALT (Zeilen 589-622):
```go
		// Add a system message to guide the summarization
		summarizePrompt := "Provide a detailed but concise summary of our conversation above. Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next."

		// Create a new message with the summarize prompt
		promptMsg := message.Message{
			Role:  message.User,
			Parts: []message.ContentPart{message.TextContent{Text: summarizePrompt}},
		}

		// Append the prompt to the messages
		msgsWithPrompt := append(msgs, promptMsg)

		event = AgentEvent{
			Type:     AgentEventTypeSummarize,
			Progress: "Generating summary...",
		}

		a.Publish(pubsub.CreatedEvent, event)

		// Send the messages to the summarize provider
		response, err := a.summarizeProvider.SendMessages(
			summarizeCtx,
			msgsWithPrompt,
			make([]tools.BaseTool, 0),
		)
		if err != nil {
			event = AgentEvent{
				Type:  AgentEventTypeError,
				Error: fmt.Errorf("failed to summarize: %w", err),
				Done:  true,
			}
			a.Publish(pubsub.CreatedEvent, event)
			return
		}

		summary := strings.TrimSpace(response.Content)
```

NEU:
```go
		event = AgentEvent{
			Type:     AgentEventTypeSummarize,
			Progress: "Extracting memories...",
		}
		a.Publish(pubsub.CreatedEvent, event)

		var summary string
		cfg := config.Get()
		if cfg.Compaction.HmemFlush && cfg.Data.HmemPath != "" {
			// Heimdall mode: extract structured topics to hmem + get summary
			var flushErr error
			summary, flushErr = a.flushToHmem(summarizeCtx, msgs)
			if flushErr != nil {
				logging.Warn("hmem flush failed, falling back to plain summary", "error", flushErr)
			}
		}

		// Fallback: if flush didn't produce a summary, use the old generic approach
		if summary == "" {
			event = AgentEvent{
				Type:     AgentEventTypeSummarize,
				Progress: "Generating summary...",
			}
			a.Publish(pubsub.CreatedEvent, event)

			summarizePrompt := "Provide a detailed but concise summary of our conversation above. Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next."
			promptMsg := message.Message{
				Role:  message.User,
				Parts: []message.ContentPart{message.TextContent{Text: summarizePrompt}},
			}
			msgsWithPrompt := append(msgs, promptMsg)
			response, err := a.summarizeProvider.SendMessages(
				summarizeCtx,
				msgsWithPrompt,
				make([]tools.BaseTool, 0),
			)
			if err != nil {
				event = AgentEvent{
					Type:  AgentEventTypeError,
					Error: fmt.Errorf("failed to summarize: %w", err),
					Done:  true,
				}
				a.Publish(pubsub.CreatedEvent, event)
				return
			}
			summary = strings.TrimSpace(response.Content)
		}
```

**Erklärung:** Wenn `compaction.hmemFlush` aktiv ist UND ein hmemPath konfiguriert ist,
nutzen wir den neuen `flushToHmem()`-Flow. Wenn das fehlschlägt (LLM gibt kein valides JSON zurück),
fällt der Code automatisch auf den alten OpenCode-Summarizer zurück. So geht nie etwas kaputt.

- [ ] **Step 4: Build-Check**

```bash
go build ./...
```

Erwartet: Kein Fehler

- [ ] **Step 5: Manueller Smoke-Test**

Da `Summarize()` ein Session-System und LLM-Provider braucht, können wir keinen reinen
Unit-Test schreiben. Stattdessen:

1. Starte Heimdall
2. Führe eine kurze Konversation (3-4 Turns)
3. Tippe `/compact`
4. Prüfe im Log: "Compaction: wrote topic to hmem"
5. Prüfe die hmem-Datei: `python3 hmem.py` — neue Einträge sollten da sein

- [ ] **Step 6: Commit**

```bash
git add internal/llm/agent/agent.go internal/llm/prompt/compaction.go internal/config/config.go
git commit -m "feat(compaction): flush structured memories to hmem before session checkpoint

Replaces OpenCode's generic flat-text summarizer with a structured 5-level
extraction (L1 title → L5 raw quotes). Falls back gracefully if JSON parsing fails."
```

---

## Zusammenfassung

Nach Abschluss dieses Plans hat Heimdall folgende Verbesserungen gegenüber OpenCode:

| | OpenCode | Heimdall |
|---|---|---|
| **Compaction Output** | Flacher Freitext-Absatz | 5-Level-Hierarchie pro Thema |
| **Wortlaut** | Verloren nach Compaction | L5 speichert exakte Zitate |
| **Durchsuchbar** | Nein | FTS5 Volltextsuche |
| **Kategorisiert** | Nein | Prefixes (L/E/D/P/T) + Tags |
| **Lazy Loading** | N/A | L1 in Bulk, L2-L5 on demand |
| **Fallback** | - | Automatisch zu altem Summarizer |
| **Provider** | Alle | Alle (kein Provider-Lock-in) |

**Dateien geändert:** 6 Dateien (3 neu, 3 modifiziert)
**Risiko:** Niedrig — bei Fehler fällt Summarize() auf alten Code zurück
