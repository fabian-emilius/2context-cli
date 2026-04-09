# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

2context-cli is a CLI tool that analyzes git repository commit history using AI to extract and generate structured knowledge documentation (architecture, conventions, decisions, patterns). It supports Anthropic, OpenAI, and Google LLM providers.

## Commands

```bash
npm run build          # Compile with NestJS/SWC
npm run start:dev      # Run with tsx in dev mode
npm run start:prod     # Run compiled binary (node dist/main.js)
npm run lint           # ESLint with auto-fix
npm run format         # Prettier formatting
```

No test framework is configured.

## Architecture

**Framework:** NestJS 11 with nest-commander for CLI commands, compiled via SWC. ESM-only (`"type": "module"`). Path alias `@/*` maps to `src/*`.

**Entry flow:** `src/main.ts` bootstraps NestJS → `src/app.module.ts` imports all modules → nest-commander routes to commands in `src/commands/`.

### Module Organization (`src/modules/`)

- **AI** — LLM abstraction via Mastra framework. `AiService` wraps `generate()`, `generateStructured()`, `stream()` with retry/exponential backoff (3 attempts). Supports Anthropic/OpenAI/Google providers.
- **Config** — Multi-tier config resolution: env vars (`TWOCONTEXT_*`) → `~/.2context/keys.json` → interactive wizard. `ConfigService` caches in memory, writes keys with chmod 0o600.
- **Git** — Repository analysis via simple-git. `GitService` provides 15+ methods for commit/diff fetching, file content retrieval, batch operations (groups of 20).
- **Grouping** — AI-powered commit clustering into feature groups. Batches 150 commits at a time, validates with Zod schemas, falls back to single group on failure.
- **Context** — Main analysis orchestration: init git → load state → fetch commits → group → extract insights (3 groups concurrent, max 10 diffs/group) → write files → update agent file → save state.
- **State** — Persistent state in `.2context/state.json`. Tracks last analyzed commit for incremental analysis.
- **Writer** — Dual output: source-tree `KNOWLEDGE.md` files alongside code + `.2context/knowledge/{category}/` general files. `AgentFileUpdater` maintains a Knowledge Context section in CLAUDE.md/AGENTS.md.

### CLI Commands (`src/commands/`)

All commands extend `BaseCommand` (`src/helpers/base-command.ts`) which provides error handling.

- **InitCommand** — Main entry: config resolution → analysis pipeline → summary display. Options: `-b/--branch`, `-v/--verbose`, `-f/--force`.
- **StatusCommand** — Shows configuration and analysis state.

### Terminal UI (`src/ui/`)

Dual-mode rendering: interactive (Ink/React) vs CI (plain text). Auto-detects via `CI`, `TWOCONTEXT_CI` env vars, or TTY. `TerminalUI` provides output methods (header, spinner, log, etc.) and input methods (askString, askSecret, askObject, askBoolean).

### Prompt System (`src/prompts/`)

Composable prompt builders: `TextPrompt` (sections with XML tags), `SystemPrompt` (persona-based with temperature), `ProcessPrompt` (step/decision trees). `BasePromptBuilder` handles file attachments, data sections, and output format instructions.

### Key Helpers

- **TokenSplitter** (`src/helpers/token-splitter.ts`) — Approximate token counting and text chunking with smart boundary snapping.
- **FileSystem** (`src/helpers/fs.ts`) — Scoped file operations relative to working directory.
- **AI Constants** (`src/constants/ai.ts`) — Provider enum, model lists, env key mappings.

## Code Style

- No semicolons, trailing commas, single quotes, 2-space indent, 120 char print width (Prettier)
- ESLint enforces type-only imports as separate statements and sorted imports (simple-import-sort)
- NestJS patterns: dependency injection, decorators, modular architecture
