import fs from "fs"
import path from "path"

export function checkMemorySetup(projectDir: string): "local" | "global" | null {
  const configPath = path.join(projectDir, ".heimdall", "config.json")
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    if (config.memory === "local" || config.memory === "global") return config.memory
  } catch {}
  const localPath = path.join(projectDir, ".heimdall", "memory.hmem")
  if (fs.existsSync(localPath)) return "local"
  return null
}

export function saveMemorySetup(projectDir: string, choice: "local" | "global"): void {
  const dir = path.join(projectDir, ".heimdall")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ memory: choice }, null, 2))
}
