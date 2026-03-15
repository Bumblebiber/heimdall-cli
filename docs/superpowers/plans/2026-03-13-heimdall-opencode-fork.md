# Heimdall OpenCode Fork — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork OpenCode (TypeScript/Bun) and rebrand to Heimdall with minimal diff for easy upstream cherry-picks.

**Architecture:** Fork the anomalyco/opencode repo, make targeted branding changes (~15 files), build a native `heimdall` binary. Existing plugins (heimdall-hmem, heimdall-catalog) continue to work as `file://` plugins. The fork is kept as lean as possible — only branding, identity, and config paths change.

**Tech Stack:** TypeScript, Bun 1.3.10+, Solid.js (TUI), SQLite (drizzle-orm)

**Upstream:** `github.com/anomalyco/opencode` (MIT license, default branch: `dev`)

---

## File Structure

### Files to Create/Modify in the Fork (inside `packages/opencode/`)

| File | Change | Reason |
|------|--------|--------|
| `src/cli/logo.ts` | Replace ASCII art | "HEIMDALL" logo |
| `src/cli/cmd/tui/app.tsx` | Terminal title | "OpenCode" → "Heimdall" |
| `src/cli/cmd/tui/component/tips.tsx` | Path references | `.opencode/` → `.heimdall/` |
| `src/config/config.ts` | Config dir names | "opencode" → "heimdall" in paths |
| `src/config/paths.ts` | Config file names | `opencode.json` → `heimdall.json` (+ backwards compat) |
| `src/global/index.ts` | XDG paths | `~/.config/opencode` → `~/.config/heimdall` |
| `src/session/prompt/anthropic.txt` | Identity | "You are OpenCode" → Heimdall persona |
| `src/session/prompt/beast.txt` | Identity | same |
| `src/session/prompt/codex_header.txt` | Identity | same |
| `src/session/prompt/gemini.txt` | Identity | same |
| `src/session/prompt/qwen.txt` | Identity | same |
| `src/session/prompt/trinity.txt` | Identity | same |
| `src/mcp/oauth-provider.ts` | Client name | "OpenCode" → "Heimdall" |
| `src/acp/agent.ts` | Agent name | "OpenCode" → "Heimdall" |
| `package.json` | Binary name | `opencode` → `heimdall` |

### Files Unchanged (in our Heimdall CLI repo)

| Path | Purpose |
|------|---------|
| `packages/heimdall-hmem/` | Memory plugin (existing) |
| `packages/heimdall-catalog/` | Catalog plugin (existing) |
| `configs/` | Welcome banners, catalog.json |
| `docs/` | Specs and plans |

---

## Chunk 1: Repository Setup

### Task 1: Fork OpenCode on GitHub

**Files:** None (GitHub operations only)

- [ ] **Step 1: Fork the repo**

```bash
gh repo fork anomalyco/opencode --clone=false --fork-name heimdall-opencode
```

This creates `Bumblebiber/heimdall-opencode` on GitHub.

- [ ] **Step 2: Clone the fork locally**

```bash
cd "P:/Meine Dokumente/Antigravity_Projekte"
git clone https://github.com/Bumblebiber/heimdall-opencode.git
cd heimdall-opencode
```

- [ ] **Step 3: Set up upstream remote**

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
git fetch upstream
```

- [ ] **Step 4: Create branding branch**

```bash
git checkout -b heimdall/branding
```

- [ ] **Step 5: Install dependencies**

```bash
bun install
```

- [ ] **Step 6: Verify vanilla build works**

```bash
cd packages/opencode
bun run build --single
```

Expected: Binary compiles at `packages/opencode/dist/opencode-windows-x64/bin/opencode`

- [ ] **Step 7: Commit (no changes — just verify)**

No commit needed. This confirms the build toolchain works on Windows.

---

### Task 2: Logo — Replace ASCII Art

**Files:**
- Modify: `packages/opencode/src/cli/logo.ts`

The current logo:
```typescript
export const logo = {
  left: ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"],
  right: ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],
}
export const marks = "_^~"
```

- [ ] **Step 1: Design HEIMDALL block logo**

Replace with "HEIMDALL" in the same block-letter style. The logo has `left` and `right` halves that are rendered side-by-side with a gap.

```typescript
export const logo = {
  left: ["                        ", "█▀▀▄ █▀▀▀ ▀▀█▀▀ █▀▀▄▀▀█", "█__█ █___ __█__ █__█__█", "▀  ▀ ▀▀▀▀ __▀__ ▀  ▀  ▀"],
  right: ["                   ", "█▀▀▄ █▀▀█ █    █  ", "█__█ █__█ █___ █__", "▀  ▀ ▀  ▀ ▀▀▀▀ ▀▀▀"],
}
export const marks = "_^~"
```

Note: The exact block art needs to be designed to match the style (4 rows: empty top, top halves, bottom halves, connectors). The `marks` characters (`_`, `^`, `~`) are used as shadow markers in the TUI renderer — they get replaced with dimmed versions. **The implementer should study the rendering code in `logo.tsx` and `ui.ts` before finalizing the art.**

- [ ] **Step 2: Verify logo renders in TUI**

```bash
cd packages/opencode
bun run dev
```

Expected: TUI shows "HEIMDALL" instead of "opencode" on the home screen.

- [ ] **Step 3: Commit**

```bash
git add src/cli/logo.ts
git commit -m "brand: replace OpenCode logo with Heimdall"
```

---

### Task 3: Terminal Title

**Files:**
- Modify: `packages/opencode/src/cli/cmd/tui/app.tsx`

- [ ] **Step 1: Find and replace terminal title strings**

Search for these three locations in `app.tsx`:
- `renderer.setTerminalTitle("OpenCode")` (appears twice — home page and session default)
- `renderer.setTerminalTitle(\`OC | ${title}\`)` (session with custom title)

Replace with:
- `renderer.setTerminalTitle("Heimdall")`
- `renderer.setTerminalTitle("Heimdall")`
- `` renderer.setTerminalTitle(`HD | ${title}`) ``

- [ ] **Step 2: Verify**

```bash
cd packages/opencode && bun run dev
```

Expected: Terminal tab/title bar shows "Heimdall" instead of "OpenCode".

- [ ] **Step 3: Commit**

```bash
git add src/cli/cmd/tui/app.tsx
git commit -m "brand: terminal title OpenCode → Heimdall"
```

---

## Chunk 2: Config Paths & Identity

### Task 4: Config Directory — .opencode → .heimdall

**Files:**
- Modify: `packages/opencode/src/global/index.ts`
- Modify: `packages/opencode/src/config/config.ts`
- Modify: `packages/opencode/src/config/paths.ts`
- Modify: `packages/opencode/src/config/tui.ts`

- [ ] **Step 1: Update XDG paths in global/index.ts**

Find the string `"opencode"` in the XDG path construction and replace with `"heimdall"`.

The file uses a pattern like:
```typescript
path.join(xdgData, "opencode")
path.join(xdgCache, "opencode")
path.join(xdgConfig, "opencode")
path.join(xdgState, "opencode")
```

Replace all with `"heimdall"`.

- [ ] **Step 2: Update config.ts**

Find all user-visible `"opencode"` strings:
- macOS: `/Library/Application Support/opencode` → `heimdall`
- Windows: `path.join(process.env.ProgramData || "C:\\ProgramData", "opencode")` → `"heimdall"`
- Linux: `/etc/opencode` → `/etc/heimdall`
- `.opencode` directory scanning → `.heimdall`
- Remote `.well-known/opencode` endpoint — **leave as-is** (upstream compatibility)

- [ ] **Step 3: Update paths.ts**

Change config file discovery:
- `opencode.jsonc` → also check `heimdall.jsonc`
- `opencode.json` → also check `heimdall.json`
- `.opencode` directory → `.heimdall`

**Backwards compatibility:** Check for BOTH `heimdall.json` (preferred) and `opencode.json` (fallback) so existing configs still work.

- [ ] **Step 4: Update tui.ts**

Change `.opencode` path check to `.heimdall`.

- [ ] **Step 5: Test config loading**

Create a `heimdall.json` in the project root (copy from opencode.json):
```bash
cp opencode.json heimdall.json
cd packages/opencode && bun run dev
```

Expected: Config loads from `heimdall.json`. Verify with logs.

- [ ] **Step 6: Commit**

```bash
git add src/global/index.ts src/config/config.ts src/config/paths.ts src/config/tui.ts
git commit -m "brand: config paths .opencode → .heimdall (with fallback)"
```

---

### Task 5: System Prompts — Heimdall Identity

**Files:**
- Modify: `packages/opencode/src/session/prompt/anthropic.txt`
- Modify: `packages/opencode/src/session/prompt/beast.txt`
- Modify: `packages/opencode/src/session/prompt/codex_header.txt`
- Modify: `packages/opencode/src/session/prompt/gemini.txt`
- Modify: `packages/opencode/src/session/prompt/qwen.txt`
- Modify: `packages/opencode/src/session/prompt/trinity.txt`

- [ ] **Step 1: Replace identity in all prompt files**

In each file, find the line containing "You are opencode" or "You are OpenCode" and replace with:

```
You are Heimdall, the all-seeing guardian of the Bifrost bridge, serving as an AI coding assistant. You watch over the developer's codebase with legendary perception, catching issues before they become problems. You have access to hierarchical long-term memory (hmem) and an agent catalog of Norse-themed specialists.
```

Keep the rest of each prompt file unchanged — they contain provider-specific instructions that must stay.

- [ ] **Step 2: Verify identity**

```bash
cd packages/opencode && bun run dev
```

In the TUI, ask: "Wer bist du?"

Expected: The AI responds as Heimdall, not OpenCode.

- [ ] **Step 3: Commit**

```bash
git add src/session/prompt/
git commit -m "brand: system prompts — Heimdall identity in all provider templates"
```

---

### Task 6: UI Text & Tips

**Files:**
- Modify: `packages/opencode/src/cli/cmd/tui/component/tips.tsx`
- Modify: `packages/opencode/src/mcp/oauth-provider.ts`
- Modify: `packages/opencode/src/acp/agent.ts`

- [ ] **Step 1: Update tips.tsx**

Replace `.opencode/` path references with `.heimdall/`:
- `.opencode/command/` → `.heimdall/command/`
- `.opencode/agent/` → `.heimdall/agent/`
- `.opencode/tools/` → `.heimdall/tools/`
- `.opencode/plugin/` → `.heimdall/plugin/`
- `.opencode/themes/` → `.heimdall/themes/`

Also update:
- Docker image `ghcr.io/anomalyco/opencode` → leave as comment or update to Heimdall equivalent
- GitHub slash command `/opencode` → `/heimdall`

- [ ] **Step 2: Update OAuth client name**

In `src/mcp/oauth-provider.ts`, change:
```typescript
client_name: "OpenCode"
```
to:
```typescript
client_name: "Heimdall"
```

- [ ] **Step 3: Update ACP agent name**

In `src/acp/agent.ts`, change:
```typescript
name: "OpenCode"
```
to:
```typescript
name: "Heimdall"
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/cmd/tui/component/tips.tsx src/mcp/oauth-provider.ts src/acp/agent.ts
git commit -m "brand: UI text, tips, OAuth name → Heimdall"
```

---

## Chunk 3: Binary Build & Integration

### Task 7: Package Name & Binary

**Files:**
- Modify: `packages/opencode/package.json`
- Modify: `packages/opencode/script/build.ts` (binary output name)

- [ ] **Step 1: Update package.json**

Change binary name:
```json
{
  "name": "heimdall-cli",
  "bin": {
    "heimdall": "./bin/heimdall"
  }
}
```

Keep version synced with upstream OpenCode version for clarity.

- [ ] **Step 2: Update build script output name**

In `script/build.ts`, find where the binary name `opencode` is constructed:
- Output directory pattern: `opencode-{platform}-{arch}`
- Binary name inside: `opencode` (or `opencode.exe`)

Replace with `heimdall-{platform}-{arch}` and `heimdall` binary name.

Search for all instances of the string `"opencode"` in the build script and evaluate each one:
- Binary name → change to `"heimdall"`
- Platform package names → change to `"heimdall-"`
- Version constants `OPENCODE_VERSION` → keep as-is (internal, not user-facing)
- Migration constants → keep as-is

- [ ] **Step 3: Commit**

```bash
git add package.json script/build.ts
git commit -m "brand: binary name opencode → heimdall"
```

---

### Task 8: Build & Test on Windows

**Files:** None (build verification only)

- [ ] **Step 1: Build the binary**

```bash
cd packages/opencode
bun run build --single
```

Expected: Binary at `dist/heimdall-windows-x64/bin/heimdall` (no .exe — Bun convention)

- [ ] **Step 2: Copy binary to Heimdall CLI**

```bash
cp dist/heimdall-windows-x64/bin/heimdall "P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/bin/heimdall.exe"
```

Note: Rename to `.exe` for Windows PATH discovery.

- [ ] **Step 3: Remove the .cmd wrapper (replaced by real binary)**

```bash
rm "P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/bin/heimdall.cmd"
```

- [ ] **Step 4: Test launch**

Open new terminal:
```bash
heimdall
```

Expected:
- TUI shows Heimdall logo (not OpenCode)
- Terminal title says "Heimdall"
- Ask "Wer bist du?" → responds as Heimdall
- Tips reference `.heimdall/` paths

- [ ] **Step 5: Test plugin loading**

Rename `opencode.json` to `heimdall.json` in the Heimdall CLI project root:
```bash
cd "P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI"
mv opencode.json heimdall.json
```

Restart `heimdall` and verify:
- `catalog_list` tool available
- `hmem_search` tool available
- Heimdall persona in system prompt

- [ ] **Step 6: Commit & push the fork**

```bash
git push origin heimdall/branding
```

- [ ] **Step 7: Create PR in fork repo**

```bash
gh pr create --title "Heimdall branding" --body "Minimal rebrand of OpenCode to Heimdall CLI"
```

---

### Task 9: Update Heimdall CLI Repo

**Files:**
- Modify: `P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/heimdall.json` (renamed from opencode.json)
- Delete: `P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/bin/heimdall.cmd`
- Create: `P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI/bin/heimdall.exe` (from build)

- [ ] **Step 1: Update .gitignore**

Remove `*.exe` exclusion since we now want to track the binary (or keep it excluded and document the build step).

Decision: **Don't track the binary in git.** Instead, document the build process in README.

- [ ] **Step 2: Update README.md**

Add build instructions:
```markdown
## Building Heimdall

1. Clone the fork: `git clone https://github.com/Bumblebiber/heimdall-opencode`
2. Install deps: `cd heimdall-opencode && bun install`
3. Build: `cd packages/opencode && bun run build --single`
4. Copy binary to PATH
```

- [ ] **Step 3: Commit Heimdall CLI repo changes**

```bash
cd "P:/Meine Dokumente/Antigravity_Projekte/Heimdall CLI"
git add -A
git commit -m "chore: clean up Go fork remnants, update config for Heimdall fork"
git push
```

---

## Environment Variables (Optional — Phase 2)

These `OPENCODE_*` environment variables could be renamed to `HEIMDALL_*` in a later phase. For now, keeping them ensures compatibility with upstream documentation and any plugins that reference them:

- `OPENCODE_CONFIG_DIR` → future `HEIMDALL_CONFIG_DIR`
- `OPENCODE_DISABLE_DEFAULT_PLUGINS` → future `HEIMDALL_DISABLE_DEFAULT_PLUGINS`
- `OPENCODE_SERVER_PASSWORD` → future `HEIMDALL_SERVER_PASSWORD`

**Recommendation:** Add dual-support (check `HEIMDALL_*` first, fall back to `OPENCODE_*`) in a future PR.

---

## Summary

| Task | Scope | Est. Complexity |
|------|-------|-----------------|
| 1. Fork & Clone | GitHub + local setup | Simple |
| 2. Logo | 1 file, ASCII art | Simple |
| 3. Terminal Title | 1 file, 3 string replacements | Simple |
| 4. Config Paths | 4 files, path strings | Medium |
| 5. System Prompts | 6 text files, identity line | Simple |
| 6. UI Text & Tips | 3 files, string replacements | Simple |
| 7. Package/Binary Name | 2 files | Medium |
| 8. Build & Test | Build verification | Medium (Windows build) |
| 9. Update Heimdall CLI | Cleanup + docs | Simple |

**Total branding diff:** ~15 files, ~50 lines changed. Minimal surface for merge conflicts with upstream.
