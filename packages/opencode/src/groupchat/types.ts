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
