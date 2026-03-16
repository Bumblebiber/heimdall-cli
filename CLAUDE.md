# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Heimdall is a permanent fork of [OpenCode](https://github.com/anomalyco/opencode) (TypeScript/Bun CLI). It's a personal AI operating system with native hierarchical memory (hmem), a Norse-themed multi-agent system, and group chat capabilities. The default branch is `dev`.

## Commands

```bash
# Development (from repo root)
bun install                          # Install dependencies
bun dev                              # Run TUI (defaults to packages/opencode dir)
bun dev <directory>                  # Run TUI against a specific directory
bun dev .                            # Run TUI in repo root
bun dev serve                        # Headless API server (port 4096)
bun dev serve --port 8080            # Custom port
bun typecheck                        # TypeScript check (via turbo)

# Build standalone binary
./packages/opencode/script/build.ts --single

# Tests — MUST run from package directory, NOT repo root
cd packages/opencode && bun test --timeout 30000
cd packages/opencode && bun test src/groupchat/mention.test.ts  # Single test file
cd packages/heimdall-hmem && bun test
cd packages/heimdall-catalog && bun test

# Type checking — from package directory
cd packages/opencode && bun typecheck    # Uses tsgo --noEmit

# Database migrations
cd packages/opencode && bun drizzle-kit <command>

# SDK regeneration (after API/SDK changes)
./packages/sdk/js/script/build.ts
```

## Architecture

### Monorepo Structure

- **`packages/opencode/`** — Core CLI, TUI, server, LLM providers, tools, session management. This is where most development happens.
- **`packages/heimdall-hmem/`** — Hierarchical memory system (hmem). SQLite-backed, L1-L5 hierarchy, FTS5 search. Currently runs as a plugin; native integration planned.
- **`packages/heimdall-catalog/`** — Agent catalog. JSON-based Norse-themed agent definitions with department grouping.
- **`packages/plugin/`** — Plugin SDK (`@opencode-ai/plugin`). Hook-based extension system.
- **`packages/app/`** — Web UI (SolidJS).
- **`packages/sdk/js/`** — TypeScript SDK (`@opencode-ai/sdk`).
- **`packages/desktop/`** — Tauri desktop wrapper.

### Core Package (`packages/opencode/src/`)

| Directory | Purpose |
|-----------|---------|
| `cli/cmd/tui/` | Terminal UI — SolidJS + @opentui/solid (NOT Ink) |
| `session/` | Session lifecycle, messages, compaction, prompts |
| `provider/` | 20+ LLM providers via Vercel AI SDK (`ai` package) |
| `command/` | Tool definitions (bash, edit, read, write, grep, glob, task, etc.) |
| `agent/` | Built-in agents: build (primary), plan (read-only), general, explore |
| `permission/` | ACL system — rules with allow/deny/ask actions, glob patterns |
| `mcp/` | Model Context Protocol client (stdio, SSE, HTTP transports) |
| `storage/` | SQLite via Bun native binding + Drizzle ORM (WAL mode) |
| `config/` | JSONC + Markdown frontmatter config, multi-source merge |
| `skill/` | SKILL.md loading from multiple locations |
| `groupchat/` | Multi-agent round-robin dispatch with @-mentions |
| `hmem/` | Interface layer to heimdall-hmem plugin |
| `catalog/` | Interface layer to heimdall-catalog plugin |

### Key Patterns

**TUI framework:** SolidJS with `@opentui/core` and `@opentui/solid`. Path aliases: `@/*` → `src/*`, `@tui/*` → `src/cli/cmd/tui/*`. Dialogs use `useDialog()` from `@tui/ui/dialog`. Context uses `createSimpleContext` from `@tui/context`.

**Tool registration:** Tools in `src/command/` export Zod schemas and get converted to AI SDK `LanguageModelV2Tool` format for LLM function calling.

**Config resolution (low → high priority):** Remote .well-known → Global ~/.config/heimdall/ → OPENCODE_CONFIG env → Project heimdall.json → .heimdall/ dirs → Inline env → Managed/Enterprise.

**Database:** SQLite with Drizzle ORM. Migrations in `packages/opencode/migration/`. Schema uses snake_case field names.

**Plugins:** Hook-based system via `@opencode-ai/plugin`. Hooks include `tool.*`, `chat.message`, `chat.params`, `permission.ask`, `shell.env`, `experimental.compaction.*`.

### Heimdall-Specific Features

- **Branding:** Elder Futhark rune logo (ᚺᛖᛁᛗᛞᚨᛚᛚ). Config paths: `.heimdall/`, `heimdall.json`. Binary name: `heimdall`.
- **Agent catalog:** Norse-themed agents with fixed model/temperature per agent, organized by department.
- **Group chat:** `/groupchat`, `/endchat`, `/invite` slash commands. Agent picker with department sections. Color-coded agent borders.
- **hmem:** Hierarchical memory (L1-L5) with SQLite backend. Currently as plugin (`packages/heimdall-hmem`), native integration planned.

## Style Guide

- Single-word variable names preferred; multi-word only when necessary
- `const` over `let`; ternaries or early returns instead of reassignment
- No `else` — use early returns
- No unnecessary destructuring — use dot notation
- Avoid `try`/`catch` — use `.catch()` when possible
- Avoid `any` — use precise types, rely on inference
- Use Bun APIs (`Bun.file()`, etc.)
- Drizzle schema: snake_case field names (no string column name args)
- Functional array methods (flatMap, filter, map) over for loops
- Inline values used only once; don't create intermediate variables

## Testing

- Framework: Vitest (via `bun test`)
- Avoid mocks — test actual implementations
- Tests CANNOT run from repo root (guard: `do-not-run-tests-from-root`)
- Never duplicate implementation logic into tests

## Formatting

- Prettier: `semi: false`, `printWidth: 120`
- No semicolons
