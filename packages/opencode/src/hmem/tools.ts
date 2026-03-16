import z from "zod"
import { Tool } from "../tool/tool"
import { Hmem } from "./index"
import { render } from "./render"
import { Instance } from "../project/instance"

export const VALID_PREFIXES = ["P", "L", "T", "E", "D", "M", "S", "N", "H", "R", "F", "O"] as const

// ── hmem_search ───────────────────────────────────────────────────────────────

export const HmemSearchTool = Tool.define("hmem_search", {
  description: "Search Heimdall memory by keyword. Returns matching entries with their full content tree.",
  parameters: z.object({
    query: z.string().describe("Search query (FTS5 syntax supported)"),
    limit: z.number().int().min(1).max(100).optional().describe("Maximum number of results (default: 20)"),
  }),
  async execute(params, ctx) {
    const store = await Hmem.openStore(ctx.agent, Instance.directory)
    const entries = store.read({ search: params.query, limit: params.limit ?? 20 })
    store.assignBulkTags(entries)
    const output = entries.length === 0 ? "No results found." : render(entries)
    return {
      title: `search: ${params.query}`,
      metadata: { count: entries.length },
      output,
    }
  },
})

// ── hmem_read ─────────────────────────────────────────────────────────────────

export const HmemReadTool = Tool.define("hmem_read", {
  description:
    "Read memory entries. Pass an ID to read a specific entry, a prefix letter to list entries by prefix, or omit both to read the most recent entries.",
  parameters: z.object({
    id: z.string().optional().describe("Specific entry ID (e.g. L0001) or node ID (e.g. L0001.2.1)"),
    prefix: z.string().optional().describe("Filter by prefix letter (P, L, T, E, D, M, S, N, H, R, or F)"),
    limit: z.number().int().min(1).max(200).optional().describe("Maximum number of entries (default: 50)"),
  }),
  async execute(params, ctx) {
    const store = await Hmem.openStore(ctx.agent, Instance.directory)
    const entries = store.read({
      id: params.id,
      prefix: params.prefix,
      limit: params.limit ?? 50,
    })
    store.assignBulkTags(entries)
    const output = entries.length === 0 ? "No entries found." : render(entries)
    return {
      title: params.id ?? `read prefix=${params.prefix ?? "all"}`,
      metadata: { count: entries.length },
      output,
    }
  },
})

// ── hmem_write ────────────────────────────────────────────────────────────────

export const HmemWriteTool = Tool.define("hmem_write", {
  description: `Write a new top-level memory entry. The content uses a hierarchical format:
- L1 (root): single line, max 120 chars
- L2 (children): lines starting with one tab, max 300 chars each
- L3 (grandchildren): two tabs, max 800 chars each
- L4: three tabs, max 2000 chars each

Valid prefix letters: P (project), L (learning), T (task), E (event), D (decision), M (meeting), S (status), N (note), H (how-to), R (reference), F (fact)`,
  parameters: z.object({
    prefix: z
      .enum(VALID_PREFIXES)
      .describe("Prefix letter (P/L/T/E/D/M/S/N/H/R/F)"),
    content: z.string().describe("Memory content in hierarchical tab-indented format"),
    tags: z.array(z.string()).optional().describe("Tags to attach (e.g. ['#typescript', '#api'])"),
    favorite: z.boolean().optional().describe("Mark as favorite"),
    pinned: z.boolean().optional().describe("Pin this entry"),
  }),
  async execute(params, ctx) {
    const store = await Hmem.openStore(ctx.agent, Instance.directory)
    const result = store.write(params.prefix, params.content, undefined, undefined, params.favorite, params.tags, params.pinned)
    return {
      title: `wrote ${result.id}`,
      metadata: { id: result.id, timestamp: result.timestamp },
      output: `Written as ${result.id} at ${result.timestamp}`,
    }
  },
})

// ── hmem_append ───────────────────────────────────────────────────────────────

export const HmemAppendTool = Tool.define("hmem_append", {
  description: "Append child nodes to an existing memory entry or node.",
  parameters: z.object({
    parent_id: z
      .string()
      .describe("ID of the parent entry or node to append to (e.g. L0001 or L0001.2)"),
    content: z.string().describe("Tab-indented child content to append"),
  }),
  async execute(params, ctx) {
    const store = await Hmem.openStore(ctx.agent, Instance.directory)
    const result = store.appendChildren(params.parent_id, params.content)
    return {
      title: `appended to ${params.parent_id}`,
      metadata: { count: result.count, ids: result.ids },
      output: `Appended ${result.count} node(s): ${result.ids.join(", ")}`,
    }
  },
})

// ── hmem_list ─────────────────────────────────────────────────────────────────

export const HmemListTool = Tool.define("hmem_list", {
  description: "List memory entry titles (L1 headers only) without loading full content trees. Fast overview.",
  parameters: z.object({
    prefix: z.string().optional().describe("Filter by prefix letter"),
    limit: z.number().int().min(1).max(500).optional().describe("Maximum entries to return (default: 100)"),
  }),
  async execute(params, ctx) {
    const store = await Hmem.openStore(ctx.agent, Instance.directory)
    const entries = store.read({ titlesOnly: true, prefix: params.prefix }).slice(0, params.limit ?? 100)
    if (entries.length === 0) {
      return { title: "list", metadata: { count: 0 }, output: "No entries found." }
    }
    const lines = entries.map((e) => `[${e.id}] ${e.level_1}`).join("\n")
    return {
      title: `list (${entries.length})`,
      metadata: { count: entries.length },
      output: lines,
    }
  },
})

// ── hmem_tag ──────────────────────────────────────────────────────────────────

export const HmemTagTool = Tool.define("hmem_tag", {
  description: "Set tags on a memory entry or node. Replaces all existing tags.",
  parameters: z.object({
    id: z.string().describe("Entry or node ID to tag"),
    tags: z.array(z.string()).describe("Array of tag strings (e.g. ['#typescript', '#api'])"),
  }),
  async execute(params, ctx) {
    const store = await Hmem.openStore(ctx.agent, Instance.directory)
    const existing = store.read({ id: params.id })
    const content = existing.length > 0 ? existing[0].level_1 : ""
    store.updateNode(params.id, content, undefined, undefined, undefined, undefined, undefined, params.tags)
    return {
      title: `tag ${params.id}`,
      metadata: { id: params.id, tags: params.tags },
      output: `Tags updated on ${params.id}: ${params.tags.join(", ") || "(none)"}`,
    }
  },
})

// ── hmem_stats ────────────────────────────────────────────────────────────────

export const HmemStatsTool = Tool.define("hmem_stats", {
  description: "Show memory store statistics: entry counts by prefix and total character usage.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const store = await Hmem.openStore(ctx.agent, Instance.directory)
    const result = store.getStats()
    const lines = [
      `Total entries: ${result.total}`,
      `Total chars: ${result.totalChars}`,
      "By prefix:",
      ...Object.entries(result.byPrefix).map(([k, v]) => `  ${k}: ${v}`),
    ]
    return {
      title: "stats",
      metadata: result,
      output: lines.join("\n"),
    }
  },
})

// ── hmem_health ───────────────────────────────────────────────────────────────

export const HmemHealthTool = Tool.define("hmem_health", {
  description: "Run a health check on the memory store. Detects broken links, orphaned nodes, and tag issues.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const store = await Hmem.openStore(ctx.agent, Instance.directory)
    const result = store.healthCheck()
    const lines = [
      `Broken links: ${result.brokenLinks.length}`,
      ...result.brokenLinks.map((l) => `  ${l}`),
      `Orphaned entries: ${result.orphanedEntries.length}`,
      ...result.orphanedEntries.map((e) => `  ${e}`),
      `Stale favorites: ${result.staleFavorites.length}`,
      `Tag orphans: ${result.tagOrphans}`,
    ]
    const healthy =
      result.brokenLinks.length === 0 &&
      result.orphanedEntries.length === 0 &&
      result.tagOrphans === 0
    return {
      title: healthy ? "health: ok" : "health: issues found",
      metadata: result,
      output: lines.join("\n"),
    }
  },
})

// ── hmem_read_agent ───────────────────────────────────────────────────────────

export const HmemReadAgentTool = Tool.define("hmem_read_agent", {
  description: "Read memory from a specific agent's store by agent name (e.g. 'build', 'general', 'explore').",
  parameters: z.object({
    agent_name: z.string().describe("Name of the agent whose store to read"),
    limit: z.number().int().min(1).max(200).optional().describe("Maximum number of entries (default: 50)"),
  }),
  async execute(params, _ctx) {
    const store = await Hmem.openAgentStore(params.agent_name)
    const entries = store.read({ limit: params.limit ?? 50 })
    store.assignBulkTags(entries)
    const output = entries.length === 0 ? "No entries found." : render(entries)
    return {
      title: `read agent=${params.agent_name}`,
      metadata: { count: entries.length, agent: params.agent_name },
      output,
    }
  },
})

// ── exported array ────────────────────────────────────────────────────────────

export const HmemTools: Tool.Info[] = [
  HmemSearchTool,
  HmemReadTool,
  HmemWriteTool,
  HmemAppendTool,
  HmemListTool,
  HmemTagTool,
  HmemStatsTool,
  HmemHealthTool,
  HmemReadAgentTool,
]
