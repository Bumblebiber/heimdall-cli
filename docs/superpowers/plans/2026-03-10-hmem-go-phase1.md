# Heimdall hmem Go — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `internal/hmem/` — a native Go port of hmem-mcp Phase 1 (Write, Read, Append, Update, FTS search) with identical SQLite schema for `.hmem` file compatibility, then wire it into Heimdall's system prompt and session-end memory write.

**Architecture:** Pure Go SQLite via `github.com/ncruces/go-sqlite3` (already in go.mod). Schema is byte-for-byte identical to hmem-mcp so `.hmem` files are interchangeable between Heimdall agents and Claude Code. `internal/hmem/` is a self-contained package with no dependencies on other Heimdall internals. App-level wiring in `internal/app/app.go` replaces the old MEMORY.md flow.

**Tech Stack:** Go 1.21+, `github.com/ncruces/go-sqlite3`, FTS5 (built into ncruces driver), tab-indented content parsing.

**Working directory for all commands:** `/home/bbbee/opencode/.worktrees/asgard-agent-identity/`

---

## Chunk 1: Foundation — Types, Schema, Store Open

### Task 1: Types

**Files:**
- Create: `internal/hmem/types.go`

- [ ] **Step 1: Write `internal/hmem/types.go`**

```go
package hmem

// AgentRole defines the clearance level for memory access.
type AgentRole string

const (
	RoleWorker AgentRole = "worker"
	RoleAL     AgentRole = "al"
	RolePL     AgentRole = "pl"
	RoleCEO    AgentRole = "ceo"
)

var roleLevel = map[AgentRole]int{
	RoleWorker: 0,
	RoleAL:     1,
	RolePL:     2,
	RoleCEO:    3,
}

// AllowedRoles returns all roles with clearance <= the given role.
func AllowedRoles(role AgentRole) []AgentRole {
	level, ok := roleLevel[role]
	if !ok {
		level = 0
	}
	var result []AgentRole
	for r, l := range roleLevel {
		if l <= level {
			result = append(result, r)
		}
	}
	return result
}

// MemoryEntry is a root-level memory record (lives in `memories` table).
type MemoryEntry struct {
	ID          string      `db:"id"`
	Prefix      string      `db:"prefix"`
	Seq         int         `db:"seq"`
	CreatedAt   string      `db:"created_at"`
	UpdatedAt   string      `db:"updated_at"`
	Title       string      `db:"title"`
	Level1      string      `db:"level_1"`
	Links       []string    // parsed from JSON
	MinRole     AgentRole   `db:"min_role"`
	Obsolete    bool        `db:"obsolete"`
	Favorite    bool        `db:"favorite"`
	Irrelevant  bool        `db:"irrelevant"`
	Pinned      bool        `db:"pinned"`
	AccessCount int         `db:"access_count"`
	LastAccessed *string    `db:"last_accessed"`
	Tags        []string    // populated from memory_tags
	Children    []MemoryNode // populated on read
}

// MemoryNode is a sub-level node (lives in `memory_nodes` table).
type MemoryNode struct {
	ID          string   `db:"id"`
	ParentID    string   `db:"parent_id"`
	RootID      string   `db:"root_id"`
	Depth       int      `db:"depth"`
	Seq         int      `db:"seq"`
	Title       string   `db:"title"`
	Content     string   `db:"content"`
	CreatedAt   string   `db:"created_at"`
	AccessCount int      `db:"access_count"`
	Favorite    bool     `db:"favorite"`
	Irrelevant  bool     `db:"irrelevant"`
	Tags        []string
	Children    []MemoryNode
}

// WriteOptions controls how a new entry is created.
type WriteOptions struct {
	Links    []string
	MinRole  AgentRole
	Favorite bool
	Pinned   bool
	Tags     []string
}

// WriteResult is returned from Write().
type WriteResult struct {
	ID        string
	Timestamp string
}

// AppendResult is returned from Append().
type AppendResult struct {
	Count int
	IDs   []string
}

// ReadOptions controls how entries are queried.
type ReadOptions struct {
	ID        string    // read single entry by ID (root or node)
	Prefix    string    // filter by prefix letter
	Search    string    // FTS5 full-text search
	AgentRole AgentRole // role-based access filter
	Limit     int       // 0 = unlimited
	After     string    // ISO date filter
	Before    string    // ISO date filter
}

// UpdateFields contains the fields that can be changed on an existing entry.
type UpdateFields struct {
	Content    *string
	Links      []string
	MinRole    *AgentRole
	Obsolete   *bool
	Favorite   *bool
	Irrelevant *bool
	Pinned     *bool
}
```

- [ ] **Step 2: Verify it compiles (no test yet)**

```bash
cd /home/bbbee/opencode/.worktrees/asgard-agent-identity
go build ./internal/hmem/...
```

Expected: no errors (empty package is fine with just types)

- [ ] **Step 3: Commit**

```bash
git add internal/hmem/types.go
git commit -m "feat(hmem): add Go types for hmem Phase 1"
```

---

### Task 2: Schema + Migrations

**Files:**
- Create: `internal/hmem/schema.go`
- Create: `internal/hmem/schema_test.go`

- [ ] **Step 1: Write the failing test**

```go
// internal/hmem/schema_test.go
package hmem_test

import (
	"strings"
	"testing"
)

func TestSchemaContainsTables(t *testing.T) {
	for _, tbl := range []string{"memories", "memory_nodes", "schema_version", "hmem_fts", "memory_tags"} {
		if !strings.Contains(Schema, tbl) {
			t.Errorf("Schema missing table: %s", tbl)
		}
	}
}

func TestMigrationsNonEmpty(t *testing.T) {
	if len(Migrations) == 0 {
		t.Fatal("Migrations must not be empty")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
go test ./internal/hmem/... 2>&1
```

Expected: `undefined: Schema`

- [ ] **Step 3: Write `internal/hmem/schema.go`**

```go
package hmem

// Schema is the SQLite DDL for a .hmem database.
// Must stay byte-for-byte identical to hmem-mcp for file compatibility.
const Schema = `
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
    pinned        INTEGER DEFAULT 0,
    updated_at2   TEXT
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

// Migrations are ALTER TABLE statements applied to existing databases.
// Each is wrapped in its own error-ignored exec (idempotent).
var Migrations = []string{
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
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
go test ./internal/hmem/... -run TestSchema -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/hmem/schema.go internal/hmem/schema_test.go
git commit -m "feat(hmem): add schema DDL and migrations"
```

---

### Task 3: Store — Open/Close/Migrate

**Files:**
- Create: `internal/hmem/store.go`
- Create: `internal/hmem/store_test.go`

- [ ] **Step 1: Write failing test**

```go
// internal/hmem/store_test.go
package hmem_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/opencode-ai/opencode/internal/hmem"
)

func TestOpen_CreatesFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.hmem")

	store, err := hmem.Open(path)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer store.Close()

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected .hmem file to exist: %v", err)
	}
}

func TestOpen_Idempotent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.hmem")

	s1, err := hmem.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	s1.Close()

	s2, err := hmem.Open(path)
	if err != nil {
		t.Fatalf("second Open failed: %v", err)
	}
	s2.Close()
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
go test ./internal/hmem/... -run TestOpen -v
```

Expected: `undefined: hmem.Open`

- [ ] **Step 3: Write `internal/hmem/store.go`**

```go
package hmem

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/ncruces/go-sqlite3/driver"
	_ "github.com/ncruces/go-sqlite3/embed"
)

// Store wraps a .hmem SQLite database.
type Store struct {
	db   *sql.DB
	path string
}

// Open opens (or creates) a .hmem database at the given path.
func Open(hmemPath string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(hmemPath), 0o700); err != nil {
		return nil, fmt.Errorf("hmem: mkdir: %w", err)
	}
	db, err := sql.Open("sqlite3", hmemPath)
	if err != nil {
		return nil, fmt.Errorf("hmem: open: %w", err)
	}
	db.SetMaxOpenConns(1) // SQLite is single-writer
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		db.Close()
		return nil, fmt.Errorf("hmem: WAL pragma: %w", err)
	}
	s := &Store{db: db, path: hmemPath}
	if err := s.initSchema(); err != nil {
		db.Close()
		return nil, fmt.Errorf("hmem: init schema: %w", err)
	}
	return s, nil
}

// Close closes the underlying database connection.
func (s *Store) Close() error {
	return s.db.Close()
}

// initSchema creates tables and runs migrations.
func (s *Store) initSchema() error {
	if _, err := s.db.Exec(Schema); err != nil {
		return fmt.Errorf("schema: %w", err)
	}
	for _, m := range Migrations {
		// Migrations are idempotent; ignore "duplicate column" errors.
		s.db.Exec(m) //nolint:errcheck
	}
	return nil
}
```

- [ ] **Step 4: Run tests**

```bash
go test ./internal/hmem/... -run TestOpen -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/hmem/store.go internal/hmem/store_test.go
git commit -m "feat(hmem): add Store Open/Close with schema init"
```

---

## Chunk 2: Write

### Task 4: Content Parser

**Files:**
- Create: `internal/hmem/parse.go`
- Create: `internal/hmem/parse_test.go`

- [ ] **Step 1: Write failing tests**

```go
// internal/hmem/parse_test.go
package hmem_test

import (
	"testing"

	"github.com/opencode-ai/opencode/internal/hmem"
)

func TestParseTree_SingleLine(t *testing.T) {
	result := hmem.ParseTree("Just a simple entry", "P0001")
	if result.Level1 != "Just a simple entry" {
		t.Errorf("unexpected level1: %q", result.Level1)
	}
	if len(result.Nodes) != 0 {
		t.Errorf("expected no nodes, got %d", len(result.Nodes))
	}
}

func TestParseTree_WithChildren(t *testing.T) {
	content := "Root entry\n\tChild one\n\tChild two\n\t\tGrandchild"
	result := hmem.ParseTree(content, "L0001")

	if result.Level1 != "Root entry" {
		t.Errorf("unexpected level1: %q", result.Level1)
	}
	if len(result.Nodes) != 3 {
		t.Errorf("expected 3 nodes, got %d", len(result.Nodes))
	}
	// Check IDs
	if result.Nodes[0].ID != "L0001.1" {
		t.Errorf("unexpected first node ID: %q", result.Nodes[0].ID)
	}
	if result.Nodes[2].ID != "L0001.1.1" {
		t.Errorf("unexpected grandchild ID: %q", result.Nodes[2].ID)
	}
}

func TestParseTree_TitleExtraction(t *testing.T) {
	content := "Explicit Title\n\tThe actual content starts here"
	result := hmem.ParseTree(content, "D0001")
	// Two L1 lines → first is title, rest is level1
	if result.Title != "Explicit Title" {
		t.Errorf("unexpected title: %q", result.Title)
	}
}

func TestParseRelativeTree(t *testing.T) {
	nodes := hmem.ParseRelativeTree("Child one\n\tGrandchild", "P0001.2", 2, 3)
	if len(nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(nodes))
	}
	if nodes[0].ID != "P0001.2.3" {
		t.Errorf("unexpected ID: %q", nodes[0].ID)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
go test ./internal/hmem/... -run TestParseTree -v
```

Expected: `undefined: hmem.ParseTree`

- [ ] **Step 3: Write `internal/hmem/parse.go`**

```go
package hmem

import (
	"strings"
)

// ParseTreeResult holds the output of ParseTree.
type ParseTreeResult struct {
	Title  string
	Level1 string
	Nodes  []ParsedNode
}

// ParsedNode is an intermediate node before DB insertion.
type ParsedNode struct {
	ID       string
	ParentID string
	Depth    int
	Seq      int
	Content  string
	Title    string
}

// ParseTree parses tab-indented content into a root entry + child nodes.
// rootID is used to generate compound node IDs (e.g. "P0001.1.2").
func ParseTree(content, rootID string) ParseTreeResult {
	seqAtParent := map[string]int{}
	lastIDAtDepth := map[int]string{}
	var nodes []ParsedNode
	var l1Lines []string

	rawLines := splitLines(content)

	// Auto-detect space indentation unit if no tabs present
	spaceUnit := detectSpaceUnit(rawLines)

	for _, line := range rawLines {
		depth := lineDepth(line, spaceUnit)
		text := strings.TrimSpace(line)
		if text == "" {
			continue
		}
		if depth == 1 {
			l1Lines = append(l1Lines, text)
			continue
		}
		// L2+: determine parent
		var parentID string
		if depth == 2 {
			parentID = rootID
		} else {
			if id, ok := lastIDAtDepth[depth-1]; ok {
				parentID = id
			} else {
				parentID = rootID
			}
		}
		seq := seqAtParent[parentID] + 1
		seqAtParent[parentID] = seq
		nodeID := parentID + "." + itoa(seq)
		lastIDAtDepth[depth] = nodeID
		nodes = append(nodes, ParsedNode{
			ID:       nodeID,
			ParentID: parentID,
			Depth:    depth,
			Seq:      seq,
			Content:  text,
			Title:    autoExtractTitle(text),
		})
	}

	var title, level1 string
	if len(l1Lines) >= 2 {
		title = l1Lines[0]
		level1 = strings.Join(l1Lines[1:], " | ")
	} else if len(l1Lines) == 1 {
		level1 = l1Lines[0]
		title = autoExtractTitle(level1)
	}

	return ParseTreeResult{Title: title, Level1: level1, Nodes: nodes}
}

// ParseRelativeTree parses content relative to a parent node.
// startSeq is the first sibling sequence number to assign.
func ParseRelativeTree(content, parentID string, parentDepth, startSeq int) []ParsedNode {
	seqAtParent := map[string]int{parentID: startSeq - 1}
	lastIDAtRelDepth := map[int]string{}
	var nodes []ParsedNode

	rawLines := splitLines(content)
	spaceUnit := detectSpaceUnit(rawLines)

	for _, line := range rawLines {
		relDepth := lineDepth(line, spaceUnit) - 1 // 0 = direct child
		if relDepth < 0 {
			continue
		}
		absDepth := parentDepth + 1 + relDepth
		if absDepth > 5 {
			absDepth = 5
		}
		text := strings.TrimSpace(line)
		if text == "" {
			continue
		}
		var pid string
		if relDepth == 0 {
			pid = parentID
		} else {
			if id, ok := lastIDAtRelDepth[relDepth-1]; ok {
				pid = id
			} else {
				pid = parentID
			}
		}
		seq := seqAtParent[pid] + 1
		seqAtParent[pid] = seq
		nodeID := pid + "." + itoa(seq)
		lastIDAtRelDepth[relDepth] = nodeID
		nodes = append(nodes, ParsedNode{
			ID:       nodeID,
			ParentID: pid,
			Depth:    absDepth,
			Seq:      seq,
			Content:  text,
		})
	}
	return nodes
}

// --- helpers ---

func splitLines(content string) []string {
	var result []string
	for _, l := range strings.Split(content, "\n") {
		l = strings.TrimRight(l, "\r")
		if l != "" {
			result = append(result, l)
		}
	}
	return result
}

func detectSpaceUnit(lines []string) int {
	for _, l := range lines {
		if strings.HasPrefix(l, "\t") {
			return 0 // tabs present — use tab detection
		}
	}
	for _, l := range lines {
		leading := len(l) - len(strings.TrimLeft(l, " "))
		if leading > 0 {
			return leading
		}
	}
	return 4
}

func lineDepth(line string, spaceUnit int) int {
	tabs := 0
	for _, c := range line {
		if c == '\t' {
			tabs++
		} else {
			break
		}
	}
	if tabs > 0 {
		d := tabs + 1
		if d > 5 {
			d = 5
		}
		return d
	}
	if spaceUnit <= 0 {
		return 1
	}
	leading := len(line) - len(strings.TrimLeft(line, " "))
	d := leading/spaceUnit + 1
	if d > 5 {
		d = 5
	}
	return d
}

func autoExtractTitle(text string) string {
	// First sentence or first 40 chars
	for _, sep := range []string{". ", ": ", " — ", " - "} {
		if i := strings.Index(text, sep); i > 0 && i < 60 {
			return text[:i]
		}
	}
	if len(text) <= 40 {
		return text
	}
	return text[:40] + "…"
}

func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}
```

Add `"fmt"` to imports.

- [ ] **Step 4: Run tests**

```bash
go test ./internal/hmem/... -run TestParseTree -run TestParseRelativeTree -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/hmem/parse.go internal/hmem/parse_test.go
git commit -m "feat(hmem): add tab-indented content parser"
```

---

### Task 5: Write()

**Files:**
- Create: `internal/hmem/write.go`
- Modify: `internal/hmem/store_test.go` (add write tests)

- [ ] **Step 1: Add failing write tests to `store_test.go`**

```go
func TestWrite_BasicEntry(t *testing.T) {
	s := openTestStore(t)
	result, err := s.Write("L", "Lesson title\n\tDetail line", WriteOptions{})
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}
	if result.ID != "L0001" {
		t.Errorf("expected L0001, got %s", result.ID)
	}
}

func TestWrite_InvalidPrefix(t *testing.T) {
	s := openTestStore(t)
	_, err := s.Write("X", "content", WriteOptions{})
	if err == nil {
		t.Fatal("expected error for invalid prefix")
	}
}

func TestWrite_SequenceIncrements(t *testing.T) {
	s := openTestStore(t)
	r1, _ := s.Write("L", "first", WriteOptions{})
	r2, _ := s.Write("L", "second", WriteOptions{})
	if r1.ID != "L0001" || r2.ID != "L0002" {
		t.Errorf("unexpected IDs: %s, %s", r1.ID, r2.ID)
	}
}

// helper
func openTestStore(t *testing.T) *hmem.Store {
	t.Helper()
	s, err := hmem.Open(filepath.Join(t.TempDir(), "test.hmem"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
```

- [ ] **Step 2: Run to verify failure**

```bash
go test ./internal/hmem/... -run TestWrite -v
```

Expected: `s.Write undefined`

- [ ] **Step 3: Write `internal/hmem/write.go`**

```go
package hmem

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// validPrefixes are the allowed memory prefix letters.
var validPrefixes = map[string]bool{
	"P": true, "L": true, "T": true, "E": true,
	"D": true, "M": true, "S": true, "N": true,
	"H": true, "R": true, "F": true,
}

// charLimits maps depth (1-based) to max chars. Matches hmem-mcp defaults.
var charLimits = []int{120, 200, 300, 400, 500}

// charTolerance allows content up to 125% of the limit before rejecting.
const charTolerance = 1.25

// Write creates a new root memory entry with optional child nodes.
func (s *Store) Write(prefix, content string, opts WriteOptions) (WriteResult, error) {
	prefix = strings.ToUpper(prefix)
	if !validPrefixes[prefix] {
		return WriteResult{}, fmt.Errorf("invalid prefix %q", prefix)
	}

	seq, err := s.nextSeq(prefix)
	if err != nil {
		return WriteResult{}, err
	}
	rootID := fmt.Sprintf("%s%04d", prefix, seq)
	now := time.Now().UTC().Format(time.RFC3339)

	parsed := ParseTree(content, rootID)
	if parsed.Level1 == "" {
		return WriteResult{}, fmt.Errorf("content must have at least one non-empty line")
	}

	// Validate char limits
	if err := checkLimit(parsed.Level1, 1); err != nil {
		return WriteResult{}, err
	}
	for _, n := range parsed.Nodes {
		if err := checkLimit(n.Content, n.Depth); err != nil {
			return WriteResult{}, err
		}
	}

	// Encode links
	var linksJSON *string
	if len(opts.Links) > 0 {
		b, _ := json.Marshal(opts.Links)
		s := string(b)
		linksJSON = &s
	}
	minRole := opts.MinRole
	if minRole == "" {
		minRole = RoleWorker
	}

	tx, err := s.db.Begin()
	if err != nil {
		return WriteResult{}, err
	}
	defer tx.Rollback() //nolint:errcheck

	_, err = tx.Exec(`
		INSERT INTO memories (id, prefix, seq, created_at, updated_at, title, level_1, links, min_role, favorite, pinned)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		rootID, prefix, seq, now, now,
		parsed.Title, parsed.Level1,
		linksJSON,
		string(minRole),
		boolToInt(opts.Favorite),
		boolToInt(opts.Pinned),
	)
	if err != nil {
		return WriteResult{}, fmt.Errorf("insert root: %w", err)
	}

	for _, n := range parsed.Nodes {
		_, err = tx.Exec(`
			INSERT INTO memory_nodes (id, parent_id, root_id, depth, seq, title, content, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			n.ID, n.ParentID, rootID, n.Depth, n.Seq, n.Title, n.Content, now, now,
		)
		if err != nil {
			return WriteResult{}, fmt.Errorf("insert node %s: %w", n.ID, err)
		}
	}

	// Tags: go on first child node if children exist, else on root
	if len(opts.Tags) > 0 {
		tagTarget := rootID
		if len(parsed.Nodes) > 0 {
			tagTarget = parsed.Nodes[0].ID
		}
		if err := insertTagsTx(tx, tagTarget, opts.Tags); err != nil {
			return WriteResult{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return WriteResult{}, err
	}
	return WriteResult{ID: rootID, Timestamp: now}, nil
}

// nextSeq returns the next sequence number for a given prefix.
func (s *Store) nextSeq(prefix string) (int, error) {
	var max int
	row := s.db.QueryRow(`SELECT COALESCE(MAX(seq), 0) FROM memories WHERE prefix = ?`, prefix)
	if err := row.Scan(&max); err != nil {
		return 0, err
	}
	return max + 1, nil
}

func checkLimit(content string, depth int) error {
	idx := depth - 1
	if idx >= len(charLimits) {
		idx = len(charLimits) - 1
	}
	limit := charLimits[idx]
	if len(content) > int(float64(limit)*charTolerance) {
		return fmt.Errorf("L%d content exceeds %d char limit (%d chars)", depth, limit, len(content))
	}
	return nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func insertTagsTx(tx interface{ Exec(string, ...any) (any, error) }, entryID string, tags []string) error {
	for _, tag := range tags {
		tag = strings.ToLower(strings.TrimSpace(tag))
		if !strings.HasPrefix(tag, "#") || len(tag) < 2 {
			continue
		}
		if _, err := tx.Exec(`INSERT OR IGNORE INTO memory_tags (entry_id, tag) VALUES (?, ?)`, entryID, tag); err != nil {
			return err
		}
	}
	return nil
}
```

Note: `insertTagsTx` uses a small interface — adjust if Go complains; use `*sql.Tx` directly.

- [ ] **Step 4: Run tests**

```bash
go test ./internal/hmem/... -run TestWrite -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/hmem/write.go internal/hmem/store_test.go
git commit -m "feat(hmem): add Write() with content parsing + tag support"
```

---

## Chunk 3: Read

### Task 6: Read()

**Files:**
- Create: `internal/hmem/read.go`
- Modify: `internal/hmem/store_test.go`

- [ ] **Step 1: Add failing read tests**

```go
func TestRead_ByID(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Lesson title\n\tDetail", WriteOptions{})

	entries, err := s.Read(ReadOptions{ID: "L0001"})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if len(entries[0].Children) != 1 {
		t.Fatalf("expected 1 child, got %d", len(entries[0].Children))
	}
}

func TestRead_BulkByPrefix(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Lesson one", WriteOptions{})
	s.Write("L", "Lesson two", WriteOptions{})
	s.Write("P", "Project one", WriteOptions{})

	entries, err := s.Read(ReadOptions{Prefix: "L"})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 lessons, got %d", len(entries))
	}
}

func TestRead_Search(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "SQLite is fast", WriteOptions{})
	s.Write("L", "Go is great", WriteOptions{})

	entries, err := s.Read(ReadOptions{Search: "SQLite"})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].ID != "L0001" {
		t.Fatalf("unexpected search results: %+v", entries)
	}
}
```

- [ ] **Step 2: Run to verify failure**

```bash
go test ./internal/hmem/... -run TestRead -v
```

Expected: `s.Read undefined`

- [ ] **Step 3: Write `internal/hmem/read.go`**

```go
package hmem

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

// Read queries memory entries based on ReadOptions.
func (s *Store) Read(opts ReadOptions) ([]MemoryEntry, error) {
	if opts.ID != "" {
		return s.readByID(opts.ID, opts.AgentRole)
	}
	if opts.Search != "" {
		return s.readBySearch(opts.Search, opts.AgentRole, opts.Limit)
	}
	return s.readBulk(opts)
}

// readByID returns a single entry by root or node ID + its direct children.
func (s *Store) readByID(id string, role AgentRole) ([]MemoryEntry, error) {
	// Check if it's a root ID or a node ID
	if !strings.Contains(id, ".") {
		return s.readRootByID(id, role)
	}
	return s.readNodeByID(id)
}

func (s *Store) readRootByID(id string, role AgentRole) ([]MemoryEntry, error) {
	row := s.db.QueryRow(`
		SELECT id, prefix, seq, created_at, COALESCE(updated_at,''), title, level_1,
		       COALESCE(links,''), COALESCE(min_role,'worker'),
		       obsolete, favorite, irrelevant, pinned, access_count, COALESCE(last_accessed,'')
		FROM memories WHERE id = ?`, id)

	entry, err := scanEntry(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	// Load direct children
	children, err := s.loadChildren(id)
	if err != nil {
		return nil, err
	}
	entry.Children = children

	// Bump access count
	s.db.Exec(`UPDATE memories SET access_count = access_count + 1, last_accessed = datetime('now') WHERE id = ?`, id) //nolint:errcheck

	return []MemoryEntry{entry}, nil
}

func (s *Store) readNodeByID(id string) ([]MemoryEntry, error) {
	// Return a synthetic MemoryEntry wrapping the node + its children
	row := s.db.QueryRow(`
		SELECT id, parent_id, root_id, depth, seq, COALESCE(title,''), content, created_at, access_count
		FROM memory_nodes WHERE id = ?`, id)

	var node MemoryNode
	if err := row.Scan(&node.ID, &node.ParentID, &node.RootID, &node.Depth, &node.Seq,
		&node.Title, &node.Content, &node.CreatedAt, &node.AccessCount); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	children, err := s.loadChildren(id)
	if err != nil {
		return nil, err
	}
	node.Children = children

	// Return as synthetic root entry
	entry := MemoryEntry{
		ID:       node.RootID,
		Level1:   fmt.Sprintf("[node %s] %s", node.ID, node.Content),
		Children: []MemoryNode{node},
	}
	return []MemoryEntry{entry}, nil
}

// readBulk returns root entries matching prefix/date filters.
func (s *Store) readBulk(opts ReadOptions) ([]MemoryEntry, error) {
	var conditions []string
	var args []any

	conditions = append(conditions, "seq > 0") // exclude headers

	if opts.Prefix != "" {
		conditions = append(conditions, "prefix = ?")
		args = append(args, strings.ToUpper(opts.Prefix))
	}
	if opts.After != "" {
		conditions = append(conditions, "created_at > ?")
		args = append(args, opts.After)
	}
	if opts.Before != "" {
		conditions = append(conditions, "created_at < ?")
		args = append(args, opts.Before)
	}
	if role := opts.AgentRole; role != "" {
		allowed := AllowedRoles(role)
		placeholders := make([]string, len(allowed))
		for i, r := range allowed {
			placeholders[i] = "?"
			args = append(args, string(r))
		}
		conditions = append(conditions, fmt.Sprintf("min_role IN (%s)", strings.Join(placeholders, ",")))
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	limitClause := ""
	if opts.Limit > 0 {
		limitClause = fmt.Sprintf("LIMIT %d", opts.Limit)
	}

	query := fmt.Sprintf(`
		SELECT id, prefix, seq, created_at, COALESCE(updated_at,''), COALESCE(title,''), level_1,
		       COALESCE(links,''), COALESCE(min_role,'worker'),
		       obsolete, favorite, irrelevant, pinned, access_count, COALESCE(last_accessed,'')
		FROM memories %s ORDER BY created_at DESC %s`, where, limitClause)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []MemoryEntry
	for rows.Next() {
		e, err := scanEntryFromRows(rows)
		if err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// readBySearch uses FTS5 to find entries matching the query.
func (s *Store) readBySearch(query string, role AgentRole, limit int) ([]MemoryEntry, error) {
	ftsQuery := fmt.Sprintf(`
		SELECT DISTINCT rm.root_id
		FROM hmem_fts
		JOIN hmem_fts_rowid_map rm ON hmem_fts.rowid = rm.fts_rowid
		WHERE hmem_fts MATCH ?
		LIMIT ?`)

	maxResults := limit
	if maxResults <= 0 {
		maxResults = 20
	}

	rows, err := s.db.Query(ftsQuery, query, maxResults)
	if err != nil {
		return nil, fmt.Errorf("fts search: %w", err)
	}
	defer rows.Close()

	var rootIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		rootIDs = append(rootIDs, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var entries []MemoryEntry
	for _, id := range rootIDs {
		e, err := s.readRootByID(id, role)
		if err == nil && len(e) > 0 {
			entries = append(entries, e[0])
		}
	}
	return entries, nil
}

// loadChildren loads direct children of a given parent ID.
func (s *Store) loadChildren(parentID string) ([]MemoryNode, error) {
	rows, err := s.db.Query(`
		SELECT id, parent_id, root_id, depth, seq, COALESCE(title,''), content, created_at,
		       access_count, favorite, irrelevant
		FROM memory_nodes WHERE parent_id = ? ORDER BY seq ASC`, parentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var nodes []MemoryNode
	for rows.Next() {
		var n MemoryNode
		var fav, irr int
		if err := rows.Scan(&n.ID, &n.ParentID, &n.RootID, &n.Depth, &n.Seq,
			&n.Title, &n.Content, &n.CreatedAt, &n.AccessCount, &fav, &irr); err != nil {
			return nil, err
		}
		n.Favorite = fav == 1
		n.Irrelevant = irr == 1
		nodes = append(nodes, n)
	}
	return nodes, rows.Err()
}

// scanEntry scans a single row from a QueryRow result.
func scanEntry(row *sql.Row) (MemoryEntry, error) {
	var e MemoryEntry
	var linksJSON string
	var obs, fav, irr, pin int
	var lastAccessed string

	err := row.Scan(
		&e.ID, &e.Prefix, &e.Seq, &e.CreatedAt, &e.UpdatedAt,
		&e.Title, &e.Level1, &linksJSON, &e.MinRole,
		&obs, &fav, &irr, &pin,
		&e.AccessCount, &lastAccessed,
	)
	if err != nil {
		return e, err
	}
	e.Obsolete = obs == 1
	e.Favorite = fav == 1
	e.Irrelevant = irr == 1
	e.Pinned = pin == 1
	if lastAccessed != "" {
		e.LastAccessed = &lastAccessed
	}
	if linksJSON != "" && linksJSON != "null" {
		json.Unmarshal([]byte(linksJSON), &e.Links) //nolint:errcheck
	}
	return e, nil
}

func scanEntryFromRows(rows *sql.Rows) (MemoryEntry, error) {
	var e MemoryEntry
	var linksJSON string
	var obs, fav, irr, pin int
	var lastAccessed string

	err := rows.Scan(
		&e.ID, &e.Prefix, &e.Seq, &e.CreatedAt, &e.UpdatedAt,
		&e.Title, &e.Level1, &linksJSON, &e.MinRole,
		&obs, &fav, &irr, &pin,
		&e.AccessCount, &lastAccessed,
	)
	if err != nil {
		return e, err
	}
	e.Obsolete = obs == 1
	e.Favorite = fav == 1
	e.Irrelevant = irr == 1
	e.Pinned = pin == 1
	if lastAccessed != "" {
		e.LastAccessed = &lastAccessed
	}
	if linksJSON != "" && linksJSON != "null" {
		json.Unmarshal([]byte(linksJSON), &e.Links) //nolint:errcheck
	}
	return e, nil
}
```

- [ ] **Step 4: Run tests**

```bash
go test ./internal/hmem/... -run TestRead -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/hmem/read.go internal/hmem/store_test.go
git commit -m "feat(hmem): add Read() — by ID, bulk, FTS5 search"
```

---

## Chunk 4: Append + Update

### Task 7: Append() + Update()

**Files:**
- Create: `internal/hmem/modify.go`
- Modify: `internal/hmem/store_test.go`

- [ ] **Step 1: Add failing tests**

```go
func TestAppend_AddsChildren(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Lesson\n\tExisting child", WriteOptions{})

	result, err := s.Append("L0001", "New child\n\tGrandchild")
	if err != nil {
		t.Fatal(err)
	}
	if result.Count != 2 {
		t.Errorf("expected 2 new nodes, got %d", result.Count)
	}
	// New child should be L0001.2 (after existing L0001.1)
	if result.IDs[0] != "L0001.2" {
		t.Errorf("unexpected ID: %s", result.IDs[0])
	}
}

func TestUpdate_SetFavorite(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Lesson", WriteOptions{})

	fav := true
	if err := s.Update("L0001", UpdateFields{Favorite: &fav}); err != nil {
		t.Fatal(err)
	}
	entries, _ := s.Read(ReadOptions{ID: "L0001"})
	if !entries[0].Favorite {
		t.Error("expected favorite=true")
	}
}

func TestUpdate_SetObsolete(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Old lesson", WriteOptions{})

	obs := true
	newContent := "Wrong — see [✓L0002]"
	if err := s.Update("L0001", UpdateFields{Obsolete: &obs, Content: &newContent}); err != nil {
		t.Fatal(err)
	}
	entries, _ := s.Read(ReadOptions{ID: "L0001"})
	if !entries[0].Obsolete {
		t.Error("expected obsolete=true")
	}
}
```

- [ ] **Step 2: Run to verify failure**

```bash
go test ./internal/hmem/... -run TestAppend -run TestUpdate -v
```

- [ ] **Step 3: Write `internal/hmem/modify.go`**

```go
package hmem

import (
	"fmt"
	"time"
)

// Append adds child nodes to an existing root entry or node.
func (s *Store) Append(parentID, content string) (AppendResult, error) {
	// Determine parent depth
	var parentDepth int
	if !containsDot(parentID) {
		parentDepth = 1 // root entry
	} else {
		row := s.db.QueryRow(`SELECT depth FROM memory_nodes WHERE id = ?`, parentID)
		if err := row.Scan(&parentDepth); err != nil {
			return AppendResult{}, fmt.Errorf("parent node not found: %s", parentID)
		}
	}

	// Find next sibling seq
	var maxSeq int
	s.db.QueryRow(`SELECT COALESCE(MAX(seq), 0) FROM memory_nodes WHERE parent_id = ?`, parentID).Scan(&maxSeq) //nolint:errcheck
	startSeq := maxSeq + 1

	nodes := ParseRelativeTree(content, parentID, parentDepth, startSeq)
	if len(nodes) == 0 {
		return AppendResult{}, nil
	}

	now := time.Now().UTC().Format(time.RFC3339)
	// Determine root_id
	rootID := parentID
	if containsDot(parentID) {
		parts := splitID(parentID)
		rootID = parts[0]
	}

	tx, err := s.db.Begin()
	if err != nil {
		return AppendResult{}, err
	}
	defer tx.Rollback() //nolint:errcheck

	var ids []string
	for _, n := range nodes {
		_, err := tx.Exec(`
			INSERT INTO memory_nodes (id, parent_id, root_id, depth, seq, title, content, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			n.ID, n.ParentID, rootID, n.Depth, n.Seq, autoExtractTitle(n.Content), n.Content, now, now,
		)
		if err != nil {
			return AppendResult{}, fmt.Errorf("insert node %s: %w", n.ID, err)
		}
		ids = append(ids, n.ID)
	}

	if err := tx.Commit(); err != nil {
		return AppendResult{}, err
	}
	return AppendResult{Count: len(ids), IDs: ids}, nil
}

// Update modifies flags or content of an existing entry or node.
func (s *Store) Update(id string, fields UpdateFields) error {
	if !containsDot(id) {
		return s.updateRoot(id, fields)
	}
	return s.updateNode(id, fields)
}

func (s *Store) updateRoot(id string, fields UpdateFields) error {
	now := time.Now().UTC().Format(time.RFC3339)
	if fields.Content != nil {
		if _, err := s.db.Exec(`UPDATE memories SET level_1 = ?, updated_at = ? WHERE id = ?`,
			*fields.Content, now, id); err != nil {
			return err
		}
	}
	if fields.Favorite != nil {
		s.db.Exec(`UPDATE memories SET favorite = ? WHERE id = ?`, boolToInt(*fields.Favorite), id) //nolint:errcheck
	}
	if fields.Obsolete != nil {
		s.db.Exec(`UPDATE memories SET obsolete = ? WHERE id = ?`, boolToInt(*fields.Obsolete), id) //nolint:errcheck
	}
	if fields.Irrelevant != nil {
		s.db.Exec(`UPDATE memories SET irrelevant = ? WHERE id = ?`, boolToInt(*fields.Irrelevant), id) //nolint:errcheck
	}
	if fields.Pinned != nil {
		s.db.Exec(`UPDATE memories SET pinned = ? WHERE id = ?`, boolToInt(*fields.Pinned), id) //nolint:errcheck
	}
	return nil
}

func (s *Store) updateNode(id string, fields UpdateFields) error {
	now := time.Now().UTC().Format(time.RFC3339)
	if fields.Content != nil {
		s.db.Exec(`UPDATE memory_nodes SET content = ?, updated_at = ? WHERE id = ?`, *fields.Content, now, id) //nolint:errcheck
	}
	if fields.Favorite != nil {
		s.db.Exec(`UPDATE memory_nodes SET favorite = ? WHERE id = ?`, boolToInt(*fields.Favorite), id) //nolint:errcheck
	}
	if fields.Irrelevant != nil {
		s.db.Exec(`UPDATE memory_nodes SET irrelevant = ? WHERE id = ?`, boolToInt(*fields.Irrelevant), id) //nolint:errcheck
	}
	return nil
}

func containsDot(id string) bool {
	for _, c := range id {
		if c == '.' {
			return true
		}
	}
	return false
}

func splitID(id string) []string {
	var parts []string
	start := 0
	for i, c := range id {
		if c == '.' {
			parts = append(parts, id[start:i])
			start = i + 1
		}
	}
	parts = append(parts, id[start:])
	return parts
}
```

- [ ] **Step 4: Run tests**

```bash
go test ./internal/hmem/... -run TestAppend -run TestUpdate -v
```

Expected: PASS

- [ ] **Step 5: Run all hmem tests**

```bash
go test ./internal/hmem/... -v
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add internal/hmem/modify.go internal/hmem/store_test.go
git commit -m "feat(hmem): add Append() and Update()"
```

---

## Chunk 5: Render + App Integration

### Task 8: Render for System Prompt

**Files:**
- Create: `internal/hmem/render.go`
- Create: `internal/hmem/render_test.go`

- [ ] **Step 1: Write failing test**

```go
// internal/hmem/render_test.go
package hmem_test

import (
	"strings"
	"testing"

	"github.com/opencode-ai/opencode/internal/hmem"
)

func TestRender_ContainsEntries(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Lesson title\n\tDetail line", hmem.WriteOptions{})

	entries, _ := s.Read(hmem.ReadOptions{})
	output := hmem.Render(entries)

	if !strings.Contains(output, "L0001") {
		t.Error("expected entry ID in output")
	}
	if !strings.Contains(output, "Lesson title") {
		t.Error("expected title in output")
	}
}

func TestRender_EmptyReturnsEmpty(t *testing.T) {
	output := hmem.Render(nil)
	if output != "" {
		t.Errorf("expected empty, got %q", output)
	}
}
```

- [ ] **Step 2: Run to verify failure**

```bash
go test ./internal/hmem/... -run TestRender -v
```

- [ ] **Step 3: Write `internal/hmem/render.go`**

```go
package hmem

import (
	"fmt"
	"strings"
)

// Render formats memory entries for injection into a system prompt.
// Output is compact: one line per root entry + indented children.
func Render(entries []MemoryEntry) string {
	if len(entries) == 0 {
		return ""
	}
	var sb strings.Builder
	for _, e := range entries {
		if e.Irrelevant || e.Obsolete {
			continue
		}
		marker := ""
		if e.Favorite || e.Pinned {
			marker = " [♥]"
		}
		fmt.Fprintf(&sb, "%s%s  %s\n", e.ID, marker, e.Level1)
		for _, n := range e.Children {
			if n.Irrelevant {
				continue
			}
			indent := strings.Repeat("  ", n.Depth-1)
			fmt.Fprintf(&sb, "%s.%d  %s\n", indent, n.Seq, n.Content)
		}
	}
	return strings.TrimRight(sb.String(), "\n")
}
```

- [ ] **Step 4: Run tests**

```bash
go test ./internal/hmem/... -run TestRender -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/hmem/render.go internal/hmem/render_test.go
git commit -m "feat(hmem): add Render() for system prompt injection"
```

---

### Task 9: App Integration — Remove MEMORY.md, Wire hmem

**Files:**
- Delete: `internal/memory/memory.go`
- Delete: `internal/memory/memory_test.go`
- Modify: `internal/llm/prompt/coder.go` — remove MEMORY.md injection, add hmem render
- Modify: `internal/app/app.go` — replace `writeSessionMemory` with `writeHmemMemory`
- Modify: `internal/app/app.go` — remove `internal/memory` import

- [ ] **Step 1: Read the files that will change**

```bash
cat internal/llm/prompt/coder.go
grep -n "memory\|MEMORY\|hmem" internal/app/app.go
```

- [ ] **Step 2: Delete MEMORY.md package**

```bash
rm internal/memory/memory.go internal/memory/memory_test.go
```

- [ ] **Step 3: Remove MEMORY.md injection from `coder.go`**

Find the block that reads MEMORY.md and injects it. Remove it. (Exact lines determined in Step 1.)

- [ ] **Step 4: Add hmem read to system prompt in `coder.go`**

In `coder.go`, add a call to open the agent's `.hmem` store and inject rendered entries:

```go
// In the system prompt builder function, add:
import "github.com/opencode-ai/opencode/internal/hmem"

// Read agent memory (non-fatal if missing)
if hmemPath := cfg.HmemPath; hmemPath != "" {
    if store, err := hmem.Open(hmemPath); err == nil {
        defer store.Close()
        entries, _ := store.Read(hmem.ReadOptions{})
        if rendered := hmem.Render(entries); rendered != "" {
            systemPrompt += "\n\n## Long-term Memory\n" + rendered
        }
    }
}
```

Config field `HmemPath` needs to be added to `Config` in `internal/config/config.go`.

- [ ] **Step 5: Add `HmemPath` to Config**

In `internal/config/config.go`, add to `Data` struct:

```go
HmemPath string `json:"hmemPath,omitempty"`
```

- [ ] **Step 6: Replace `writeSessionMemory` in `app.go`**

Replace the MEMORY.md write with an hmem `Write()` call:

```go
func (a *App) writeHmemMemory(ctx context.Context, sessionID string, lastResponse string) error {
    cfg := config.Get()
    if cfg.Data.HmemPath == "" {
        return nil
    }
    store, err := hmem.Open(cfg.Data.HmemPath)
    if err != nil {
        return err
    }
    defer store.Close()

    // Ask LLM to summarize session into hmem write_memory format
    prompt := fmt.Sprintf(`Summarize the key learnings from this session as a single write_memory call.
Format: PREFIX + content with tab-indented details.
Prefixes: P=Project, L=Lesson, E=Error, D=Decision.
Only include things worth remembering in future sessions.
Last response: %s
Write the prefix letter on the first line, then the content. Example:
L
Lesson title here
	Detail one
	Detail two`, lastResponse)

    done, err := a.CoderAgent.Run(ctx, sessionID, prompt)
    if err != nil {
        return err
    }
    result := <-done
    if result.Error != nil {
        return result.Error
    }

    lines := strings.SplitN(strings.TrimSpace(result.Message.Content().String()), "\n", 2)
    if len(lines) < 2 {
        return nil
    }
    prefix := strings.TrimSpace(lines[0])
    content := strings.TrimSpace(lines[1])
    _, err = store.Write(prefix, content, hmem.WriteOptions{})
    return err
}
```

Update the call site in `RunNonInteractive` from `writeSessionMemory` → `writeHmemMemory`.

- [ ] **Step 7: Build**

```bash
go build ./...
```

Fix any import or compile errors.

- [ ] **Step 8: Run all tests**

```bash
go test ./internal/hmem/... ./internal/app/... -v
```

Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(heimdall): wire internal/hmem — remove MEMORY.md, inject hmem into prompt + session-end write"
```

---

## Final: Smoke Test

- [ ] **Build and run**

```bash
go build -o heimdall . && echo "BUILD OK"
./heimdall --help | grep -E "add-dir|resume"
```

Expected: both flags visible in help output.

- [ ] **Run full test suite**

```bash
go test ./... 2>&1 | tail -5
```

Expected: all packages PASS

- [ ] **Final commit tag**

```bash
git tag hmem-phase1
git push origin asgard-agent-identity --tags
```
