import { tool } from "@opencode-ai/plugin"
import type { Store } from "./store.js"
import { read, readL1Headers } from "./read.js"
import { write } from "./write.js"
import { bulkReadV2 } from "./bulk-read.js"
import { update, append } from "./modify.js"
import { deleteEntry } from "./delete.js"
import { setTags, fetchTags } from "./tags.js"
import { findRelated } from "./related.js"
import { stats, healthCheck } from "./stats.js"
import { render } from "./render.js"

export function createHmemTools(store: Store) {
  return {
    hmem_search: tool({
      description: "Search hierarchical long-term memory (hmem). Returns matching entries by keyword.",
      args: {
        query: tool.schema.string().describe("Search query (keywords or FTS syntax)"),
        limit: tool.schema.number().optional().describe("Max results (default 20)"),
      },
      async execute(args) {
        const entries = read(store, { search: args.query, limit: args.limit ?? 20 })
        if (entries.length === 0) return "No matching memories found."
        return render(entries)
      },
    }),

    hmem_read: tool({
      description: "Read a specific memory entry by ID (e.g., P0042, L0001.2)",
      args: {
        id: tool.schema.string().describe("Memory ID like P0042 or node ID like L0001.2"),
      },
      async execute(args) {
        const entries = read(store, { id: args.id })
        if (entries.length === 0) return `Memory ${args.id} not found.`
        return render(entries)
      },
    }),

    hmem_write: tool({
      description: "Write a new memory entry. Uses tab-indented hierarchical format.",
      args: {
        prefix: tool.schema.string().describe("Category prefix: P(project), L(learning), T(task), E(event), D(decision), M(meeting), S(snippet), N(note), H(human), R(reference), F(feedback)"),
        content: tool.schema.string().describe("Tab-indented hierarchical content. L1=title, \\tL2=details, \\t\\tL3=deep details"),
        tags: tool.schema.array(tool.schema.string()).optional().describe("Tags like #typescript, #project-x"),
      },
      async execute(args) {
        const result = write(store, args.prefix, args.content, { tags: args.tags })
        return `Written: ${result.id} at ${result.timestamp}`
      },
    }),

    hmem_update: tool({
      description: "Update a memory entry's metadata (favorite, obsolete, pinned, etc.)",
      args: {
        id: tool.schema.string().describe("Memory ID to update"),
        favorite: tool.schema.boolean().optional().describe("Mark as favorite"),
        obsolete: tool.schema.boolean().optional().describe("Mark as obsolete"),
        pinned: tool.schema.boolean().optional().describe("Pin to always show"),
        content: tool.schema.string().optional().describe("Replace L1 content"),
      },
      async execute(args) {
        update(store, args.id, {
          favorite: args.favorite,
          obsolete: args.obsolete,
          pinned: args.pinned,
          content: args.content,
        })
        return `Updated: ${args.id}`
      },
    }),

    hmem_append: tool({
      description: "Append children to an existing memory entry",
      args: {
        parentId: tool.schema.string().describe("Parent memory ID (e.g., L0001 or L0001.2)"),
        content: tool.schema.string().describe("Tab-indented content to append as children"),
      },
      async execute(args) {
        const result = append(store, args.parentId, args.content)
        return `Appended ${result.count} nodes: ${result.ids.join(", ")}`
      },
    }),

    hmem_delete: tool({
      description: "Delete a memory entry and all its children",
      args: {
        id: tool.schema.string().describe("Memory ID to delete"),
      },
      async execute(args) {
        const ok = deleteEntry(store, args.id)
        return ok ? `Deleted: ${args.id}` : `Not found: ${args.id}`
      },
    }),

    hmem_tag: tool({
      description: "Set tags on a memory entry (replaces existing tags)",
      args: {
        id: tool.schema.string().describe("Memory ID to tag"),
        tags: tool.schema.array(tool.schema.string()).describe("Tags like #typescript, #project-x"),
      },
      async execute(args) {
        setTags(store, args.id, args.tags)
        const current = fetchTags(store, args.id)
        return `Tags on ${args.id}: ${current.join(", ") || "(none)"}`
      },
    }),

    hmem_related: tool({
      description: "Find memories related to a given entry (by shared tags)",
      args: {
        id: tool.schema.string().describe("Memory ID to find relations for"),
        limit: tool.schema.number().optional().describe("Max results (default 10)"),
      },
      async execute(args) {
        const related = findRelated(store, args.id, args.limit ?? 10)
        if (related.length === 0) return "No related memories found."
        return related.map((r) => `[${r.id}] ${r.title}`).join("\n")
      },
    }),

    hmem_stats: tool({
      description: "Show memory statistics (counts by prefix, total chars)",
      args: {},
      async execute() {
        const s = stats(store)
        let out = `Total: ${s.total} entries, ${s.totalChars} chars\n\nBy prefix:\n`
        for (const [prefix, count] of Object.entries(s.byPrefix)) {
          out += `  ${prefix}: ${count}\n`
        }
        return out
      },
    }),

    hmem_health: tool({
      description: "Run health check on memory database",
      args: {},
      async execute() {
        const h = healthCheck(store)
        const issues: string[] = []
        if (h.brokenLinks.length > 0) issues.push(`Broken links: ${h.brokenLinks.join(", ")}`)
        if (h.orphanedEntries.length > 0) issues.push(`Orphaned entries: ${h.orphanedEntries.join(", ")}`)
        if (h.staleFavorites.length > 0) issues.push(`Stale favorites: ${h.staleFavorites.join(", ")}`)
        if (h.tagOrphans > 0) issues.push(`Tag orphans: ${h.tagOrphans}`)
        return issues.length === 0 ? "Memory database is healthy." : issues.join("\n")
      },
    }),

    hmem_list: tool({
      description: "List all L1 memory entries (titles only, no children). Use to see existing memory before writing new entries.",
      args: {
        prefix: tool.schema.string().optional().describe("Filter by prefix (P, L, E, D, T, M, etc.)"),
      },
      async execute(args) {
        const entries = readL1Headers(store, { prefix: args.prefix })
        if (entries.length === 0) return "No memories found."
        return render(entries)
      },
    }),
  }
}
