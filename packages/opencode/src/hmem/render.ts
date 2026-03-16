import type { MemoryEntry, MemoryNode } from "./types"

function renderNode(node: MemoryNode, indent: number): string {
  const prefix = "\t".repeat(indent)
  let line = `${prefix}${node.content}`
  if (node.favorite) line += " \u2665"
  if (node.tags.length > 0) line += ` [${node.tags.join(", ")}]`
  let out = line + "\n"
  for (const child of node.children) {
    out += renderNode(child, indent + 1)
  }
  return out
}

export function render(entries: MemoryEntry[]): string {
  if (entries.length === 0) return ""

  let out = ""
  for (const entry of entries) {
    if (entry.obsolete) continue

    let header = `[${entry.id}]`
    if (entry.favorite) header += " \u2665"
    if (entry.pinned) header += " \u{1F4CC}"
    if (entry.tags.length > 0) header += ` [${entry.tags.join(", ")}]`
    header += ` ${entry.level1}`

    out += header + "\n"
    for (const child of entry.children) {
      out += renderNode(child, 1)
    }
    out += "\n"
  }
  return out.trimEnd() + "\n"
}
