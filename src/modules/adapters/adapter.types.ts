import type { AiService } from '@/modules/ai/ai.service.js'
import type { GitService } from '@/modules/git/git.service.js'
import type { TerminalUI } from '@/ui/terminal-ui.js'

// ── Knowledge Categories ────────────────────────────────────────────────────

export enum KnowledgeCategory {
  Architecture = 'architecture',
  Convention = 'convention',
  Decision = 'decision',
  Pattern = 'pattern',
}

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  [KnowledgeCategory.Architecture]: 'Architecture',
  [KnowledgeCategory.Convention]: 'Convention',
  [KnowledgeCategory.Decision]: 'Decision',
  [KnowledgeCategory.Pattern]: 'Pattern',
}

export const KNOWLEDGE_CATEGORY_DESCRIPTIONS: Record<KnowledgeCategory, string> = {
  [KnowledgeCategory.Architecture]:
    'Software architecture and design patterns — system design, module structure, data flow, component boundaries',
  [KnowledgeCategory.Convention]:
    'Coding standards and style rules — naming conventions, file organization, import patterns, error handling approaches',
  [KnowledgeCategory.Decision]:
    'Technical decisions with rationale — why X was chosen over Y, trade-offs considered, what was tried and what worked',
  [KnowledgeCategory.Pattern]:
    'Recurring implementation patterns — common approaches used across the codebase, established ways of solving specific problems',
}

export const ROOT_CATEGORIES: KnowledgeCategory[] = [
  KnowledgeCategory.Architecture,
  KnowledgeCategory.Convention,
  KnowledgeCategory.Decision,
  KnowledgeCategory.Pattern,
]

// ── Knowledge Scope ─────────────────────────────────────────────────────────

export type KnowledgeScope =
  | { type: 'file'; filePath: string }
  | { type: 'folder'; folderPath: string }
  | { type: 'general' }

// ── Knowledge Item ──────────────────────────────────────────────────────────

/**
 * A single piece of extracted knowledge. Produced by an adapter's ingest
 * pipeline with every field populated; the writer and rebalance services
 * may later update `subcategoryPath`, `writtenPath`, and `lastValidated`.
 */
export interface KnowledgeItem {
  /** Stable slug derived from the title. Used as filename and dedup key. */
  id: string
  title: string
  /** Single-sentence summary suitable for index display. */
  summary: string
  content: string
  category: KnowledgeCategory
  /** Dynamic path below the root category, possibly empty. Rebalance may mutate. */
  subcategoryPath: string[]
  scope: KnowledgeScope
  /** Provenance: "<adapter-id>:<ref>" strings, e.g. "git-commits:abc1234". */
  sources: string[]
  /** Files referenced by this item; used for validation and display. */
  relatedFiles: string[]
  /** Current location on disk (relative to repo root). Rebalance may mutate. */
  writtenPath: string
  firstSeen: string
  lastValidated: string
  staleCount: number
}

// ── Adapter Context ─────────────────────────────────────────────────────────

/**
 * Shared services handed to adapters during ingestion and validation.
 * Adapters should not construct these themselves.
 */
export interface AdapterContext {
  readonly ai: AiService
  readonly git: GitService
  readonly ui: TerminalUI
  /** Absolute path to the repo root, used for resolving relative paths. */
  readonly repoRoot: string
}

// ── Ingest Options ──────────────────────────────────────────────────────────

export interface IngestOptions {
  branch?: string
  verbose?: boolean
  /** If true, the adapter should process all material regardless of cursor. */
  full?: boolean
}

// ── Validation verdict ──────────────────────────────────────────────────────

export type ValidationVerdict = 'valid' | 'stale' | 'invalid'

// ── Source Adapter ──────────────────────────────────────────────────────────

/**
 * Interface every knowledge source must implement. Each adapter owns its
 * own state folder under `.2context/sources/{id}/` and the entire ingestion
 * pipeline for its source type — fetching material, grouping, LLM extraction,
 * and producing finished `KnowledgeItem` objects.
 */
export interface SourceAdapter<TState = unknown> {
  readonly id: string
  readonly label: string

  /** Absolute path to `.2context/sources/{id}/` — set by the pipeline. */
  setStateDir(dir: string): void

  /** Load this adapter's state.json, or return a seeded initial state if missing. */
  loadState(): Promise<TState>

  /** Persist this adapter's state.json. */
  saveState(state: TState): Promise<void>

  /** Fast check whether there is any new material to process. */
  hasUpdates(state: TState, ctx: AdapterContext): Promise<boolean>

  /**
   * Fetch new material, group and extract it, return finished KnowledgeItem
   * objects with every field populated. The adapter is responsible for
   * advancing its own state and returning the updated state.
   */
  ingest(
    state: TState,
    ctx: AdapterContext,
    opts: IngestOptions,
  ): Promise<{ items: KnowledgeItem[]; updatedState: TState; counters: AdapterIngestCounters }>

  /** Per-item staleness check used by the validator. */
  validateItem(item: KnowledgeItem, ctx: AdapterContext): Promise<ValidationVerdict>
}

export interface AdapterIngestCounters {
  itemsProduced: number
  /** Source-specific count, e.g. number of commits processed for git-commits. */
  materialProcessed: number
  /** Source-specific count, e.g. number of feature groups for git-commits. */
  groupsProcessed: number
}
