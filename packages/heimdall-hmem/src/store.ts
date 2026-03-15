import Database from "./sqlite-adapter.js"
import { mkdirSync } from "fs"
import { dirname } from "path"
import { SCHEMA_DDL, MIGRATIONS } from "./schema.js"
import { SessionCache } from "./session-cache.js"

export class Store {
  private db: InstanceType<typeof Database>
  readonly path: string
  readonly cache: SessionCache

  private constructor(db: InstanceType<typeof Database>, path: string) {
    this.db = db
    this.path = path
    this.cache = new SessionCache()
  }

  static async open(hmemPath: string): Promise<Store> {
    mkdirSync(dirname(hmemPath), { recursive: true })
    const db = new Database(hmemPath)
    db.pragma("journal_mode = WAL")
    const store = new Store(db, hmemPath)
    store.initSchema()
    return store
  }

  private initSchema(): void {
    this.db.exec(SCHEMA_DDL)
    for (const migration of MIGRATIONS) {
      try { this.db.exec(migration) } catch { /* idempotent */ }
    }
  }

  close(): void { this.db.close() }

  get database(): InstanceType<typeof Database> { return this.db }
}
