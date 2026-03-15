# /groupchat Port Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the `/groupchat` multi-agent chat feature from the Go-based Heimdall CLI to the TypeScript OpenCode fork.

**Architecture:** Pure logic modules (mention parsing, budget tracking, catalog loading) are built test-first with zero TUI dependencies. Agent dispatch wraps `SessionProcessor.create()` following the compaction pattern. TUI integration adds a `GroupchatProvider` context, multi-select dialog, slash commands, and message rendering modifications to the existing Session route.

**Tech Stack:** TypeScript, Bun (runtime + test runner), Solid.js (TUI), bun:sqlite (hmem persistence)

**Spec:** `docs/superpowers/specs/2026-03-15-groupchat-port-design.md`

**Target codebase:** `C:\Users\benni\dev\heimdall-opencode` — all file paths below are relative to `packages/opencode/`

**Test command:** `bun test --timeout 30000` (from `packages/opencode/`)

---

## Chunk 1: Pure Logic Modules

### Task 1: Catalog Loader

**Files:**
- Create: `src/catalog/index.ts`
- Create: `test/catalog/catalog.test.ts`
- Create: `test/catalog/fixtures/catalog.json` (test fixture)

- [ ] **Step 1: Create test fixture**

```json
[
  {
    "id": "THOR",
    "name": "Thor the Coder",
    "department": "Backend",
    "persona": "You are Thor, a backend specialist.",
    "specializations": ["Go", "Rust"],
    "tier": "$$",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "tools": "coder"
  },
  {
    "id": "LOKI",
    "name": "Loki the Trickster",
    "department": "Security",
    "persona": "You are Loki, a security researcher.",
    "specializations": ["pentesting", "OWASP"],
    "tier": "$$$",
    "provider": "anthropic",
    "model": "claude-opus-4-5",
    "tools": "researcher"
  },
  {
    "id": "MIMIR",
    "name": "Mimir the Wise",
    "department": "Research",
    "persona": "You are Mimir, an analyst.",
    "specializations": ["analysis", "data"],
    "tier": "$",
    "tools": "researcher"
  },
  {
    "id": "FENRIR",
    "name": "Fenrir the Builder",
    "department": "Backend",
    "persona": "You are Fenrir, a CI/CD specialist.",
    "specializations": ["CI/CD", "Docker"],
    "tier": "$$",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "tools": "writer"
  }
]
```

- [ ] **Step 2: Write failing tests**

```typescript
// test/catalog/catalog.test.ts
import { test, expect } from "bun:test"
import { loadCatalog, groupByDepartment, type CatalogAgent } from "../../src/catalog"
import { join } from "path"

const FIXTURE = join(import.meta.dir, "fixtures", "catalog.json")

test("loadCatalog reads JSON and returns typed agents", () => {
  const agents = loadCatalog(FIXTURE)
  expect(agents).toHaveLength(4)
  expect(agents[0].id).toBe("THOR")
  expect(agents[0].department).toBe("Backend")
  expect(agents[0].tier).toBe("$$")
  expect(agents[0].provider).toBe("anthropic")
  expect(agents[0].model).toBe("claude-sonnet-4-5")
})

test("loadCatalog returns empty array for missing file", () => {
  const agents = loadCatalog("/nonexistent/catalog.json")
  expect(agents).toHaveLength(0)
})

test("groupByDepartment groups agents correctly", () => {
  const agents = loadCatalog(FIXTURE)
  const grouped = groupByDepartment(agents)
  expect(grouped.get("Backend")).toHaveLength(2)
  expect(grouped.get("Security")).toHaveLength(1)
  expect(grouped.get("Research")).toHaveLength(1)
})

test("CatalogAgent without provider/model uses defaults", () => {
  const agents = loadCatalog(FIXTURE)
  const mimir = agents.find(a => a.id === "MIMIR")!
  expect(mimir.provider).toBeUndefined()
  expect(mimir.model).toBeUndefined()
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/catalog/catalog.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement catalog loader**

```typescript
// src/catalog/index.ts
import fs from "fs"

export interface CatalogAgent {
  id: string
  name: string
  department: string
  persona: string
  specializations: string[]
  tier: "$" | "$$" | "$$$"
  provider?: string
  model?: string
  temperature?: number
  tools?: string
  role?: string
}

export function loadCatalog(catalogPath: string): CatalogAgent[] {
  try {
    const raw = fs.readFileSync(catalogPath, "utf8")
    return JSON.parse(raw) as CatalogAgent[]
  } catch {
    return []
  }
}

export function groupByDepartment(agents: CatalogAgent[]): Map<string, CatalogAgent[]> {
  const map = new Map<string, CatalogAgent[]>()
  for (const agent of agents) {
    const dept = agent.department
    if (!map.has(dept)) map.set(dept, [])
    map.get(dept)!.push(agent)
  }
  return map
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/catalog/catalog.test.ts`
Expected: 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/catalog/index.ts test/catalog/
git commit -m "feat(groupchat): add catalog loader with tests"
```

---

### Task 2: @-Mention Parser

**Files:**
- Create: `src/groupchat/mention.ts`
- Create: `test/groupchat/mention.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/groupchat/mention.test.ts
import { test, expect } from "bun:test"
import { parseMentions } from "../../src/groupchat/mention"

const PARTICIPANTS = ["THOR", "LOKI"]

test("single mention extracts agent and cleans text", () => {
  const result = parseMentions("@THOR review code", PARTICIPANTS)
  expect(result.mentioned).toEqual(["THOR"])
  expect(result.cleaned).toBe("review code")
})

test("multiple mentions extracted and cleaned", () => {
  const result = parseMentions("@THOR @LOKI review", PARTICIPANTS)
  expect(result.mentioned).toEqual(["THOR", "LOKI"])
  expect(result.cleaned).toBe("review")
})

test("@All expands to all participants", () => {
  const result = parseMentions("@All review", PARTICIPANTS)
  expect(result.mentioned).toEqual(["THOR", "LOKI"])
  expect(result.cleaned).toBe("review")
})

test("@all is case-insensitive", () => {
  const result = parseMentions("@all review", PARTICIPANTS)
  expect(result.mentioned).toEqual(["THOR", "LOKI"])
})

test("unknown mention left in cleaned text, not extracted", () => {
  const result = parseMentions("@UNKNOWN review", PARTICIPANTS)
  expect(result.mentioned).toEqual([])
  expect(result.cleaned).toBe("@UNKNOWN review")
})

test("no mentions returns empty array", () => {
  const result = parseMentions("no mention", PARTICIPANTS)
  expect(result.mentioned).toEqual([])
  expect(result.cleaned).toBe("no mention")
})

test("duplicate mentions deduplicated", () => {
  const result = parseMentions("@THOR @THOR review", PARTICIPANTS)
  expect(result.mentioned).toEqual(["THOR"])
  expect(result.cleaned).toBe("review")
})

test("multiple spaces normalized after mention removal", () => {
  const result = parseMentions("@THOR    review   code", PARTICIPANTS)
  expect(result.cleaned).toBe("review code")
})

test("mention at end of string", () => {
  const result = parseMentions("review @THOR", PARTICIPANTS)
  expect(result.mentioned).toEqual(["THOR"])
  expect(result.cleaned).toBe("review")
})

test("mixed known and unknown mentions", () => {
  const result = parseMentions("@THOR @UNKNOWN @LOKI do it", PARTICIPANTS)
  expect(result.mentioned).toEqual(["THOR", "LOKI"])
  expect(result.cleaned).toBe("@UNKNOWN do it")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/groupchat/mention.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement mention parser**

```typescript
// src/groupchat/mention.ts

export interface MentionResult {
  mentioned: string[]
  cleaned: string
}

export function parseMentions(
  text: string,
  participants: string[],
): MentionResult {
  const participantSet = new Set(participants.map(p => p.toUpperCase()))
  const mentioned = new Set<string>()

  // Find all @mentions
  const mentionRegex = /@(\w+)/g
  let cleaned = text
  const toRemove: string[] = []

  let match: RegExpExecArray | null
  while ((match = mentionRegex.exec(text)) !== null) {
    const name = match[1]
    const nameUpper = name.toUpperCase()

    if (nameUpper === "ALL") {
      // @All expands to all participants
      for (const p of participants) mentioned.add(p)
      toRemove.push(match[0])
    } else if (participantSet.has(nameUpper)) {
      // Find original-case participant name
      const original = participants.find(p => p.toUpperCase() === nameUpper)!
      mentioned.add(original)
      toRemove.push(match[0])
    }
    // Unknown mentions are left in cleaned text
  }

  // Remove known mentions from cleaned text
  for (const mention of toRemove) {
    cleaned = cleaned.replace(mention, "")
  }

  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim()

  return {
    mentioned: [...mentioned],
    cleaned,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/groupchat/mention.test.ts`
Expected: 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/groupchat/mention.ts test/groupchat/mention.test.ts
git commit -m "feat(groupchat): add @-mention parser with tests"
```

---

### Task 3: Budget Tracker

**Files:**
- Create: `src/groupchat/budget.ts`
- Create: `test/groupchat/budget.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/groupchat/budget.test.ts
import { test, expect } from "bun:test"
import { createBudget, canAfford, record, estimateCost } from "../../src/groupchat/budget"

test("createBudget initializes with limit", () => {
  const budget = createBudget(1.0)
  expect(budget.limit).toBe(1.0)
  expect(budget.spent).toBe(0)
})

test("canAfford returns true when under limit", () => {
  const budget = createBudget(1.0)
  expect(canAfford(budget, 0.05)).toBe(true)
})

test("canAfford returns false when over limit", () => {
  const budget = createBudget(0.03)
  expect(canAfford(budget, 0.05)).toBe(false)
})

test("canAfford accounts for already spent", () => {
  const budget = createBudget(0.10)
  record(budget, "THOR", 0.08)
  expect(canAfford(budget, 0.05)).toBe(false)
  expect(canAfford(budget, 0.02)).toBe(true)
})

test("record tracks per-agent actuals", () => {
  const budget = createBudget(1.0)
  record(budget, "THOR", 0.05)
  record(budget, "LOKI", 0.10)
  expect(budget.spent).toBeCloseTo(0.15)
  expect(budget.actuals["THOR"]).toBeCloseTo(0.05)
  expect(budget.actuals["LOKI"]).toBeCloseTo(0.10)
})

test("record accumulates for same agent", () => {
  const budget = createBudget(1.0)
  record(budget, "THOR", 0.05)
  record(budget, "THOR", 0.03)
  expect(budget.actuals["THOR"]).toBeCloseTo(0.08)
  expect(budget.spent).toBeCloseTo(0.08)
})

test("estimateCost returns tier defaults", () => {
  expect(estimateCost("$")).toBe(0.02)
  expect(estimateCost("$$")).toBe(0.05)
  expect(estimateCost("$$$")).toBe(0.10)
})

test("estimateCost defaults to $$ for unknown tier", () => {
  expect(estimateCost("unknown")).toBe(0.05)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/groupchat/budget.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement budget tracker**

```typescript
// src/groupchat/budget.ts

export interface TaskBudget {
  limit: number
  spent: number
  estimates: Record<string, number>
  actuals: Record<string, number>
}

const TIER_COSTS: Record<string, number> = {
  "$": 0.02,
  "$$": 0.05,
  "$$$": 0.10,
}

export function createBudget(limit: number): TaskBudget {
  return { limit, spent: 0, estimates: {}, actuals: {} }
}

export function canAfford(budget: TaskBudget, estimate: number): boolean {
  return budget.spent + estimate <= budget.limit
}

export function record(budget: TaskBudget, agent: string, cost: number): void {
  budget.actuals[agent] = (budget.actuals[agent] ?? 0) + cost
  budget.spent += cost
}

export function estimateCost(tier: string): number {
  return TIER_COSTS[tier] ?? TIER_COSTS["$$"]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/groupchat/budget.test.ts`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/groupchat/budget.ts test/groupchat/budget.test.ts
git commit -m "feat(groupchat): add budget tracker with tests"
```

---

### Task 4: Transcript Formatter (hmem)

**Files:**
- Create: `src/groupchat/transcript.ts`
- Create: `test/groupchat/transcript.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/groupchat/transcript.test.ts
import { test, expect } from "bun:test"
import { formatTranscript } from "../../src/groupchat/transcript"
import type { TranscriptEntry } from "../../src/groupchat/types"

test("formats empty transcript", () => {
  const result = formatTranscript([], [], [], 0)
  expect(result).toContain("Group chat")
  expect(result).toContain("Participants:")
})

test("formats transcript with entries", () => {
  const entries: TranscriptEntry[] = [
    { agent: "", content: "@THOR review auth", timestamp: "2026-03-15T10:00:00Z" },
    { agent: "THOR", content: "Found three issues in the auth module.", timestamp: "2026-03-15T10:00:30Z" },
  ]
  const result = formatTranscript(entries, ["THOR"], ["HEIMDALL"], 30000)
  expect(result).toContain("Participants: THOR")
  expect(result).toContain("Observers: HEIMDALL")
  expect(result).toContain("User: @THOR review auth")
  expect(result).toContain("THOR: Found three issues")
})

test("L2 line is under 120 chars", () => {
  const entries: TranscriptEntry[] = [
    { agent: "", content: "@THOR " + "x".repeat(200), timestamp: "2026-03-15T10:00:00Z" },
  ]
  const result = formatTranscript(entries, ["THOR"], [], 0)
  const firstLine = result.split("\n")[0]
  expect(firstLine.length).toBeLessThanOrEqual(120)
})

test("L3 lines are tab-indented", () => {
  const entries: TranscriptEntry[] = [
    { agent: "", content: "@THOR test", timestamp: "2026-03-15T10:00:00Z" },
  ]
  const result = formatTranscript(entries, ["THOR"], [], 5000)
  const lines = result.split("\n")
  // L3 lines (participants, observers, stats) start with tab
  const l3Lines = lines.filter(l => l.startsWith("\t") && !l.startsWith("\t\t"))
  expect(l3Lines.length).toBeGreaterThan(0)
})

test("L5 lines are double-tab-indented", () => {
  const entries: TranscriptEntry[] = [
    { agent: "", content: "@THOR test", timestamp: "2026-03-15T10:00:00Z" },
    { agent: "THOR", content: "response", timestamp: "2026-03-15T10:00:05Z" },
  ]
  const result = formatTranscript(entries, ["THOR"], [], 5000)
  const lines = result.split("\n")
  const l5Lines = lines.filter(l => l.startsWith("\t\t"))
  expect(l5Lines.length).toBe(2) // User + THOR
})

test("duration formatted as human readable", () => {
  const entries: TranscriptEntry[] = [
    { agent: "", content: "test", timestamp: "2026-03-15T10:00:00Z" },
  ]
  const result = formatTranscript(entries, ["THOR"], [], 272000) // 4m 32s
  expect(result).toContain("4m 32s")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/groupchat/transcript.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create shared types file**

```typescript
// src/groupchat/types.ts

export interface TranscriptEntry {
  agent: string       // "" for user
  content: string
  timestamp: string   // ISO 8601
}

export interface RoundResult {
  responses: Record<string, SpawnResult>
  duration: number    // ms
}

export interface SpawnResult {
  agent: string
  content: string
  tokensIn: number
  tokensOut: number
  cost: number        // USD
  duration: number    // ms
  error?: string
}
```

- [ ] **Step 4: Implement transcript formatter**

```typescript
// src/groupchat/transcript.ts
import type { TranscriptEntry } from "./types"

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min === 0) return `${sec}s`
  return `${min}m ${sec}s`
}

export function formatTranscript(
  entries: TranscriptEntry[],
  participants: string[],
  observers: string[],
  durationMs: number,
): string {
  // L2: summary title (max 120 chars)
  const firstUserMsg = entries.find(e => e.agent === "")?.content ?? "discussion"
  const topic = firstUserMsg.slice(0, 80)
  const l2 = `Group chat: ${topic}`.slice(0, 120)

  // L3: metadata
  const rounds = entries.filter(e => e.agent === "").length
  const l3Parts = [
    `\tParticipants: ${participants.join(", ")}`,
  ]
  if (observers.length > 0) {
    l3Parts.push(`\tObservers: ${observers.join(", ")}`)
  }
  l3Parts.push(`\tRounds: ${rounds}, Duration: ${formatDuration(durationMs)}`)

  // L5: raw transcript
  const l5Lines = entries.map(e => {
    const speaker = e.agent || "User"
    return `\t\t${speaker}: ${e.content}`
  })

  return [l2, ...l3Parts, ...l5Lines].join("\n")
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/groupchat/transcript.test.ts`
Expected: 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/groupchat/types.ts src/groupchat/transcript.ts test/groupchat/transcript.test.ts
git commit -m "feat(groupchat): add transcript formatter and shared types"
```

---

## Chunk 2: Agent Dispatch & Round Execution

### Task 5: Dispatch Module

**Files:**
- Create: `src/groupchat/dispatch.ts`

This module builds `Agent.Info` objects from catalog agents and resolves toolset permissions. It depends on the OpenCode agent system but can be tested in isolation for permission resolution.

- [ ] **Step 1: Create test file**

```typescript
// test/groupchat/dispatch.test.ts
import { test, expect } from "bun:test"
import { buildAgentPrompt, resolveToolset } from "../../src/groupchat/dispatch"

test("buildAgentPrompt combines persona + context", () => {
  const prompt = buildAgentPrompt(
    { persona: "You are Thor." } as any,
    "## Prior discussion\nLOKI: I disagree.",
    null,
  )
  expect(prompt).toContain("You are Thor.")
  expect(prompt).toContain("Prior discussion")
})

test("buildAgentPrompt includes contract when present", () => {
  const prompt = buildAgentPrompt(
    { persona: "You are Thor." } as any,
    "",
    "Always write tests.",
  )
  expect(prompt).toContain("Always write tests.")
})

test("buildAgentPrompt omits contract when null", () => {
  const prompt = buildAgentPrompt(
    { persona: "You are Thor." } as any,
    "context",
    null,
  )
  expect(prompt).not.toContain("null")
})

test("resolveToolset returns ruleset for coder", () => {
  const rules = resolveToolset("coder")
  expect(Array.isArray(rules)).toBe(true)
  // r.permission = tool name pattern ("*" = all tools), r.pattern = file/path pattern
  const allRule = rules.find(r => r.permission === "*")
  expect(allRule?.action).toBe("allow")
})

test("resolveToolset returns restricted ruleset for researcher", () => {
  const rules = resolveToolset("researcher")
  const denyAll = rules.find(r => r.permission === "*")
  expect(denyAll?.action).toBe("deny")
  const grep = rules.find(r => r.permission === "grep")
  expect(grep?.action).toBe("allow")
})

test("resolveToolset defaults to researcher for unknown", () => {
  const rules = resolveToolset("unknown_toolset")
  const denyAll = rules.find(r => r.permission === "*")
  expect(denyAll?.action).toBe("deny")
})

test("resolveToolset defaults to researcher for undefined", () => {
  const rules = resolveToolset(undefined)
  expect(rules).toEqual(resolveToolset("researcher"))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/groupchat/dispatch.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement dispatch module**

```typescript
// src/groupchat/dispatch.ts
import { PermissionNext } from "../permission/next"
import type { CatalogAgent } from "../catalog"

// Toolset → Config.Permission format, converted via PermissionNext.fromConfig.
// Modeled after existing agent configs in agent.ts (explore agent pattern).
const TOOLSET_CONFIGS: Record<string, Record<string, string>> = {
  coder:      { "*": "allow" },
  researcher: { grep: "allow", glob: "allow", read: "allow", webfetch: "allow", list: "allow", "*": "deny" },
  reviewer:   { grep: "allow", glob: "allow", read: "allow", list: "allow", "*": "deny" },
  writer:     { grep: "allow", glob: "allow", read: "allow", write: "allow", edit: "allow", list: "allow", "*": "deny" },
}

export function resolveToolset(toolset?: string): PermissionNext.Ruleset {
  const config = TOOLSET_CONFIGS[toolset ?? "researcher"] ?? TOOLSET_CONFIGS.researcher
  return PermissionNext.fromConfig(config)
}

export function buildAgentPrompt(
  agent: Pick<CatalogAgent, "persona">,
  contextPrefix: string,
  contract: string | null,
): string {
  return [agent.persona, contract, contextPrefix].filter(Boolean).join("\n\n")
}

export function buildAgentInfo(
  catalogAgent: CatalogAgent,
  contextPrefix: string,
  contract: string | null,
) {
  return {
    name: catalogAgent.id,
    mode: "subagent" as const,
    permission: resolveToolset(catalogAgent.tools),
    options: {},
    prompt: buildAgentPrompt(catalogAgent, contextPrefix, contract),
    model: catalogAgent.provider && catalogAgent.model
      ? { providerID: catalogAgent.provider, modelID: catalogAgent.model }
      : undefined,
    temperature: catalogAgent.temperature,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/groupchat/dispatch.test.ts`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/groupchat/dispatch.ts test/groupchat/dispatch.test.ts
git commit -m "feat(groupchat): add dispatch module with toolset resolution"
```

---

### Task 6: Round Execution & Context Injection

**Files:**
- Create: `src/groupchat/round.ts`
- Create: `test/groupchat/round.test.ts`

The round module orchestrates agent dispatch for a single user message. Full integration with `SessionProcessor` requires the running app, so we test the context prefix builder and round orchestration logic with mock dispatch.

- [ ] **Step 1: Write failing tests**

```typescript
// test/groupchat/round.test.ts
import { test, expect } from "bun:test"
import { buildContextPrefix } from "../../src/groupchat/round"
import type { RoundResult } from "../../src/groupchat/types"

test("buildContextPrefix returns empty for no rounds", () => {
  expect(buildContextPrefix([])).toBe("")
})

test("buildContextPrefix formats single round", () => {
  const rounds: RoundResult[] = [{
    responses: {
      THOR: { agent: "THOR", content: "I found a bug.", tokensIn: 100, tokensOut: 50, cost: 0.02, duration: 1000 },
    },
    duration: 1000,
  }]
  const prefix = buildContextPrefix(rounds)
  expect(prefix).toContain("## Prior discussion")
  expect(prefix).toContain("### Round 1")
  expect(prefix).toContain("THOR:")
  expect(prefix).toContain("I found a bug.")
})

test("buildContextPrefix formats multiple rounds", () => {
  const rounds: RoundResult[] = [
    {
      responses: {
        THOR: { agent: "THOR", content: "Analysis done.", tokensIn: 100, tokensOut: 50, cost: 0.02, duration: 1000 },
      },
      duration: 1000,
    },
    {
      responses: {
        LOKI: { agent: "LOKI", content: "Security check.", tokensIn: 80, tokensOut: 40, cost: 0.03, duration: 800 },
        THOR: { agent: "THOR", content: "Follow up.", tokensIn: 90, tokensOut: 45, cost: 0.02, duration: 900 },
      },
      duration: 900,
    },
  ]
  const prefix = buildContextPrefix(rounds)
  expect(prefix).toContain("### Round 1")
  expect(prefix).toContain("### Round 2")
  expect(prefix).toContain("LOKI:")
})

test("buildContextPrefix skips errored responses", () => {
  const rounds: RoundResult[] = [{
    responses: {
      THOR: { agent: "THOR", content: "", tokensIn: 0, tokensOut: 0, cost: 0, duration: 0, error: "API timeout" },
    },
    duration: 0,
  }]
  const prefix = buildContextPrefix(rounds)
  expect(prefix).not.toContain("THOR:")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/groupchat/round.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement round module**

```typescript
// src/groupchat/round.ts
import type { RoundResult, SpawnResult, TranscriptEntry } from "./types"
import type { CatalogAgent } from "../catalog"
import { parseMentions } from "./mention"
import { buildAgentInfo } from "./dispatch"
import { canAfford, estimateCost, record } from "./budget"
import type { TaskBudget } from "./budget"

export function buildContextPrefix(rounds: RoundResult[]): string {
  if (rounds.length === 0) return ""

  const parts = ["## Prior discussion\n"]
  for (let i = 0; i < rounds.length; i++) {
    parts.push(`### Round ${i + 1}`)
    for (const [agentId, result] of Object.entries(rounds[i].responses)) {
      if (result.error) continue
      parts.push(`${agentId}:\n${result.content}\n`)
    }
  }
  return parts.join("\n")
}

export interface RoundInput {
  text: string
  participants: CatalogAgent[]
  observers: string[]
  rounds: RoundResult[]
  contract: string | null
  budget: TaskBudget | null
  semaphore: number
  sessionID: string
  dispatch: (agentInfo: ReturnType<typeof buildAgentInfo>, cleanedMessage: string, sessionID: string) => Promise<SpawnResult>
}

export async function runRound(input: RoundInput): Promise<{
  result: RoundResult
  transcriptEntries: TranscriptEntry[]
}> {
  const participantIds = input.participants.map(p => p.id)
  const { mentioned, cleaned } = parseMentions(input.text, participantIds)

  // No valid mentions → not a groupchat round
  if (mentioned.length === 0) {
    return {
      result: { responses: {}, duration: 0 },
      transcriptEntries: [{ agent: "", content: input.text, timestamp: new Date().toISOString() }],
    }
  }

  const transcriptEntries: TranscriptEntry[] = [
    { agent: "", content: input.text, timestamp: new Date().toISOString() },
  ]

  const contextPrefix = buildContextPrefix(input.rounds)
  const startTime = Date.now()
  const responses: Record<string, SpawnResult> = {}

  // Dispatch agents with semaphore concurrency
  const agentsToDispatch = mentioned
    .map(id => input.participants.find(p => p.id === id))
    .filter((a): a is CatalogAgent => a !== undefined)

  // Pre-spawn budget check
  const affordable = agentsToDispatch.filter(agent => {
    if (!input.budget) return true
    const estimate = estimateCost(agent.tier)
    if (!canAfford(input.budget, estimate)) {
      responses[agent.id] = {
        agent: agent.id,
        content: "",
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        duration: 0,
        error: `Budget exhausted (need $${estimate.toFixed(2)}, remaining $${(input.budget.limit - input.budget.spent).toFixed(2)})`,
      }
      return false
    }
    return true
  })

  // Dispatch with semaphore
  const chunks: CatalogAgent[][] = []
  for (let i = 0; i < affordable.length; i += input.semaphore) {
    chunks.push(affordable.slice(i, i + input.semaphore))
  }

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (agent) => {
        const agentInfo = buildAgentInfo(agent, contextPrefix, input.contract)
        const result = await input.dispatch(agentInfo, cleaned, input.sessionID)
        return { agentId: agent.id, result }
      }),
    )

    for (const settled of results) {
      if (settled.status === "fulfilled") {
        const { agentId, result } = settled.value
        responses[agentId] = result
        if (input.budget && result.cost > 0) {
          record(input.budget, agentId, result.cost)
        }
        transcriptEntries.push({
          agent: agentId,
          content: result.error ?? result.content,
          timestamp: new Date().toISOString(),
        })
      } else {
        // Promise rejected — should not happen with proper dispatch error handling
      }
    }
  }

  return {
    result: { responses, duration: Date.now() - startTime },
    transcriptEntries,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/groupchat/round.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/groupchat/round.ts test/groupchat/round.test.ts
git commit -m "feat(groupchat): add round execution and context injection"
```

---

### Task 7: Groupchat Public API (index.ts)

**Files:**
- Create: `src/groupchat/index.ts`

This re-exports everything and provides the top-level API used by the TUI layer.

- [ ] **Step 1: Implement index module**

```typescript
// src/groupchat/index.ts
export { parseMentions, type MentionResult } from "./mention"
export { createBudget, canAfford, record, estimateCost, type TaskBudget } from "./budget"
export { buildAgentInfo, buildAgentPrompt, resolveToolset } from "./dispatch"
export { buildContextPrefix, runRound, type RoundInput } from "./round"
export { formatTranscript } from "./transcript"
export type { TranscriptEntry, RoundResult, SpawnResult } from "./types"
```

- [ ] **Step 2: Run all groupchat tests to verify nothing broke**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/groupchat/ test/catalog/`
Expected: All tests PASS (25 tests across 5 files)

- [ ] **Step 3: Commit**

```bash
git add src/groupchat/index.ts
git commit -m "feat(groupchat): add public API index module"
```

---

## Chunk 3: TUI — Context Provider & Dialog

### Task 8: GroupchatProvider Context

**Files:**
- Create: `src/cli/cmd/tui/context/groupchat.tsx`

Follows the `createSimpleContext` pattern from `context/helper.tsx`. Manages groupchat state in the Session scope.

- [ ] **Step 1: Read context/helper.tsx and context/local.tsx for exact patterns**

Read: `packages/opencode/src/cli/cmd/tui/context/helper.tsx`
Read: `packages/opencode/src/cli/cmd/tui/context/local.tsx` (lines 46-93 for color assignment)

- [ ] **Step 2: Implement GroupchatProvider**

```tsx
// src/cli/cmd/tui/context/groupchat.tsx
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { CatalogAgent } from "@/catalog"
import type { TranscriptEntry, RoundResult } from "@/groupchat/types"
import type { TaskBudget } from "@/groupchat/budget"

interface GroupchatState {
  active: boolean
  participants: CatalogAgent[]
  observers: string[]
  transcript: TranscriptEntry[]
  contract: string | null
  budget: TaskBudget | null
  rounds: RoundResult[]
  semaphore: number
  participantColors: Record<string, string>
}

// Theme palette colors for agent assignment
const AGENT_COLORS = [
  "#e06c75", "#98c379", "#e5c07b", "#61afef",
  "#c678dd", "#56b6c2", "#d19a66", "#be5046",
]

function assignColor(existing: Record<string, string>): string {
  const usedCount = Object.keys(existing).length
  return AGENT_COLORS[usedCount % AGENT_COLORS.length]
}

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
        get budget() { return store.budget },
        get semaphore() { return store.semaphore },
        get participantColors() { return store.participantColors },
        get contract() { return store.contract },

        start(participants: CatalogAgent[], observers: string[]) {
          const colors: Record<string, string> = {}
          for (const p of participants) {
            colors[p.id] = assignColor(colors)
          }
          for (const o of observers) {
            colors[o] = assignColor(colors)
          }
          setStore({
            active: true,
            participants,
            observers,
            transcript: [],
            rounds: [],
            participantColors: colors,
          })
        },

        addParticipant(agent: CatalogAgent) {
          setStore(produce((s) => {
            s.participants.push(agent)
            s.participantColors[agent.id] = assignColor(s.participantColors)
          }))
        },

        addTranscript(entry: TranscriptEntry) {
          setStore(produce((s) => {
            s.transcript.push(entry)
          }))
        },

        addRound(result: RoundResult) {
          setStore(produce((s) => {
            s.rounds.push(result)
          }))
        },

        end() {
          setStore({
            active: false,
            participants: [],
            observers: [],
            transcript: [],
            contract: null,
            budget: null,
            rounds: [],
            participantColors: {},
          })
        },
      }
    },
  })
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/cmd/tui/context/groupchat.tsx
git commit -m "feat(groupchat): add GroupchatProvider Solid.js context"
```

---

### Task 9: Agent Picker Dialog

**Files:**
- Create: `src/cli/cmd/tui/component/dialog-groupchat.tsx`

Multi-select dialog grouped by department. Uses `fuzzysort` for filtering. Pattern: new component inspired by `dialog-agent.tsx` but with multi-select behavior.

- [ ] **Step 1: Read dialog-agent.tsx and DialogSelect for reference**

Read: `packages/opencode/src/cli/cmd/tui/component/dialog-agent.tsx`
Read: Search for `DialogSelect` component definition in the codebase

- [ ] **Step 2: Implement agent picker dialog**

```tsx
// src/cli/cmd/tui/component/dialog-groupchat.tsx
import { createSignal, createMemo, For, Show } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { groupByDepartment, type CatalogAgent } from "@/catalog"
import fuzzysort from "fuzzysort"

interface AgentPickerProps {
  agents: CatalogAgent[]
  onConfirm: (selected: CatalogAgent[], observers: string[]) => void
}

export function DialogGroupchat(props: AgentPickerProps) {
  const dialog = useDialog()
  const [filter, setFilter] = createSignal("")
  const [selected, setSelected] = createSignal(new Set<string>())
  const [observers, setObservers] = createSignal(new Set<string>(["HEIMDALL"]))
  const [cursor, setCursor] = createSignal(0)

  const filteredAgents = createMemo(() => {
    const f = filter()
    if (!f) return props.agents
    return fuzzysort.go(f, props.agents, { key: "name" }).map(r => r.obj)
  })

  const departments = createMemo(() => groupByDepartment(filteredAgents()))

  function toggleAgent(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleObserver(id: string) {
    setObservers(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function confirm() {
    const sel = selected()
    if (sel.size < 2) return // minimum 2 participants
    const selectedAgents = props.agents.filter(a => sel.has(a.id))
    const obs = [...observers()].filter(id => !sel.has(id))
    props.onConfirm(selectedAgents, obs)
    dialog.clear()
  }

  function cancel() {
    dialog.clear()
  }

  // Rendering: Follow the existing dialog patterns in the codebase.
  // The TUI uses @opentui/core and @opentui/solid — NOT Ink.
  // Read dialog-agent.tsx and the DialogSelect component for the exact
  // rendering primitives (BoxRenderable, TextAttributes, etc.).
  //
  // Key handler: Space = toggle, Enter = confirm, Esc = cancel
  // Follow the key handling pattern used in existing dialog components.
  //
  // The logic above (state management, filtering, confirmation) is the
  // important part. The exact JSX must match the @opentui component API.

  return null // Placeholder — implement rendering using @opentui primitives
}
```

> **Important:** The codebase uses `@opentui/core` and `@opentui/solid` for rendering — NOT Ink. The implementer must read existing dialog components (`dialog-agent.tsx`, `DialogSelect`) to determine the correct rendering primitives. The state management and logic above is complete; only the JSX rendering needs to be adapted to the actual TUI framework.

- [ ] **Step 3: Commit**

```bash
git add src/cli/cmd/tui/component/dialog-groupchat.tsx
git commit -m "feat(groupchat): add agent picker multi-select dialog"
```

---

## Chunk 4: TUI Integration — Session Route

### Task 10: Register Slash Commands

**Files:**
- Modify: `src/cli/cmd/tui/routes/session/index.tsx`

Add `/groupchat`, `/endchat`, and `/invite` commands to the existing `command.register()` block.

- [ ] **Step 1: Read current command registration in session/index.tsx**

Read: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` (lines 358-567 for command.register block)

- [ ] **Step 2: Add GroupchatProvider wrapper**

Wrap the session content with `<GroupchatProvider>` at the component's top level. Import it:

```typescript
import { GroupchatProvider, useGroupchat } from "@tui/context/groupchat"
```

Find the session component's return JSX and wrap the outermost element with `<GroupchatProvider>...</GroupchatProvider>`.

- [ ] **Step 3: Add groupchat imports and helper functions**

At the top of the Session component (after the existing context hooks), add:

```typescript
const gc = useGroupchat()
```

Add helper functions before the command.register() call:

```typescript
function openAgentPicker(dialog: DialogContext) {
  if (gc.active) return // Prevent starting a second groupchat
  const agents = loadCatalog(catalogPath) // resolve from config
  dialog.replace(() => (
    <DialogGroupchat
      agents={agents}
      onConfirm={(selected, observers) => {
        gc.start(selected, observers)
      }}
    />
  ))
}

function openInviteDialog(dialog: DialogContext) {
  const agents = loadCatalog(catalogPath)
    .filter(a => !gc.participants.some(p => p.id === a.id))
  dialog.replace(() => (
    <DialogGroupchat
      agents={agents}
      onConfirm={(selected) => {
        for (const agent of selected) {
          gc.addParticipant(agent)
        }
      }}
    />
  ))
}

async function endGroupChat() {
  // Save transcript to each agent's hmem
  const { formatTranscript } = await import("@/groupchat/transcript")
  const { Hmem } = await import("@/hmem")
  const { write } = await import("@/hmem/write")

  const participantIds = gc.participants.map(p => p.id)
  const totalDuration = gc.rounds.reduce((sum, r) => sum + r.duration, 0)
  const formatted = formatTranscript(gc.transcript, participantIds, gc.observers, totalDuration)

  for (const id of [...participantIds, ...gc.observers]) {
    try {
      const store = await Hmem.openAgentStore(id)
      write(store, "P", formatted, { tags: ["groupchat"] })
    } catch (err) {
      console.error(`[groupchat] Failed to save hmem for ${id}:`, err)
    }
  }

  gc.end()
}
```

- [ ] **Step 4: Add commands to command.register()**

Add these entries inside the existing `command.register(() => [...])` array:

```typescript
{
  value: "groupchat",
  title: "Start Group Chat",
  category: "Session",
  slash: { name: "groupchat" },
  onSelect: (dialog) => openAgentPicker(dialog),
},
...(gc.active ? [
  {
    value: "endchat",
    title: "End Group Chat",
    category: "Session",
    slash: { name: "endchat" },
    onSelect: () => endGroupChat(),
  },
  {
    value: "invite",
    title: "Invite Agent to Group Chat",
    category: "Session",
    slash: { name: "invite" },
    onSelect: (dialog) => openInviteDialog(dialog),
  },
] : []),
```

- [ ] **Step 5: Commit**

```bash
git add src/cli/cmd/tui/routes/session/index.tsx
git commit -m "feat(groupchat): register slash commands in session route"
```

---

### Task 11: Message Rendering with Agent Headers

**Files:**
- Modify: `src/cli/cmd/tui/routes/session/index.tsx`

Add colored agent name header above groupchat agent messages.

- [ ] **Step 1: Find AssistantMessage component**

Read: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` (lines 1327-1420 for AssistantMessage)

- [ ] **Step 2: Add agent header rendering**

Inside `AssistantMessage`, before the parts rendering loop, add:

```tsx
<Show when={gc.active && props.message.agent}>
  <Text bold color={gc.participantColors[props.message.agent] ?? undefined}>
    {props.message.agent.toUpperCase()}
  </Text>
</Show>
```

The `gc` reference must be obtained via `useGroupchat()` at the component's top level (Solid.js rule — context hooks at setup phase only).

- [ ] **Step 3: Commit**

```bash
git add src/cli/cmd/tui/routes/session/index.tsx
git commit -m "feat(groupchat): add colored agent headers to messages"
```

---

### Task 12: Footer Status

**Files:**
- Modify: `src/cli/cmd/tui/routes/session/footer.tsx`

Show groupchat participant info when active.

- [ ] **Step 1: Read current footer**

Read: `packages/opencode/src/cli/cmd/tui/routes/session/footer.tsx`

- [ ] **Step 2: Add groupchat status to footer**

Import `useGroupchat` and add a status indicator:

```tsx
import { useGroupchat } from "@tui/context/groupchat"

// Inside the footer component:
const gc = useGroupchat()

// Add to the left or right side of the footer layout:
<Show when={gc.active}>
  <Text color="cyan">
    Group Chat: {gc.participants.map(p => p.id).join(", ")}
    {gc.observers.length > 0 ? ` (+${gc.observers.length} observer${gc.observers.length > 1 ? "s" : ""})` : ""}
    {gc.budget ? ` | Budget: $${gc.budget.spent.toFixed(2)}/$${gc.budget.limit.toFixed(2)}` : ""}
  </Text>
</Show>
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/cmd/tui/routes/session/footer.tsx
git commit -m "feat(groupchat): add groupchat status to footer"
```

---

### Task 13: Autocomplete Extension

**Files:**
- Modify: `src/cli/cmd/tui/component/prompt/autocomplete.tsx`

Filter agent autocomplete to show only groupchat participants + @All when active.

- [ ] **Step 1: Read current autocomplete agents section**

Read: `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx` (lines 334-354)

- [ ] **Step 2: Modify agents memo**

Import `useGroupchat` at the top of the file. Call `useGroupchat()` at the component's top level. Modify the `agents` memo:

```typescript
import { useGroupchat } from "@tui/context/groupchat"

// Inside the autocomplete component, at setup level:
const gc = useGroupchat()

// Replace or wrap the existing agents memo:
const agents = createMemo(() => {
  if (gc.active) {
    return [
      {
        display: "@All",
        onSelect: () => {
          insertPart("All", {
            type: "agent",
            name: "All",
            source: { start: 0, end: 0, value: "" },
          })
        },
      },
      ...gc.participants.map(
        (agent): AutocompleteOption => ({
          display: "@" + agent.id,
          onSelect: () => {
            insertPart(agent.id, {
              type: "agent",
              name: agent.id,
              source: { start: 0, end: 0, value: "" },
            })
          },
        }),
      ),
    ]
  }
  // Existing behavior
  const agents = sync.data.agent
  return agents
    .filter((agent) => !agent.hidden && agent.mode !== "primary")
    .map(
      (agent): AutocompleteOption => ({
        display: "@" + agent.name,
        onSelect: () => {
          insertPart(agent.name, {
            type: "agent",
            name: agent.name,
            source: { start: 0, end: 0, value: "" },
          })
        },
      }),
    )
})
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/cmd/tui/component/prompt/autocomplete.tsx
git commit -m "feat(groupchat): filter autocomplete to groupchat participants"
```

---

## Chunk 5: Integration & Message Dispatch

### Task 14: Wire Up Message Dispatch in Session

**Files:**
- Modify: `src/cli/cmd/tui/routes/session/index.tsx`

Intercept user message submission when groupchat is active. Instead of the normal prompt flow, run a groupchat round.

- [ ] **Step 1: Find the message submission handler**

Read: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — search for the prompt submission handler (likely around `onSubmit` or `sdk.client.session.prompt`)

- [ ] **Step 2: Add groupchat dispatch intercept**

Before the normal prompt submission, check if groupchat is active and the message has mentions:

```typescript
import { parseMentions, runRound, type RoundInput } from "@/groupchat"
import { Session, MessageID } from "@/session"
import { SessionProcessor } from "@/session/processor"
import { Provider } from "@/provider"
import { MessageV2 } from "@/session/message-v2"
import { Instance } from "@/instance"

// In the submission handler:
if (gc.active) {
  const participantIds = gc.participants.map(p => p.id)
  const { mentioned } = parseMentions(messageText, participantIds)

  if (mentioned.length > 0) {
    // Run groupchat round instead of normal prompt
    const roundInput: RoundInput = {
      text: messageText,
      participants: gc.participants,
      observers: gc.observers,
      rounds: gc.rounds,
      contract: gc.contract,
      budget: gc.budget,
      semaphore: gc.semaphore,
      sessionID: sessionID(),
      dispatch: async (agentInfo, cleanedMessage, sid) => {
        const startTime = Date.now()
        try {
          // Resolve model (agent-specific or session default)
          const model = agentInfo.model
            ? await Provider.getModel(agentInfo.model.providerID, agentInfo.model.modelID)
            : await Provider.getModel(currentModel.providerID, currentModel.modelID)

          // Step 1: Create assistant message (pattern from compaction.ts:185-210)
          const msg = (await Session.updateMessage({
            id: MessageID.ascending(),
            role: "assistant",
            parentID: parentMessageID,
            sessionID: sid,
            mode: "groupchat",
            agent: agentInfo.name,
            path: { cwd: Instance.directory, root: Instance.worktree },
            cost: 0,
            tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
          })) as MessageV2.Assistant

          // Step 2: Create processor (compaction.ts:211-216)
          const processor = SessionProcessor.create({
            assistantMessage: msg,
            sessionID: sid,
            model,
            abort: new AbortController().signal,
          })

          // Step 3: Process with agent prompt as system + cleaned message as user
          // (compaction.ts:259-279)
          await processor.process({
            user: userMessage,       // current user message from session
            agent: agentInfo,        // Agent.Info built by buildAgentInfo
            abort: new AbortController().signal,
            sessionID: sid,
            tools: [],               // tools resolved from agentInfo.permission
            system: [agentInfo.prompt ?? ""],
            messages: [{
              role: "user",
              content: [{ type: "text", text: cleanedMessage }],
            }],
            model,
          })

          // Extract results from processor.message after completion
          return {
            agent: agentInfo.name,
            content: processor.message.parts
              ?.filter(p => p.type === "text")
              .map(p => p.text)
              .join("") ?? "",
            tokensIn: processor.message.tokens?.input ?? 0,
            tokensOut: processor.message.tokens?.output ?? 0,
            cost: processor.message.cost ?? 0,
            duration: Date.now() - startTime,
          }
        } catch (err: any) {
          return {
            agent: agentInfo.name,
            content: "",
            tokensIn: 0, tokensOut: 0, cost: 0,
            duration: Date.now() - startTime,
            error: err.message ?? "Unknown error",
          }
        }
      },
    }

    const { result, transcriptEntries } = await runRound(roundInput)
    for (const entry of transcriptEntries) {
      gc.addTranscript(entry)
    }
    gc.addRound(result)
    return // Don't fall through to normal prompt
  }
  // No mentions → fall through to normal prompt handling
}
```

> **Implementation note:** The dispatch callback above follows the 3-step pattern from `compaction.ts:185-279`. Key variables like `parentMessageID`, `currentModel`, and `userMessage` must be resolved from the session context — read the existing prompt submission handler to find where these values come from. The tool resolution (`tools: []` above) should be expanded using the agent's permission ruleset — reference `prompt.ts` for how tools are resolved from agent permissions.

- [ ] **Step 3: Commit**

```bash
git add src/cli/cmd/tui/routes/session/index.tsx
git commit -m "feat(groupchat): wire up message dispatch for groupchat rounds"
```

---

### Task 15: Integration Test

**Files:**
- Create: `test/groupchat/integration.test.ts`

Test the full round flow with a mock dispatch function to verify mention parsing → budget check → context injection → transcript recording all work together.

- [ ] **Step 1: Write integration test**

```typescript
// test/groupchat/integration.test.ts
import { test, expect } from "bun:test"
import { runRound, type RoundInput, createBudget, type SpawnResult } from "../../src/groupchat"
import type { CatalogAgent } from "../../src/catalog"

const THOR: CatalogAgent = {
  id: "THOR", name: "Thor", department: "Backend",
  persona: "You are Thor.", specializations: ["Go"],
  tier: "$$", provider: "anthropic", model: "claude-sonnet-4-5", tools: "coder",
}

const LOKI: CatalogAgent = {
  id: "LOKI", name: "Loki", department: "Security",
  persona: "You are Loki.", specializations: ["pentesting"],
  tier: "$$$", provider: "anthropic", model: "claude-opus-4-5", tools: "researcher",
}

function mockDispatch(responses: Record<string, string>) {
  return async (agentInfo: any, cleanedMessage: string): Promise<SpawnResult> => {
    const content = responses[agentInfo.name] ?? "default response"
    return {
      agent: agentInfo.name,
      content,
      tokensIn: 100,
      tokensOut: 50,
      cost: 0.05,
      duration: 1000,
    }
  }
}

test("full round: parse mentions, dispatch, record transcript", async () => {
  const input: RoundInput = {
    text: "@THOR @LOKI review the auth module",
    participants: [THOR, LOKI],
    observers: [],
    rounds: [],
    contract: null,
    budget: null,
    semaphore: 3,
    sessionID: "test-session",
    dispatch: mockDispatch({
      THOR: "I found three issues.",
      LOKI: "Token rotation is vulnerable.",
    }),
  }

  const { result, transcriptEntries } = await runRound(input)

  expect(Object.keys(result.responses)).toHaveLength(2)
  expect(result.responses["THOR"].content).toBe("I found three issues.")
  expect(result.responses["LOKI"].content).toBe("Token rotation is vulnerable.")
  expect(transcriptEntries).toHaveLength(3) // user + 2 agents
  expect(transcriptEntries[0].agent).toBe("")
  expect(transcriptEntries[0].content).toContain("@THOR")
})

test("budget enforcement skips over-budget agents", async () => {
  const budget = createBudget(0.06) // only enough for one agent

  const input: RoundInput = {
    text: "@All review",
    participants: [THOR, LOKI],
    observers: [],
    rounds: [],
    contract: null,
    budget,
    semaphore: 3,
    sessionID: "test-session",
    dispatch: mockDispatch({ THOR: "ok", LOKI: "ok" }),
  }

  const { result } = await runRound(input)

  // THOR ($$ = $0.05) should proceed, LOKI ($$$ = $0.10) should be skipped
  expect(result.responses["THOR"].content).toBe("ok")
  expect(result.responses["LOKI"].error).toContain("Budget exhausted")
})

test("no mentions returns empty round", async () => {
  const input: RoundInput = {
    text: "just talking",
    participants: [THOR],
    observers: [],
    rounds: [],
    contract: null,
    budget: null,
    semaphore: 3,
    sessionID: "test-session",
    dispatch: mockDispatch({}),
  }

  const { result } = await runRound(input)
  expect(Object.keys(result.responses)).toHaveLength(0)
})

test("context injection includes prior rounds", async () => {
  let capturedPrompt = ""

  const input: RoundInput = {
    text: "@THOR follow up",
    participants: [THOR],
    observers: [],
    rounds: [{
      responses: {
        THOR: { agent: "THOR", content: "Initial analysis.", tokensIn: 100, tokensOut: 50, cost: 0.05, duration: 1000 },
      },
      duration: 1000,
    }],
    contract: null,
    budget: null,
    semaphore: 3,
    sessionID: "test-session",
    dispatch: async (agentInfo, msg) => {
      capturedPrompt = agentInfo.prompt ?? ""
      return { agent: agentInfo.name, content: "follow up", tokensIn: 50, tokensOut: 30, cost: 0.03, duration: 500 }
    },
  }

  await runRound(input)
  expect(capturedPrompt).toContain("Prior discussion")
  expect(capturedPrompt).toContain("Initial analysis.")
})
```

- [ ] **Step 2: Run integration tests**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/groupchat/integration.test.ts`
Expected: 4 tests PASS

- [ ] **Step 3: Run all tests**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/groupchat/ test/catalog/`
Expected: All tests PASS (29+ tests)

- [ ] **Step 4: Commit**

```bash
git add test/groupchat/integration.test.ts
git commit -m "test(groupchat): add integration tests for full round flow"
```

---

### Task 16: Catalog Path Resolution

**Files:**
- Modify: `src/catalog/index.ts`

Add a function to find the catalog.json file from project or config directories.

- [ ] **Step 1: Add findCatalog function**

```typescript
// Add to src/catalog/index.ts
import path from "path"

export function findCatalog(projectRoot: string): string | null {
  const candidates = [
    path.join(projectRoot, ".heimdall", "catalog.json"),
    path.join(projectRoot, "configs", "catalog.json"),
  ]
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate)
      return candidate
    } catch {
      continue
    }
  }
  return null
}
```

- [ ] **Step 2: Add tests for findCatalog**

```typescript
// Add to test/catalog/catalog.test.ts
import { findCatalog } from "../../src/catalog"
import { mkdtempSync, mkdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"

test("findCatalog returns .heimdall/catalog.json if it exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-test-"))
  const heimdallDir = join(dir, ".heimdall")
  mkdirSync(heimdallDir)
  writeFileSync(join(heimdallDir, "catalog.json"), "[]")
  expect(findCatalog(dir)).toBe(join(heimdallDir, "catalog.json"))
})

test("findCatalog falls back to configs/catalog.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-test-"))
  const configsDir = join(dir, "configs")
  mkdirSync(configsDir)
  writeFileSync(join(configsDir, "catalog.json"), "[]")
  expect(findCatalog(dir)).toBe(join(configsDir, "catalog.json"))
})

test("findCatalog returns null if neither exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-test-"))
  expect(findCatalog(dir)).toBeNull()
})
```

- [ ] **Step 3: Run tests**

Run: `cd /c/Users/benni/dev/heimdall-opencode/packages/opencode && bun test test/catalog/catalog.test.ts`
Expected: All tests PASS (7 tests)

- [ ] **Step 4: Commit**

```bash
git add src/catalog/index.ts test/catalog/catalog.test.ts
git commit -m "feat(catalog): add findCatalog path resolution with tests"
```
