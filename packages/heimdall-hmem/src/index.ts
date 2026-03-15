console.warn("[heimdall-hmem] This plugin is deprecated. hmem is now built into Heimdall CLI natively.")

import type { Plugin } from "@opencode-ai/plugin"
import { Store } from "./store.js"
import { createHmemTools } from "./tools.js"
import { bulkReadV2 } from "./bulk-read.js"
import { render } from "./render.js"
import { printWelcomeBanner, HEIMDALL_PERSONA } from "./welcome.js"
import { homedir } from "os"
import { join } from "path"

const hmemPlugin: Plugin = async (_pluginInput) => {
  const hmemPath = process.env.HMEM_PATH ?? join(homedir(), ".hmem", "memory.hmem")

  // Show Bifrost welcome banner on plugin load
  printWelcomeBanner()

  let store: Store
  try {
    store = await Store.open(hmemPath)
  } catch (err) {
    console.error(`[heimdall-hmem] Failed to open hmem database at ${hmemPath}:`, err)
    return {}
  }

  return {
    tool: createHmemTools(store),

    // --- Auto-Recall: inject persona + memories into every LLM call ---
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        // Inject Heimdall persona
        output.system.unshift(HEIMDALL_PERSONA)

        // Inject memories
        const memories = bulkReadV2(store, {})
        if (memories.length > 0) {
          output.system.push(
            "# Long-term Memory (hmem)\n\n" +
            "The following are your persistent memories from previous sessions:\n\n" +
            render(memories),
          )
        }
      } catch (err) {
        console.error("[heimdall-hmem] Auto-recall failed:", err)
      }
    },

    "shell.env": async (_input, output) => {
      output.env.HMEM_PATH = hmemPath
    },
  }
}

export default hmemPlugin
