import type { Plugin } from "@opencode-ai/plugin"
import { Catalog } from "./catalog.js"
import { createCatalogTools } from "./tools.js"
import { join } from "path"
import { existsSync } from "fs"

const catalogPlugin: Plugin = async (input) => {
  const catalogPath = process.env.HEIMDALL_CATALOG_PATH
    ?? join(input.directory, "heimdall-catalog.json")

  let resolvedPath = catalogPath
  if (!existsSync(resolvedPath)) {
    const altPath = join(input.directory, "configs", "catalog.json")
    if (!existsSync(altPath)) {
      console.warn(`[heimdall-catalog] No catalog found at ${resolvedPath}`)
      return {}
    }
    resolvedPath = altPath
  }

  const catalog = Catalog.load(resolvedPath)
  return { tool: createCatalogTools(catalog) }
}

export default catalogPlugin
