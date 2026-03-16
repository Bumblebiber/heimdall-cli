#!/usr/bin/env bun
/**
 * Postinstall: ensure better-sqlite3 native bindings are available.
 * bun install sometimes fails to resolve prebuilt binaries on Windows.
 * This script copies the .node file from hmem-mcp's bundled copy if needed.
 */
import fs from "fs"
import path from "path"

const root = path.resolve(import.meta.dir, "..")
const targets = [
  path.join(root, "node_modules", ".bun", "better-sqlite3@11.10.0", "node_modules", "better-sqlite3"),
  path.join(root, "node_modules", ".bun", "better-sqlite3@12.8.0", "node_modules", "better-sqlite3"),
  path.join(root, "node_modules", "better-sqlite3"),
]

const bindingFile = "better_sqlite3.node"
const releasePath = path.join("build", "Release", bindingFile)

// Check if any target already has the binding
for (const target of targets) {
  const full = path.join(target, releasePath)
  if (fs.existsSync(full)) {
    console.log(`[postinstall-sqlite] Binding found at ${full}`)
    process.exit(0)
  }
}

// Try to find a working binding from hmem-mcp (globally installed)
const globalPaths = [
  path.join(process.env.APPDATA ?? "", "npm", "node_modules", "hmem-mcp", "node_modules", "better-sqlite3", releasePath),
  path.join(process.env.HOME ?? "", ".npm-global", "lib", "node_modules", "hmem-mcp", "node_modules", "better-sqlite3", releasePath),
]

let source: string | undefined
for (const p of globalPaths) {
  if (fs.existsSync(p)) {
    source = p
    break
  }
}

if (!source) {
  console.warn("[postinstall-sqlite] No prebuilt binding found. Run: npm install -g hmem-mcp")
  process.exit(0)
}

// Copy to all target locations
for (const target of targets) {
  if (!fs.existsSync(target)) continue
  const dest = path.join(target, releasePath)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(source, dest)
  console.log(`[postinstall-sqlite] Copied binding to ${dest}`)
}
