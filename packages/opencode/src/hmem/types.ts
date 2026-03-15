// Agent roles (access control hierarchy)
export type AgentRole = "worker" | "al" | "pl" | "ceo"

export const ROLE_LEVEL: Record<AgentRole, number> = {
  worker: 0,
  al: 1,
  pl: 2,
  ceo: 3,
}

export function allowedRoles(role: AgentRole): AgentRole[] {
  const level = ROLE_LEVEL[role]
  return (Object.keys(ROLE_LEVEL) as AgentRole[]).filter(
    (r) => ROLE_LEVEL[r] <= level,
  )
}

// Valid memory prefixes
export const VALID_PREFIXES = [
  "P", "L", "T", "E", "D", "M", "S", "N", "H", "R", "F",
] as const
export type Prefix = (typeof VALID_PREFIXES)[number]

// Character limits by depth (index = depth - 1)
// L1: 120, L2: 300, L3: 800, L4: 2000, L5: unlimited
export const CHAR_LIMITS = [120, 300, 800, 2000, 0]
export const CHAR_TOLERANCE = 1.25 // 125%

export interface MemoryEntry {
  id: string             // "L0001", "P0005"
  prefix: string
  seq: number
  createdAt: string      // RFC3339
  updatedAt: string
  title: string
  level1: string
  links: string[]
  minRole: AgentRole
  obsolete: boolean
  favorite: boolean
  irrelevant: boolean
  pinned: boolean
  accessCount: number
  lastAccessed: string | null
  promoted: string
  tags: string[]
  children: MemoryNode[]
}

export interface MemoryNode {
  id: string             // "L0001.2.1"
  parentId: string
  rootId: string
  depth: number          // 1-5
  seq: number
  title: string
  content: string
  createdAt: string
  accessCount: number
  favorite: boolean
  irrelevant: boolean
  tags: string[]
  children: MemoryNode[]
}

export interface WriteOptions {
  links?: string[]
  minRole?: AgentRole
  favorite?: boolean
  pinned?: boolean
  tags?: string[]
}

export interface WriteResult {
  id: string
  timestamp: string
}

export interface AppendResult {
  count: number
  ids: string[]
}

export interface ReadOptions {
  id?: string
  prefix?: string
  search?: string
  agentRole?: AgentRole
  limit?: number
  after?: string         // ISO date
  before?: string        // ISO date
}

export interface UpdateFields {
  content?: string
  links?: string[]
  minRole?: AgentRole
  obsolete?: boolean
  favorite?: boolean
  irrelevant?: boolean
  pinned?: boolean
}

export interface RelatedEntry {
  id: string
  title: string
  createdAt: string
  tags: string[]
  matchType: "tags" | "fts"
}

export interface StatsResult {
  total: number
  byPrefix: Record<string, number>
  totalChars: number
}

export interface HealthResult {
  brokenLinks: string[]
  orphanedEntries: string[]
  staleFavorites: string[]
  brokenObsoleteChains: string[]
  tagOrphans: number
}

export interface CompactedTopic {
  prefix: string
  tags: string[]
  l1: string
  l2: string
  l3: string
  l4: string
  l5: string
}

export interface CompactionResult {
  summary: string
  topics: CompactedTopic[]
}

export interface ParseTreeResult {
  title: string
  level1: string
  nodes: ParsedNode[]
}

export interface ParsedNode {
  id: string
  parentId: string
  depth: number
  seq: number
  content: string
  title: string
}
