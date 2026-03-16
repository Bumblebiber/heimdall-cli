// src/parse.ts
import type { ParseTreeResult, ParsedNode } from "./types"

const MAX_DEPTH = 5

export function autoExtractTitle(text: string): string {
  const separators = [". ", ": ", " — ", " - "]
  let bestPos = -1
  for (const sep of separators) {
    const pos = text.indexOf(sep)
    if (pos > 0 && pos < 60) {
      if (bestPos === -1 || pos < bestPos) bestPos = pos
    }
  }
  if (bestPos > 0) return text.slice(0, bestPos)
  if (text.length <= 40) return text
  return text.slice(0, 40) + "\u2026"
}

function detectIndentUnit(lines: string[]): { type: "tab" | "space"; size: number } {
  for (const line of lines) {
    if (line.startsWith("\t")) return { type: "tab", size: 1 }
  }
  // Detect space indent unit
  for (const line of lines) {
    const match = line.match(/^( +)/)
    if (match) return { type: "space", size: match[1].length }
  }
  return { type: "tab", size: 1 }
}

function getDepth(line: string, indent: { type: "tab" | "space"; size: number }): number {
  if (indent.type === "tab") {
    let count = 0
    for (const ch of line) {
      if (ch === "\t") count++
      else break
    }
    return count
  }
  const match = line.match(/^( +)/)
  if (!match) return 0
  return Math.floor(match[1].length / indent.size)
}

function stripIndent(line: string, indent: { type: "tab" | "space"; size: number }, depth: number): string {
  if (indent.type === "tab") return line.slice(depth)
  return line.slice(depth * indent.size)
}

export function parseTree(content: string, rootId: string): ParseTreeResult {
  const lines = content.split("\n").filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { title: "", level1: "", nodes: [] }

  const indent = detectIndentUnit(lines)

  // Collect L1 lines (depth 0)
  const l1Lines: string[] = []
  const childLines: { depth: number; text: string }[] = []

  for (const line of lines) {
    const d = getDepth(line, indent)
    if (d === 0) {
      l1Lines.push(line.trim())
    } else {
      childLines.push({ depth: Math.min(d, MAX_DEPTH - 1), text: stripIndent(line, indent, d).trim() })
    }
  }

  // Title + level1
  let title: string
  let level1: string
  if (l1Lines.length >= 2) {
    title = l1Lines[0]
    level1 = l1Lines.slice(1).join(" | ") // Go: strings.Join(l1Lines[1:], " | ")
  } else {
    level1 = l1Lines[0] || ""
    title = autoExtractTitle(level1)
  }

  // Build nodes with parent tracking
  const nodes: ParsedNode[] = []
  const parentStack: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }]
  const seqCounters = new Map<string, number>() // parentId → next seq

  for (const { depth, text } of childLines) {
    // Pop stack until we find the parent
    while (parentStack.length > 1 && parentStack[parentStack.length - 1].depth >= depth + 1) {
      parentStack.pop()
    }
    const parent = parentStack[parentStack.length - 1]

    const nextSeq = (seqCounters.get(parent.id) ?? 0) + 1
    seqCounters.set(parent.id, nextSeq)

    const nodeId = `${parent.id}.${nextSeq}`

    nodes.push({
      id: nodeId,
      parentId: parent.id,
      depth: depth + 1, // depth 0 = L1, depth 1 = L2, etc.
      seq: nextSeq,
      content: text,
      title: autoExtractTitle(text),
    })

    parentStack.push({ id: nodeId, depth: depth + 1 })
  }

  return { title, level1, nodes }
}

export function parseRelativeTree(
  content: string,
  parentId: string,
  parentDepth: number,
  startSeq: number,
): ParsedNode[] {
  const lines = content.split("\n").filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []

  const indent = detectIndentUnit(lines)
  const nodes: ParsedNode[] = []
  const parentStack: { id: string; depth: number }[] = [{ id: parentId, depth: parentDepth }]
  const seqCounters = new Map<string, number>()
  seqCounters.set(parentId, startSeq - 1) // so first increment gives startSeq

  for (const line of lines) {
    const relDepth = getDepth(line, indent)
    const absDepth = parentDepth + relDepth + 1
    const text = stripIndent(line, indent, relDepth).trim()

    // Pop stack to find parent
    while (parentStack.length > 1 && parentStack[parentStack.length - 1].depth >= absDepth) {
      parentStack.pop()
    }
    const parent = parentStack[parentStack.length - 1]

    const nextSeq = (seqCounters.get(parent.id) ?? 0) + 1
    seqCounters.set(parent.id, nextSeq)

    const nodeId = `${parent.id}.${nextSeq}`

    nodes.push({
      id: nodeId,
      parentId: parent.id,
      depth: absDepth,
      seq: nextSeq,
      content: text,
      title: autoExtractTitle(text),
    })

    parentStack.push({ id: nodeId, depth: absDepth })
  }

  return nodes
}
