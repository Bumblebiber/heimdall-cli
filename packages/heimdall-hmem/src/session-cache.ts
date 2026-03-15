export class SessionCache {
  private entries = new Map<string, number>() // id -> timestamp (ms)

  record(id: string): void {
    if (!this.entries.has(id)) this.entries.set(id, Date.now())
  }

  recordAll(ids: string[]): void {
    for (const id of ids) this.record(id)
  }

  isHidden(id: string): boolean {
    const seen = this.entries.get(id)
    if (!seen) return false
    return Date.now() - seen < 5 * 60 * 1000
  }

  isCached(id: string): boolean {
    const seen = this.entries.get(id)
    if (!seen) return false
    const age = Date.now() - seen
    return age >= 5 * 60 * 1000 && age < 30 * 60 * 1000
  }

  hiddenAndCachedSets(): { hidden: Set<string>; cached: Set<string> } {
    const hidden = new Set<string>()
    const cached = new Set<string>()
    const now = Date.now()
    for (const [id, seen] of this.entries) {
      const age = now - seen
      if (age < 5 * 60 * 1000) hidden.add(id)
      else if (age < 30 * 60 * 1000) cached.add(id)
    }
    return { hidden, cached }
  }
}
