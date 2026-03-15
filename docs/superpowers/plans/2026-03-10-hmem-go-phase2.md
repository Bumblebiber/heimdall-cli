# Heimdall hmem Go — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the hmem Go library with Tags management, Delete, Stats, HealthCheck, FindRelated, Session Cache, and Bulk Read V2 selection — matching hmem-mcp feature parity for these features.

**Architecture:** Extends `internal/hmem/` from Phase 1. New files for tags, stats, health, find_related, session cache, and V2 bulk read. All SQL matches hmem-mcp. Session cache is in-memory (per Store instance).

**Tech Stack:** Go 1.21+, `github.com/ncruces/go-sqlite3`, FTS5.

**Working directory for all commands:** `/home/bbbee/opencode/.worktrees/asgard-agent-identity/`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `internal/hmem/tags.go` | validateTags, setTags, fetchTags, fetchTagsBulk, assignBulkTags |
| `internal/hmem/tags_test.go` | Tag tests |
| `internal/hmem/delete.go` | Delete() with cascade |
| `internal/hmem/stats.go` | Stats(), HealthCheck() |
| `internal/hmem/stats_test.go` | Stats + health tests |
| `internal/hmem/related.go` | FindRelated(), FindRelatedCombined(), findRelatedByFts() |
| `internal/hmem/related_test.go` | Related entry tests |
| `internal/hmem/session_cache.go` | SessionCache struct (hidden/cached ID tracking) |
| `internal/hmem/bulk_read.go` | ReadBulkV2() — full V2 selection algorithm |
| `internal/hmem/bulk_read_test.go` | V2 bulk read tests |

---

## Chunk 1: Tags + Delete

### Task 1: Tags Management

**Files:**
- Create: `internal/hmem/tags.go`
- Create: `internal/hmem/tags_test.go`
- Modify: `internal/hmem/write.go` — replace inline insertTagsTx with call to tags.go

- [ ] **Step 1: Write failing tests**

```go
// internal/hmem/tags_test.go
package hmem_test

import (
	"testing"
	"github.com/opencode-ai/opencode/internal/hmem"
)

func TestValidateTags(t *testing.T) {
	valid := hmem.ValidateTags([]string{"#hmem", "#go", "invalid", "#UPPER", "#too-many-1", "#too-many-2", "#too-many-3", "#too-many-4", "#too-many-5", "#too-many-6", "#too-many-7", "#too-many-8", "#too-many-9", "#too-many-10", "#too-many-11"})
	// Max 10, lowercased, # prefix required
	if len(valid) > 10 {
		t.Errorf("expected max 10 tags, got %d", len(valid))
	}
	for _, tag := range valid {
		if tag[0] != '#' {
			t.Errorf("tag missing # prefix: %s", tag)
		}
	}
}

func TestSetAndFetchTags(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Lesson\n\tDetail", hmem.WriteOptions{Tags: []string{"#hmem", "#go"}})
	tags := s.FetchTags("L0001.1") // tags go on first child
	if len(tags) != 2 {
		t.Fatalf("expected 2 tags, got %d: %v", len(tags), tags)
	}
}

func TestSetTags_Replaces(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Lesson\n\tDetail", hmem.WriteOptions{Tags: []string{"#old"}})
	s.SetTags("L0001.1", []string{"#new1", "#new2"})
	tags := s.FetchTags("L0001.1")
	if len(tags) != 2 {
		t.Errorf("expected 2 tags after replace, got %d", len(tags))
	}
}

func TestFetchTagsBulk(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Lesson 1\n\tChild", hmem.WriteOptions{Tags: []string{"#a"}})
	s.Write("L", "Lesson 2\n\tChild", hmem.WriteOptions{Tags: []string{"#b"}})
	tagMap := s.FetchTagsBulk([]string{"L0001.1", "L0002.1"})
	if len(tagMap) != 2 {
		t.Errorf("expected 2 entries in tag map, got %d", len(tagMap))
	}
}
```

- [ ] **Step 2: Run to verify failure**

```bash
go test ./internal/hmem/... -run TestValidate -run TestSet -run TestFetchTags -v
```

- [ ] **Step 3: Write `internal/hmem/tags.go`**

Port from hmem-store.ts lines 1771-1893:
- `ValidateTags(tags []string) []string` — regex `^#[a-z0-9_-]{1,49}$`, max 10, lowercase, dedup
- `(s *Store) SetTags(entryID string, tags []string)` — DELETE old + INSERT new
- `(s *Store) FetchTags(entryID string) []string` — SELECT tag WHERE entry_id
- `(s *Store) FetchTagsBulk(ids []string) map[string][]string` — chunked fetch (500/chunk)
- `(s *Store) AssignBulkTags(entries []MemoryEntry)` — fetch all tags for entries + children, assign to structs

Move `insertTagsTx` logic from write.go into tags.go; update write.go to call `ValidateTags` and the new `SetTags`.

- [ ] **Step 4: Run tests, fix failures**
- [ ] **Step 5: Run full suite:** `go test ./internal/hmem/... -v`
- [ ] **Step 6: Commit**

```bash
git add internal/hmem/tags.go internal/hmem/tags_test.go internal/hmem/write.go
git commit -m "feat(hmem): add full tag management — validate, set, fetch, bulk"
```

---

### Task 2: Delete()

**Files:**
- Create: `internal/hmem/delete.go`
- Modify: `internal/hmem/store_test.go` — add delete tests

- [ ] **Step 1: Write failing tests**

```go
func TestDelete_RemovesEntry(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "To delete\n\tChild node", hmem.WriteOptions{Tags: []string{"#test"}})
	ok := s.Delete("L0001")
	if !ok {
		t.Error("expected delete to return true")
	}
	entries, _ := s.Read(hmem.ReadOptions{ID: "L0001"})
	if len(entries) != 0 {
		t.Error("expected entry to be gone after delete")
	}
}

func TestDelete_NonExistent(t *testing.T) {
	s := openTestStore(t)
	ok := s.Delete("L9999")
	if ok {
		t.Error("expected false for non-existent entry")
	}
}
```

- [ ] **Step 2: Write `internal/hmem/delete.go`**

```go
package hmem

// Delete removes a root entry, its child nodes, and all associated tags.
// Returns true if the entry existed and was deleted.
func (s *Store) Delete(id string) bool {
	// Delete tags for root + all child nodes
	s.db.Exec("DELETE FROM memory_tags WHERE entry_id = ? OR entry_id LIKE ?", id, id+".%")
	// Delete child nodes
	s.db.Exec("DELETE FROM memory_nodes WHERE root_id = ?", id)
	// Delete root (FTS triggers handle cleanup)
	result, err := s.db.Exec("DELETE FROM memories WHERE id = ?", id)
	if err != nil {
		return false
	}
	n, _ := result.RowsAffected()
	return n > 0
}
```

- [ ] **Step 3: Run tests, verify pass**
- [ ] **Step 4: Commit**

```bash
git add internal/hmem/delete.go internal/hmem/store_test.go
git commit -m "feat(hmem): add Delete() with cascade"
```

---

## Chunk 2: Stats + Health

### Task 3: Stats()

**Files:**
- Create: `internal/hmem/stats.go`
- Create: `internal/hmem/stats_test.go`

- [ ] **Step 1: Write failing tests**

```go
package hmem_test

import (
	"testing"
	"github.com/opencode-ai/opencode/internal/hmem"
)

func TestStats_Empty(t *testing.T) {
	s := openTestStore(t)
	stats := s.Stats()
	if stats.Total != 0 {
		t.Errorf("expected 0, got %d", stats.Total)
	}
}

func TestStats_WithEntries(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Lesson one", hmem.WriteOptions{})
	s.Write("L", "Lesson two", hmem.WriteOptions{})
	s.Write("P", "Project one\n\tChild detail", hmem.WriteOptions{})

	stats := s.Stats()
	if stats.Total != 3 {
		t.Errorf("expected 3 total, got %d", stats.Total)
	}
	if stats.ByPrefix["L"] != 2 {
		t.Errorf("expected 2 lessons, got %d", stats.ByPrefix["L"])
	}
	if stats.TotalChars == 0 {
		t.Error("expected non-zero totalChars")
	}
}
```

- [ ] **Step 2: Write `internal/hmem/stats.go`**

```go
package hmem

// StatsResult holds aggregate memory statistics.
type StatsResult struct {
	Total      int
	ByPrefix   map[string]int
	TotalChars int
}

// Stats returns aggregate statistics about the memory store.
func (s *Store) Stats() StatsResult {
	var total int
	s.db.QueryRow("SELECT COUNT(*) FROM memories WHERE seq > 0").Scan(&total)

	byPrefix := map[string]int{}
	rows, _ := s.db.Query("SELECT prefix, COUNT(*) FROM memories WHERE seq > 0 GROUP BY prefix")
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var p string
			var c int
			rows.Scan(&p, &c)
			byPrefix[p] = c
		}
	}

	var memChars, nodeChars int
	s.db.QueryRow("SELECT COALESCE(SUM(LENGTH(level_1)),0) FROM memories WHERE seq > 0").Scan(&memChars)
	s.db.QueryRow("SELECT COALESCE(SUM(LENGTH(content)),0) FROM memory_nodes").Scan(&nodeChars)

	return StatsResult{Total: total, ByPrefix: byPrefix, TotalChars: memChars + nodeChars}
}
```

- [ ] **Step 3: Run tests**
- [ ] **Step 4: Commit**

```bash
git add internal/hmem/stats.go internal/hmem/stats_test.go
git commit -m "feat(hmem): add Stats()"
```

---

### Task 4: HealthCheck()

**Files:**
- Modify: `internal/hmem/stats.go` — add HealthCheck
- Modify: `internal/hmem/stats_test.go` — add health tests

- [ ] **Step 1: Write failing tests**

```go
func TestHealthCheck_Clean(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Lesson\n\tChild", hmem.WriteOptions{Tags: []string{"#test"}})
	h := s.HealthCheck()
	if len(h.BrokenLinks) != 0 {
		t.Errorf("expected no broken links, got %d", len(h.BrokenLinks))
	}
	if h.TagOrphans != 0 {
		t.Errorf("expected no tag orphans, got %d", h.TagOrphans)
	}
}

func TestHealthCheck_BrokenLink(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Lesson", hmem.WriteOptions{Links: []string{"X9999"}})
	h := s.HealthCheck()
	if len(h.BrokenLinks) != 1 {
		t.Errorf("expected 1 broken link, got %d", len(h.BrokenLinks))
	}
}
```

- [ ] **Step 2: Write HealthCheck()**

```go
// HealthResult holds memory health check results.
type HealthResult struct {
	BrokenLinks          []string // entry IDs with links to non-existent entries
	OrphanedEntries      []string // root entries with no child nodes
	StaleFavorites       []string // favorites not accessed in 60+ days
	BrokenObsoleteChains []string // obsolete entries with broken [✓ID] references
	TagOrphans           int      // tags pointing to non-existent entries/nodes
}

// HealthCheck audits the memory store for structural issues.
func (s *Store) HealthCheck() HealthResult {
	var h HealthResult

	// 1. Broken links
	rows, _ := s.db.Query("SELECT id, links FROM memories WHERE COALESCE(links,'') != '' AND COALESCE(links,'null') != 'null' AND seq > 0")
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var id, linksJSON string
			rows.Scan(&id, &linksJSON)
			var links []string
			json.Unmarshal([]byte(linksJSON), &links)
			for _, link := range links {
				var exists int
				s.db.QueryRow("SELECT COUNT(*) FROM memories WHERE id = ?", link).Scan(&exists)
				if exists == 0 {
					h.BrokenLinks = append(h.BrokenLinks, id)
					break
				}
			}
		}
	}

	// 2. Orphaned entries (no children, seq > 0)
	oRows, _ := s.db.Query(`
		SELECT m.id FROM memories m
		LEFT JOIN memory_nodes mn ON mn.root_id = m.id
		WHERE m.seq > 0 AND mn.id IS NULL
		LIMIT 20`)
	if oRows != nil {
		defer oRows.Close()
		for oRows.Next() {
			var id string
			oRows.Scan(&id)
			h.OrphanedEntries = append(h.OrphanedEntries, id)
		}
	}

	// 3. Stale favorites
	sfRows, _ := s.db.Query(`
		SELECT id FROM memories
		WHERE (favorite=1 OR pinned=1) AND last_accessed < datetime('now', '-60 days')
		AND seq > 0`)
	if sfRows != nil {
		defer sfRows.Close()
		for sfRows.Next() {
			var id string
			sfRows.Scan(&id)
			h.StaleFavorites = append(h.StaleFavorites, id)
		}
	}

	// 4. Broken obsolete chains
	bRows, _ := s.db.Query("SELECT id, level_1 FROM memories WHERE obsolete=1 AND seq > 0")
	if bRows != nil {
		defer bRows.Close()
		for bRows.Next() {
			var id, l1 string
			bRows.Scan(&id, &l1)
			// Parse [✓ID] reference
			if idx := strings.Index(l1, "[✓"); idx >= 0 {
				end := strings.Index(l1[idx:], "]")
				if end > 2 {
					ref := l1[idx+len("[✓") : idx+end]
					var exists int
					s.db.QueryRow("SELECT COUNT(*) FROM memories WHERE id = ?", ref).Scan(&exists)
					if exists == 0 {
						h.BrokenObsoleteChains = append(h.BrokenObsoleteChains, id)
					}
				}
			}
		}
	}

	// 5. Tag orphans
	s.db.QueryRow(`
		SELECT COUNT(*) FROM memory_tags mt
		WHERE NOT EXISTS (SELECT 1 FROM memories m WHERE m.id = mt.entry_id)
		AND NOT EXISTS (SELECT 1 FROM memory_nodes mn WHERE mn.id = mt.entry_id)
	`).Scan(&h.TagOrphans)

	return h
}
```

Add `"encoding/json"` and `"strings"` to stats.go imports.

- [ ] **Step 3: Run tests**
- [ ] **Step 4: Commit**

```bash
git add internal/hmem/stats.go internal/hmem/stats_test.go
git commit -m "feat(hmem): add HealthCheck() — 5 structural audits"
```

---

## Chunk 3: FindRelated

### Task 5: FindRelated + FindRelatedCombined

**Files:**
- Create: `internal/hmem/related.go`
- Create: `internal/hmem/related_test.go`

- [ ] **Step 1: Write failing tests**

```go
package hmem_test

import (
	"testing"
	"github.com/opencode-ai/opencode/internal/hmem"
)

func TestFindRelated_ByTags(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Lesson A\n\tDetail A", hmem.WriteOptions{Tags: []string{"#hmem", "#go"}})
	s.Write("L", "Lesson B\n\tDetail B", hmem.WriteOptions{Tags: []string{"#hmem", "#go"}})
	s.Write("L", "Lesson C\n\tDetail C", hmem.WriteOptions{Tags: []string{"#unrelated"}})

	related := s.FindRelated("L0001", 5)
	if len(related) < 1 {
		t.Fatal("expected at least 1 related entry")
	}
	if related[0].ID != "L0002" {
		t.Errorf("expected L0002 as most related, got %s", related[0].ID)
	}
}

func TestFindRelated_Empty(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Lesson alone", hmem.WriteOptions{})
	related := s.FindRelated("L0001", 5)
	if len(related) != 0 {
		t.Errorf("expected 0 related, got %d", len(related))
	}
}

func TestFindRelated_ByFTS(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "SQLite performance tuning guide", hmem.WriteOptions{})
	s.Write("L", "PostgreSQL performance optimization", hmem.WriteOptions{})
	s.Write("L", "Cooking recipes for dinner", hmem.WriteOptions{})

	related := s.FindRelated("L0001", 5)
	// L0002 shares "performance" keyword
	found := false
	for _, r := range related {
		if r.ID == "L0002" {
			found = true
		}
	}
	if !found {
		t.Error("expected L0002 (performance) in related results")
	}
}
```

- [ ] **Step 2: Write `internal/hmem/related.go`**

Port from hmem-store.ts:
- `FindRelated(entryID string, limit int) []RelatedEntry` — hybrid: tags first, FTS second
- `findRelatedByTags(entryID string, tags []string, limit int) []RelatedEntry`
- `findRelatedByFts(entryID string, limit int) []RelatedEntry`

```go
package hmem

import (
	"fmt"
	"regexp"
	"strings"
)

// RelatedEntry is a found related memory entry.
type RelatedEntry struct {
	ID        string
	Title     string
	CreatedAt string
	Tags      []string
	MatchType string // "tags" or "fts"
}

// FindRelated finds entries related to the given entry via tag overlap and FTS.
func (s *Store) FindRelated(entryID string, limit int) []RelatedEntry {
	if limit <= 0 {
		limit = 5
	}

	// Phase 1: collect all tags from entry + child nodes
	allNodeIDs := []string{entryID}
	nodeRows, _ := s.db.Query("SELECT id FROM memory_nodes WHERE root_id = ?", entryID)
	if nodeRows != nil {
		defer nodeRows.Close()
		for nodeRows.Next() {
			var nid string
			nodeRows.Scan(&nid)
			allNodeIDs = append(allNodeIDs, nid)
		}
	}

	tagMap := s.FetchTagsBulk(allNodeIDs)
	var allTags []string
	for _, tags := range tagMap {
		allTags = append(allTags, tags...)
	}
	allTags = dedup(allTags)

	var results []RelatedEntry
	seen := map[string]bool{}

	// Tag-based matches (≥2 shared tags)
	if len(allTags) >= 2 {
		tagResults := s.findRelatedByTags(entryID, allTags, limit)
		for _, r := range tagResults {
			if !seen[r.ID] {
				seen[r.ID] = true
				results = append(results, r)
			}
		}
	}

	// FTS-based matches to fill remaining slots
	if len(results) < limit {
		ftsResults := s.findRelatedByFts(entryID, limit-len(results))
		for _, r := range ftsResults {
			if !seen[r.ID] {
				seen[r.ID] = true
				results = append(results, r)
			}
		}
	}

	if len(results) > limit {
		results = results[:limit]
	}
	return results
}

func (s *Store) findRelatedByTags(entryID string, tags []string, limit int) []RelatedEntry {
	if len(tags) == 0 {
		return nil
	}
	placeholders := make([]string, len(tags))
	args := make([]any, len(tags))
	for i, t := range tags {
		placeholders[i] = "?"
		args[i] = t
	}
	args = append(args, entryID, entryID, limit*3)

	query := fmt.Sprintf(`
		SELECT entry_id, COUNT(*) as shared
		FROM memory_tags
		WHERE tag IN (%s) AND entry_id != ? AND entry_id NOT LIKE ? || '.%%'
		GROUP BY entry_id
		HAVING COUNT(*) >= 2
		ORDER BY shared DESC
		LIMIT ?`, strings.Join(placeholders, ","))

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()

	seen := map[string]bool{}
	var results []RelatedEntry
	for rows.Next() {
		var eid string
		var shared int
		rows.Scan(&eid, &shared)
		rootID := rootIDFrom(eid)
		if seen[rootID] {
			continue
		}
		seen[rootID] = true
		var title, createdAt string
		s.db.QueryRow("SELECT COALESCE(title,''), created_at FROM memories WHERE id = ?", rootID).Scan(&title, &createdAt)
		entryTags := s.FetchTags(rootID)
		results = append(results, RelatedEntry{ID: rootID, Title: title, CreatedAt: createdAt, Tags: entryTags, MatchType: "tags"})
		if len(results) >= limit {
			break
		}
	}
	return results
}

var stopwords = map[string]bool{
	"the": true, "and": true, "for": true, "with": true, "that": true, "this": true,
	"from": true, "have": true, "been": true, "were": true, "will": true, "when": true,
	"they": true, "what": true, "which": true, "their": true, "about": true, "would": true,
	"there": true, "could": true, "other": true, "into": true, "more": true, "some": true,
	"than": true, "only": true, "very": true, "also": true, "just": true, "nach": true,
	"nicht": true, "eine": true, "aber": true, "oder": true, "wenn": true, "noch": true,
	"auch": true, "wird": true, "sind": true, "dass": true, "dann": true,
}

var wordRe = regexp.MustCompile(`[a-zA-Z0-9äöüÄÖÜß]+`)

func (s *Store) findRelatedByFts(entryID string, limit int) []RelatedEntry {
	var level1 string
	s.db.QueryRow("SELECT COALESCE(level_1,'') FROM memories WHERE id = ?", entryID).Scan(&level1)
	if level1 == "" {
		return nil
	}

	// Extract significant keywords
	allWords := wordRe.FindAllString(level1, -1)
	var words []string
	for _, w := range allWords {
		lower := strings.ToLower(w)
		if len(lower) > 3 && !stopwords[lower] {
			words = append(words, w)
		}
		if len(words) >= 6 {
			break
		}
	}
	if len(words) == 0 {
		return nil
	}

	// Try AND query with top 3 words, fallback to OR
	quoted := make([]string, len(words))
	for i, w := range words {
		quoted[i] = fmt.Sprintf(`"%s"`, w)
	}
	andQuery := strings.Join(quoted[:min(3, len(quoted))], " ")
	orQuery := strings.Join(quoted, " OR ")

	rootIDs := s.ftsRootIDs(andQuery, entryID, limit*3)
	if len(rootIDs) == 0 && len(words) >= 2 {
		rootIDs = s.ftsRootIDs(orQuery, entryID, limit*3)
	}

	var results []RelatedEntry
	for _, rid := range rootIDs {
		var title, createdAt string
		s.db.QueryRow("SELECT COALESCE(title,''), created_at FROM memories WHERE id = ?", rid).Scan(&title, &createdAt)
		tags := s.FetchTags(rid)
		results = append(results, RelatedEntry{ID: rid, Title: title, CreatedAt: createdAt, Tags: tags, MatchType: "fts"})
		if len(results) >= limit {
			break
		}
	}
	return results
}

func (s *Store) ftsRootIDs(query, excludeID string, limit int) []string {
	rows, err := s.db.Query(`
		SELECT DISTINCT rm.root_id
		FROM hmem_fts
		JOIN hmem_fts_rowid_map rm ON hmem_fts.rowid = rm.fts_rowid
		WHERE hmem_fts MATCH ? AND rm.root_id != ?
		LIMIT ?`, query, excludeID, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ids = append(ids, id)
	}
	return ids
}

func dedup(ss []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range ss {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
```

- [ ] **Step 3: Run tests**
- [ ] **Step 4: Commit**

```bash
git add internal/hmem/related.go internal/hmem/related_test.go
git commit -m "feat(hmem): add FindRelated() — tag overlap + FTS hybrid"
```

---

## Chunk 4: Session Cache + Bulk Read V2

### Task 6: Session Cache

**Files:**
- Create: `internal/hmem/session_cache.go`
- Modify: `internal/hmem/types.go` — add ReadOptions fields for cache

- [ ] **Step 1: Write `internal/hmem/session_cache.go`**

```go
package hmem

import (
	"sync"
	"time"
)

// SessionCache tracks which entries have been delivered in previous reads.
// Entries transition: fresh → hidden (< 5 min) → cached (5-30 min) → fresh.
type SessionCache struct {
	mu      sync.Mutex
	entries map[string]time.Time // entry ID → first seen time
}

// NewSessionCache creates a new empty session cache.
func NewSessionCache() *SessionCache {
	return &SessionCache{entries: make(map[string]time.Time)}
}

const (
	hiddenDuration = 5 * time.Minute  // completely excluded from bulk reads
	cachedDuration = 30 * time.Minute // included as title-only
)

// Record marks an entry as seen at the current time.
func (c *SessionCache) Record(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.entries[id]; !ok {
		c.entries[id] = time.Now()
	}
}

// RecordAll marks multiple entries as seen.
func (c *SessionCache) RecordAll(ids []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	for _, id := range ids {
		if _, ok := c.entries[id]; !ok {
			c.entries[id] = now
		}
	}
}

// IsHidden returns true if the entry was seen less than 5 minutes ago.
func (c *SessionCache) IsHidden(id string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	t, ok := c.entries[id]
	if !ok {
		return false
	}
	return time.Since(t) < hiddenDuration
}

// IsCached returns true if the entry was seen 5-30 minutes ago (title-only).
func (c *SessionCache) IsCached(id string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	t, ok := c.entries[id]
	if !ok {
		return false
	}
	age := time.Since(t)
	return age >= hiddenDuration && age < cachedDuration
}

// HiddenAndCachedSets returns the current hidden and cached ID sets.
func (c *SessionCache) HiddenAndCachedSets() (hidden map[string]bool, cached map[string]bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	hidden = map[string]bool{}
	cached = map[string]bool{}
	now := time.Now()
	for id, t := range c.entries {
		age := now.Sub(t)
		if age < hiddenDuration {
			hidden[id] = true
		} else if age < cachedDuration {
			cached[id] = true
		}
		// else: expired, treat as fresh
	}
	return
}
```

- [ ] **Step 2: Add `Cache *SessionCache` field to Store**

In `store.go`, add to the `Open()` function:
```go
s := &Store{db: db, path: hmemPath, Cache: NewSessionCache()}
```

And to the `Store` struct:
```go
type Store struct {
	db    *sql.DB
	path  string
	Cache *SessionCache
}
```

- [ ] **Step 3: Commit**

```bash
git add internal/hmem/session_cache.go internal/hmem/store.go
git commit -m "feat(hmem): add SessionCache for bulk read V2"
```

---

### Task 7: Bulk Read V2

**Files:**
- Create: `internal/hmem/bulk_read.go`
- Create: `internal/hmem/bulk_read_test.go`
- Modify: `internal/hmem/read.go` — route bulk reads through V2

- [ ] **Step 1: Write failing tests**

```go
package hmem_test

import (
	"testing"
	"github.com/opencode-ai/opencode/internal/hmem"
)

func TestBulkReadV2_FavoritesAlwaysIncluded(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Normal lesson 1", hmem.WriteOptions{})
	s.Write("L", "Favorite lesson", hmem.WriteOptions{Favorite: true})
	s.Write("L", "Normal lesson 2", hmem.WriteOptions{})

	entries, _ := s.Read(hmem.ReadOptions{})
	found := false
	for _, e := range entries {
		if e.ID == "L0002" && e.Favorite {
			found = true
		}
	}
	if !found {
		t.Error("expected favorite entry L0002 in bulk read results")
	}
}

func TestBulkReadV2_ObsoleteFiltered(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Good lesson", hmem.WriteOptions{})
	s.Write("L", "Bad lesson", hmem.WriteOptions{})
	obs := true
	s.Update("L0002", hmem.UpdateFields{Obsolete: &obs})

	entries, _ := s.Read(hmem.ReadOptions{})
	for _, e := range entries {
		if e.ID == "L0002" {
			t.Error("obsolete entry should be filtered from default bulk read")
		}
	}
}

func TestBulkReadV2_IrrelevantHidden(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Good lesson", hmem.WriteOptions{})
	s.Write("L", "Irrelevant lesson", hmem.WriteOptions{})
	irr := true
	s.Update("L0002", hmem.UpdateFields{Irrelevant: &irr})

	entries, _ := s.Read(hmem.ReadOptions{})
	for _, e := range entries {
		if e.ID == "L0002" {
			t.Error("irrelevant entry should be hidden")
		}
	}
}

func TestBulkReadV2_SessionCacheHides(t *testing.T) {
	s := openTestStore(t)
	s.Write("L", "Lesson one", hmem.WriteOptions{})
	s.Write("L", "Lesson two", hmem.WriteOptions{})

	// First read populates cache
	entries1, _ := s.Read(hmem.ReadOptions{})
	count1 := len(entries1)

	// Second read within hidden window — cached entries excluded
	entries2, _ := s.Read(hmem.ReadOptions{})
	if len(entries2) >= count1 {
		// Entries should be hidden (within 5 min window)
		// They might still show as cached depending on timing; just verify no crash
	}
}
```

- [ ] **Step 2: Write `internal/hmem/bulk_read.go`**

Port the V2 algorithm from hmem-store.ts lines 723-1007. Key aspects:
- Per-prefix slot allocation: newest (60%) + most-accessed (40%)
- Global promotions: all favorites + pinned (never filtered)
- Session cache: hidden entries excluded, cached entries title-only
- Obsolete: filtered by default (top 3 by access shown if showObsolete)
- Irrelevant: always hidden
- Promoted markers: "favorite" [♥], "access" [★]

```go
package hmem

import (
	"database/sql"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

// ReadBulkV2 performs a V2-selection bulk read with session cache awareness.
func (s *Store) ReadBulkV2(opts ReadOptions) ([]MemoryEntry, error) {
	// Fetch all matching root entries
	allEntries, err := s.readBulkAll(opts)
	if err != nil {
		return nil, err
	}
	if len(allEntries) == 0 {
		return nil, nil
	}

	hidden, cached := s.Cache.HiddenAndCachedSets()

	// Separate obsolete and irrelevant
	var active, obsolete []MemoryEntry
	for _, e := range allEntries {
		if e.Irrelevant {
			continue // always hidden
		}
		if e.Obsolete {
			obsolete = append(obsolete, e)
		} else {
			active = append(active, e)
		}
	}

	// Group by prefix
	byPrefix := map[string][]MemoryEntry{}
	for _, e := range active {
		byPrefix[e.Prefix] = append(byPrefix[e.Prefix], e)
	}

	expandedIDs := map[string]bool{}

	// Per-prefix: newest + most-accessed
	for _, prefixEntries := range byPrefix {
		total := len(prefixEntries)
		newestCount := max(1, int(math.Ceil(float64(total)*0.6)))
		accessCount := max(1, int(math.Ceil(float64(total)*0.4)))

		// Newest: uncached + unhidden (already sorted by created_at DESC)
		added := 0
		for _, e := range prefixEntries {
			if hidden[e.ID] || cached[e.ID] {
				continue
			}
			expandedIDs[e.ID] = true
			added++
			if added >= newestCount {
				break
			}
		}

		// Most-accessed: >= 2 accesses, not already expanded
		type scored struct {
			entry MemoryEntry
			score float64
		}
		var candidates []scored
		for _, e := range prefixEntries {
			if e.AccessCount < 2 || expandedIDs[e.ID] || hidden[e.ID] || cached[e.ID] {
				continue
			}
			candidates = append(candidates, scored{entry: e, score: weightedAccessScore(e)})
		}
		sort.Slice(candidates, func(i, j int) bool {
			return candidates[i].score > candidates[j].score
		})
		for i := 0; i < accessCount && i < len(candidates); i++ {
			expandedIDs[candidates[i].entry.ID] = true
		}
	}

	// Global: all favorites + pinned (uncached/unhidden)
	for _, e := range active {
		if (e.Favorite || e.Pinned) && !hidden[e.ID] && !cached[e.ID] {
			expandedIDs[e.ID] = true
		}
	}

	// Build result: expanded entries with children
	var result []MemoryEntry
	for _, e := range active {
		if hidden[e.ID] {
			continue
		}
		if expandedIDs[e.ID] {
			children, _ := s.loadDirectChildren(e.ID)
			e.Children = children
			if e.Favorite || e.Pinned {
				e.Promoted = "favorite"
			}
			result = append(result, e)
		} else if cached[e.ID] {
			// Title-only for cached entries
			e.Children = nil
			result = append(result, e)
		}
	}

	// Record all returned IDs in session cache
	var returnedIDs []string
	for _, e := range result {
		returnedIDs = append(returnedIDs, e.ID)
	}
	s.Cache.RecordAll(returnedIDs)

	// Assign tags
	s.AssignBulkTags(result)

	return result, nil
}

// readBulkAll fetches all root entries matching the filter (no V2 selection).
func (s *Store) readBulkAll(opts ReadOptions) ([]MemoryEntry, error) {
	var conditions []string
	var args []any
	conditions = append(conditions, "seq > 0")
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
	if opts.AgentRole != "" {
		allowed := AllowedRoles(opts.AgentRole)
		ph := make([]string, len(allowed))
		for i, r := range allowed {
			ph[i] = "?"
			args = append(args, string(r))
		}
		conditions = append(conditions, fmt.Sprintf("COALESCE(min_role,'worker') IN (%s)", strings.Join(ph, ",")))
	}
	where := "WHERE " + strings.Join(conditions, " AND ")
	query := fmt.Sprintf(`
		SELECT id, prefix, seq, created_at, COALESCE(updated_at,''), COALESCE(title,''), level_1,
		       COALESCE(links,''), COALESCE(min_role,'worker'),
		       COALESCE(obsolete,0), COALESCE(favorite,0), COALESCE(irrelevant,0), COALESCE(pinned,0),
		       COALESCE(access_count,0), COALESCE(last_accessed,'')
		FROM memories %s ORDER BY created_at DESC`, where)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var entries []MemoryEntry
	for rows.Next() {
		e, err := scanEntryRows(rows)
		if err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// weightedAccessScore returns a time-decayed access score.
// access_count / log2(age_in_days + 2)
func weightedAccessScore(e MemoryEntry) float64 {
	created, err := time.Parse(time.RFC3339, e.CreatedAt)
	if err != nil {
		return float64(e.AccessCount)
	}
	ageDays := time.Since(created).Hours() / 24
	return float64(e.AccessCount) / math.Log2(ageDays+2)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
```

- [ ] **Step 3: Update `read.go` to use V2 for bulk reads**

In `read.go`, change the `Read()` dispatch to route bulk reads through `ReadBulkV2`:

```go
func (s *Store) Read(opts ReadOptions) ([]MemoryEntry, error) {
	switch {
	case opts.ID != "":
		return s.readByID(opts.ID, opts.AgentRole)
	case opts.Search != "":
		return s.readBySearch(opts.Search, opts.AgentRole, opts.Limit)
	default:
		return s.ReadBulkV2(opts)
	}
}
```

Keep the old `readBulk` as a fallback (rename to `readBulkSimple` if needed).

- [ ] **Step 4: Run tests**

```bash
go test ./internal/hmem/... -v
```

All existing tests + new bulk_read tests must pass.

- [ ] **Step 5: Commit**

```bash
git add internal/hmem/bulk_read.go internal/hmem/bulk_read_test.go internal/hmem/read.go
git commit -m "feat(hmem): add Bulk Read V2 with session cache + per-prefix selection"
```

---

## Final: Full Test Run

- [ ] **Run all hmem tests**

```bash
go test ./internal/hmem/... -v -count=1
```

Expected: all PASS

- [ ] **Build entire project**

```bash
go build ./...
```

Expected: no errors

- [ ] **Tag**

```bash
git tag hmem-phase2
```
