/**
 * Runtime adapter: uses bun:sqlite when running under Bun,
 * falls back to better-sqlite3 under Node.js.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DatabaseConstructor: any

// @ts-ignore — Bun global exists only in Bun runtime
const isBun = typeof globalThis["Bun"] !== "undefined"

if (isBun) {
  // Bun built-in SQLite — dynamic import bypasses TS module check
  // @ts-ignore — bun:sqlite only available at runtime under Bun
  const mod = await import("bun:sqlite")
  const BunDatabase = mod.Database

  // Wrap to add .pragma() compatibility (better-sqlite3 API)
  DatabaseConstructor = class BunDatabaseCompat extends BunDatabase {
    pragma(str: string): unknown {
      const [key, val] = str.split("=").map((s: string) => s.trim())
      if (val !== undefined) {
        this.exec(`PRAGMA ${key} = ${val}`)
        return val
      }
      return this.prepare(`PRAGMA ${key}`).get()
    }
  }
} else {
  // Node.js: use better-sqlite3
  const mod = await import("better-sqlite3")
  DatabaseConstructor = mod.default
}

export default DatabaseConstructor as {
  new (path: string): import("better-sqlite3").Database
}
