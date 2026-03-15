import { PermissionNext } from "../permission/next"
import type { Config } from "../config/config"
import type { CatalogAgent } from "../catalog"

const TOOLSET_CONFIGS: Record<string, Config.Permission> = {
  coder:      { "*": "allow" },
  researcher: { grep: "allow", glob: "allow", read: "allow", webfetch: "allow", list: "allow", "*": "deny" },
  reviewer:   { grep: "allow", glob: "allow", read: "allow", list: "allow", "*": "deny" },
  writer:     { grep: "allow", glob: "allow", read: "allow", write: "allow", edit: "allow", list: "allow", "*": "deny" },
}

export function resolveToolset(toolset?: string): PermissionNext.Ruleset {
  const config = TOOLSET_CONFIGS[toolset ?? "researcher"] ?? TOOLSET_CONFIGS.researcher
  return PermissionNext.fromConfig(config)
}

export function buildAgentPrompt(
  agent: Pick<CatalogAgent, "persona">,
  contextPrefix: string,
  contract: string | null,
): string {
  return [agent.persona, contract, contextPrefix].filter(Boolean).join("\n\n")
}

export function buildAgentInfo(
  catalogAgent: CatalogAgent,
  contextPrefix: string,
  contract: string | null,
) {
  return {
    name: catalogAgent.id,
    mode: "subagent" as const,
    permission: resolveToolset(catalogAgent.tools),
    options: {},
    prompt: buildAgentPrompt(catalogAgent, contextPrefix, contract),
    model: catalogAgent.provider && catalogAgent.model
      ? { providerID: catalogAgent.provider, modelID: catalogAgent.model }
      : undefined,
    temperature: catalogAgent.temperature,
  }
}
