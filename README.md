# 2context

> A file-based knowledge graph for coding agents. Extracts decisions, conventions, and patterns from your git history and writes them as plain Markdown files that agents like Claude Code read directly.

[![npm version](https://img.shields.io/npm/v/2context.svg)](https://www.npmjs.com/package/2context)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js ≥22](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

---

## What it is

A CLI that builds and maintains a Markdown knowledge graph in your repo.

Coding agents are stateless: they re-derive your conventions every session. 2context processes that context once (currently from your git commit history), classifies it, and writes it to disk where the agent can grep and read it with the tools it already has. No MCP server, no daemon, no API.

Output is plain files committed alongside your code:

* **`.2context/KNOWLEDGE_GRAPH.md`** is the entry point. The agent is instructed to read this first.
* **`.2context/graph/{category}/`** holds the central knowledge as a self-balancing tree, organized into four categories: `architecture`, `convention`, `decision`, `pattern`. Each folder contains an `_index.md` summarizing its children, plus leaf `.md` files that group related findings together.
* **`KNOWLEDGE.md`** files sit next to the source folders they describe (e.g. `src/auth/KNOWLEDGE.md`).
* A `## Knowledge Context` section is added to `CLAUDE.md` or `AGENTS.md` pointing the agent at the index.

---

## Sources

The current build ships with **one adapter: `git-commits`**. The pipeline is built around a generic adapter interface, so additional sources can feed the same graph without changing how the agent consumes it. Pull requests, ADRs, issue threads, and custom sources are on the roadmap.

---

## Quickstart

```bash
npm install -g 2context
cd /path/to/your-repo
2context init
```

First run walks you through provider selection (Anthropic, OpenAI, or Google) and API key entry, then ingests your full history. Keys are stored in `~/.2context/keys.json` (chmod 600).

After the first run, use `2context ingest` to pick up new commits incrementally.

---

## How it works

Each `ingest` run goes through these phases:

1. **Fetch.** Read commits since the last cursor (or all commits with `--force`). Skip merges, dependency bumps, and formatting-only diffs.
2. **Cluster and extract.** An LLM groups related commits into feature units, then reads the diffs and produces `KnowledgeItem`s with category, summary, content, and source provenance (commit SHAs, files touched).
3. **Insert into the index.** Each general-scope item is routed top-down through the central tree by an LLM at every branch — using each child's summary to pick the next hop, or to create a new sibling when nothing fits. The item lands in a leaf `.md` file alongside other related findings. Co-located items go straight to the matching source-tree `KNOWLEDGE.md`.
4. **Self-balance on insert.** After each insertion, the index walks back up to the root: leaves that exceed the per-leaf threshold (item count or rendered byte size) are split into topical sibling leaves; branches that exceed the per-branch child cap are split into intermediate sub-branches. Every touched node has its summary regenerated so subsequent routing stays accurate. The standalone `2context rebalance` command runs the same checks across the whole tree on demand.
5. **Update agent file.** The `## Knowledge Context` section in `CLAUDE.md` / `AGENTS.md` is regenerated, telling the agent to read `.2context/KNOWLEDGE_GRAPH.md` before starting any task.

State for each adapter lives in `.2context/sources/{adapter-id}/state.json` so the next run only processes what is new.

---

## Commands

### `2context init`

Configure the AI provider, scaffold `.2context/`, and run the first ingest.

```
-b, --branch <name>   Branch to analyze (default: main/master)
-v, --verbose         Verbose output
```

### `2context ingest`

Run the ingestion pipeline. Incremental by default.

```
-b, --branch <name>   Branch to analyze
-f, --force           Wipe items and reprocess from scratch
-s, --source <id>     Run a single adapter only (e.g. git-commits)
    --no-rebalance    Skip the post-ingest rebalance step
-v, --verbose         Verbose output
```

### `2context status`

Print configuration, item counts per category, source cursor positions, and co-located files.

### `2context validate`

Check stored items against their sources. For `git-commits`, this verifies referenced files still exist and source commits are reachable. Items get marked stale on a miss and removed after two consecutive stale verdicts. Rebuilds the index on completion.

```
--dry-run    Report removals without writing
-v, --verbose
```

### `2context rebalance`

Sweep the entire central tree: re-cluster overfull leaves and branches, regenerate every node's summary. The index already self-balances on every insert during `ingest`; this command is for manual reorganization, e.g. after threshold changes.

```
--dry-run    Show proposed splits/merges without changing anything
-v, --verbose
```

---

## Output structure

```
your-repo/
├── .2context/
│   ├── KNOWLEDGE_GRAPH.md             # Entry point. Agent reads this first.
│   ├── graph/
│   │   ├── architecture/
│   │   │   ├── _index.md              # Folder summary + child outline
│   │   │   ├── api-design/            # Sub-branch created on insert when siblings cluster
│   │   │   │   ├── _index.md
│   │   │   │   └── versioning.md      # Leaf — multiple findings grouped by topic
│   │   │   └── caching.md             # Leaf — sits directly under architecture/
│   │   ├── convention/
│   │   │   └── _index.md
│   │   ├── decision/
│   │   │   └── _index.md
│   │   └── pattern/
│   │       └── _index.md
│   └── sources/
│       └── git-commits/state.json     # Cursor (gitignored)
├── src/
│   ├── auth/
│   │   ├── KNOWLEDGE.md               # Co-located items for this folder
│   │   └── jwt.ts
│   └── db/
│       └── KNOWLEDGE.md
└── CLAUDE.md                          # Auto-updated Knowledge Context section
```

Every `_index.md` and leaf `.md` carries YAML frontmatter (id, summary, keywords, parent, children/items) so a navigating agent can drill down a level at a time using only summaries — no need to read the full graph.

**Commit:** `.2context/KNOWLEDGE_GRAPH.md`, `.2context/graph/`, `src/**/KNOWLEDGE.md`, `CLAUDE.md` / `AGENTS.md`.
**Don't commit:** `.2context/sources/` (cursor state, already gitignored).

---

## Configuration

Resolution order: env vars → `~/.2context/keys.json` → interactive wizard.

```bash
export TWOCONTEXT_PROVIDER=anthropic        # anthropic | openai | google
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_GENERATIVE_AI_API_KEY=...

# Optional
export TWOCONTEXT_MODEL=anthropic/claude-opus-4-7
export TWOCONTEXT_CI=true                   # plain-text output, no prompts
```

| Provider | Default | Other models |
|----------|---------|--------------|
| Anthropic | `claude-sonnet-4-6` | `claude-haiku-4-5`, `claude-opus-4-7` |
| OpenAI | `gpt-4o` | `gpt-4o-mini`, `o3-mini` |
| Google | `gemini-2.5-flash` | `gemini-2.5-pro`, `gemini-2.0-flash` |

---

## CI usage

```yaml
- name: Update knowledge graph
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    npm install -g 2context
    2context ingest
    git add .2context CLAUDE.md src/**/KNOWLEDGE.md
    git commit -m "chore: update knowledge graph" || true
    git push
```

---

## Contributing

```bash
git clone https://github.com/fabian-emilius/2context-cli
cd 2context-cli
npm install
npm run start:dev -- init        # dev mode (tsx)
npm run build && npm run start:prod -- status
npm run lint && npm run format
```

Pull requests welcome. Open an issue first for significant changes, especially new adapters.

---

[MIT](./LICENSE) · Copyright (c) 2026 Fabian Emilius
