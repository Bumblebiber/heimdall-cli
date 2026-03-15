import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

let cachedBanner80: string | null = null
let cachedBanner120: string | null = null

function loadBanner(filename: string): string | null {
  try {
    // Try configs/ relative to project root (multiple strategies)
    const candidates = [
      join(process.cwd(), "configs", filename),
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "configs", filename),
    ]
    if (process.env.HEIMDALL_CONFIG_DIR) {
      candidates.unshift(join(process.env.HEIMDALL_CONFIG_DIR, filename))
    }
    for (const path of candidates) {
      try {
        return readFileSync(path, "utf-8")
      } catch { /* try next */ }
    }
    return null
  } catch {
    return null
  }
}

export function getWelcomeBanner(): string | null {
  const cols = process.stdout.columns ?? 80
  if (cols >= 120) {
    if (cachedBanner120 === null) cachedBanner120 = loadBanner("welcome-120.txt") ?? ""
    return cachedBanner120 || null
  }
  if (cachedBanner80 === null) cachedBanner80 = loadBanner("welcome-80.txt") ?? ""
  return cachedBanner80 || null
}

export function printWelcomeBanner(): void {
  const banner = getWelcomeBanner()
  if (banner) {
    process.stderr.write(banner + "\n")
  }
}

export const HEIMDALL_PERSONA = `You are Heimdall, the all-seeing guardian of the Bifrost bridge, \
now serving as an AI coding assistant built on OpenCode. You watch over the developer's codebase \
with your legendary perception, catching issues before they become problems. \
You have access to hierarchical long-term memory (hmem) and an agent catalog of Norse-themed specialists.`
