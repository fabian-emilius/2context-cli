# 2context

> A self-maintaining, agent-ready knowledge graph for your codebase — built from Markdown, driven by CLI.

2context builds and maintains a structured knowledge base inside your repository. It extracts architectural decisions, coding conventions, recurring patterns, and design choices from your codebase and organizes them as plain Markdown files that both your team and AI coding assistants can read directly.

The knowledge graph rebalances itself automatically as it grows, stays accurate through built-in validation, and is designed to plug directly into AI agent context files like `CLAUDE.md` or `AGENTS.md`.

Git commit history is the first built-in data source — more adapters are planned.

[![npm version](https://img.shields.io/npm/v/2context.svg)](https://www.npmjs.com/package/2context)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js ≥22](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

---

## Core concepts

### Knowledge graph
Everything 2context extracts lives as plain Markdown files organized into four categories:

- **Architecture** — Module boundaries, data flow, structural decisions
- **Convention** — Code style and API design choices that aren't in a linter
- **Decision** — A specific technical choice and its rationale, captured at a point in time
- **Pattern** — A reusable solution or idiom used repeatedly across the codebase

### Two planes of output
- **Co-located files** — `KNOWLEDGE.md` files placed directly alongside the code they describe (e.g. `src/api/KNOWLEDGE.md`)
- **Central graph** — Everything organized under `.2context/knowledge/` by category and subcategory

### Self-maintaining
- **Incremental** — Only processes what's new since the last run
- **Rebalancing** — Automatically splits overfull folders into subcategories and merges underfull ones using AI clustering
- **Validation** — Detects stale knowledge items as your code evolves and removes them

### Agent-ready
2context injects a Knowledge Context section into `CLAUDE.md` or `AGENTS.md` so AI coding assistants pick up the full knowledge graph automatically. All output is plain Markdown — no special tooling required to read it.

---

## Quickstart

```bash
npm install -g 2context

cd /path/to/your-repo
2context init
```

On first run, 2context will walk you through choosing an AI provider (Anthropic, OpenAI, or Google) and entering your API key. Keys are stored in `~/.2context/keys.json` (chmod 600).

---

## Installation

**Requirements:** Node.js ≥ 22.0.0

```bash
# Install globally
npm install -g 2context

# Or run without installing
npx 2context init
```

---

## Configuration

Configuration is resolved in this order (highest priority first):

| Source | Description |
|--------|-------------|
| Environment variables | `TWOCONTEXT_PROVIDER`, `ANTHROPIC_API_KEY`, etc. |
| Config file | `~/.2context/keys.json` (created on first run) |
| Interactive wizard | Shown automatically when config is missing |

### Environment variables

```bash
# Select provider
export TWOCONTEXT_PROVIDER=anthropic   # anthropic | openai | google

# API key — set the one matching your provider
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_GENERATIVE_AI_API_KEY=...

# Optional overrides
export TWOCONTEXT_MODEL=anthropic/claude-opus-4-20250514
export TWOCONTEXT_CI=true   # Force plain-text output (no spinners/prompts)
```

### Supported providers and models

| Provider | Default model | Other options |
|----------|--------------|---------------|
| **Anthropic** | `claude-sonnet-4-20250514` | `claude-haiku-4-5`, `claude-opus-4-20250514` |
| **OpenAI** | `gpt-4o` | `gpt-4o-mini`, `o3-mini` |
| **Google** | `gemini-2.5-flash` | `gemini-2.5-pro`, `gemini-2.0-flash` |

---

## Commands

### `2context init`

First-time setup: configures your provider and runs a full initial analysis.

```
2context init [options]

  -b, --branch <name>   Branch to analyze (default: main or master)
  -v, --verbose         Verbose output
```

### `2context ingest`

Run the ingestion pipeline. Incremental by default — only processes what's new since the last run.

```
2context ingest [options]

  -b, --branch <name>       Branch to analyze
  -v, --verbose             Verbose output
  -f, --force               Wipe and reprocess everything from scratch
  -s, --source <id>         Only run a specific source adapter (e.g. git-commits)
      --no-rebalance        Skip the post-ingest rebalance step
```

### `2context status`

Show the current configuration, item counts, and source cursor positions.

```
2context status
```

Example output:
```
Configuration
  Provider:  anthropic
  Model:     claude-sonnet-4-20250514

Items by category
  Architecture:   12
  Convention:      8
  Decision:        5
  Pattern:        11
  Total:          36

Co-located files
  src/api/KNOWLEDGE.md          (7 items)
  src/auth/KNOWLEDGE.md         (4 items)
  src/database/KNOWLEDGE.md     (5 items)
```

### `2context validate`

Check stored knowledge items against their sources. Removes items whose source no longer exists or has changed beyond a staleness threshold.

```
2context validate [options]

  --dry-run      Show what would be removed without changing anything
  -v, --verbose  Print the verdict for every item
```

### `2context rebalance`

Reorganize the knowledge graph: split overfull category folders into subcategories, merge underfull ones.

```
2context rebalance [options]

  --dry-run      Show proposed changes without moving files
  -v, --verbose  Print a summary for each move
```

---

## Output structure

```
your-repo/
├── .2context/
│   ├── knowledge/
│   │   ├── KNOWLEDGE_GRAPH.md         # Full index of all items (title + summary)
│   │   ├── architecture/
│   │   │   ├── api-layer.md
│   │   │   └── database-access.md
│   │   ├── convention/
│   │   │   └── error-handling.md
│   │   ├── decision/
│   │   │   └── graphql-adoption.md
│   │   └── pattern/
│   │       └── repository-pattern.md
│   └── state.json                     # Internal cursor state (not committed)
├── src/
│   ├── api/
│   │   ├── routes.ts
│   │   └── KNOWLEDGE.md               # Co-located knowledge for this folder
│   └── database/
│       ├── client.ts
│       └── KNOWLEDGE.md
└── CLAUDE.md  (or AGENTS.md)          # Automatically updated with Knowledge Context
```

### What to commit

| Path | Commit? |
|------|---------|
| `.2context/knowledge/` | **Yes** — this is the knowledge base |
| `src/**/KNOWLEDGE.md` | **Yes** — co-located knowledge |
| `CLAUDE.md` / `AGENTS.md` | **Yes** — agent context |
| `.2context/state.json` | No — internal cursor state |
| `.2context/sources/` | No — per-adapter cursor state |

The included `.gitignore` already excludes the internal state files.

---

## Data sources

2context uses an **adapter system** to pull knowledge from different sources. Each adapter is responsible for fetching material, grouping it into logical units, and extracting knowledge items.

### git-commits (built-in)

Analyzes your git commit history:

1. **Fetch** — Reads commits since the last run (incremental) or all commits (`--force`)
2. **Group** — Clusters commits into logical feature groups (detects PR boundaries, co-changed files, conventional commit prefixes)
3. **Extract** — Sends each group's diffs to the LLM and extracts validated knowledge items
4. **Write** — Saves items to co-located `KNOWLEDGE.md` files and the central graph

Skips trivial commits (dependency bumps, merge commits, formatting-only changes). Processes up to 1000 commits per run. All LLM calls use exponential backoff retry.

### More adapters coming

The adapter interface is designed to support additional sources — pull requests, GitHub Issues, architecture docs, and more. Contributions welcome.

---

## CI usage

2context works headlessly in CI environments. Set your API key as a secret and run `2context ingest` after each merge to keep the knowledge graph up to date.

```yaml
# GitHub Actions example
- name: Update knowledge graph
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    npm install -g 2context
    2context ingest
    git add .2context/knowledge src/**/KNOWLEDGE.md CLAUDE.md
    git commit -m "chore: update knowledge graph" || true
    git push
```

---

## Contributing

Pull requests are welcome. Please open an issue first for significant changes.

```bash
git clone https://github.com/fabian-emilius/2context-cli
cd 2context-cli
npm install

# Dev mode (runs from source)
npm run start:dev -- init

# Build and run compiled output
npm run build
npm run start:prod -- status

# Lint and format
npm run lint
npm run format
```

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Fabian Emilius
