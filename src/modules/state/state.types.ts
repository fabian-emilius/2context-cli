import type { KnowledgeItem } from '@/modules/adapters/adapter.types.js'

/**
 * Thresholds that drive the self-balancing index.
 * Stored in the global state file so users can tune them without touching code.
 */
export interface RebalanceConfig {
  /** A leaf with more items than this gets split. */
  maxItemsPerLeaf: number
  /** A leaf whose rendered file exceeds this byte size gets split. */
  maxLeafBytes: number
  /** A leaf with fewer items than this is a candidate for merging with a sibling. */
  minItemsPerLeaf: number
  /** A branch with more direct children than this triggers a child-clustering split. */
  maxChildrenPerBranch: number
  /** A branch with fewer direct children than this is a candidate for collapse. */
  minChildrenPerBranch: number
  /** A proposed cluster must have at least this many items/children to be promoted. */
  minClusterSize: number
}

export interface GlobalCounters {
  totalMaterialProcessed: number
  totalGroupsProcessed: number
  rebalanceCount: number
}

/** Kind of node in the persisted index tree. */
export type GraphNodeKind = 'leaf' | 'branch'

/**
 * A node in the self-balancing index tree.
 *
 * - `leaf` nodes correspond to a single `.md` file holding multiple `KnowledgeItem` sections.
 * - `branch` nodes correspond to a directory with an `_index.md` and one or more children.
 *
 * The four root branches (one per `KnowledgeCategory`) are pre-created by `StateService`
 * and have `parentId === null`.
 */
export interface GraphNode {
  /** Stable id; for branches this is `<category>` or `<parentId>__<segment>`, for leaves `<segment>`. */
  id: string
  kind: GraphNodeKind
  /** Path segment (folder name for branches, file slug without extension for leaves). */
  segment: string
  /** Path relative to the repo root. Branch: directory; leaf: `.md` file. */
  path: string
  parentId: string | null
  /** LLM-generated 1-2 sentence overview used for navigation. */
  summary: string
  /** Topical tags used for human navigation; never load-bearing for routing logic. */
  keywords: string[]
  /** ISO timestamp of the last summary regeneration. Empty string means never. */
  summaryUpdatedAt: string
  /** Leaf only: ids of `KnowledgeItem`s grouped into this leaf file. */
  itemIds?: string[]
  /** Branch only: ids of direct child nodes (leaves or branches). */
  childIds?: string[]
}

/**
 * The persisted index tree. `rootIds` maps each root category to its branch node id.
 * `nodes` is a flat lookup keyed by node id.
 */
export interface GraphTree {
  rootIds: Record<string, string>
  nodes: Record<string, GraphNode>
}

export interface GlobalState {
  version: string
  createdAt: string
  lastRunDate: string
  /** Short human-readable description of the project, shown at the top of KNOWLEDGE_GRAPH.md. */
  projectSummary: string
  config: RebalanceConfig
  items: KnowledgeItem[]
  /** Self-balancing index tree over the central graph (general-scope items). */
  graphTree: GraphTree
  counters: GlobalCounters
}

export const CURRENT_STATE_VERSION = '3.0.0'

export const DEFAULT_REBALANCE_CONFIG: RebalanceConfig = {
  maxItemsPerLeaf: 8,
  maxLeafBytes: 16_000,
  minItemsPerLeaf: 2,
  maxChildrenPerBranch: 12,
  minChildrenPerBranch: 3,
  minClusterSize: 3,
}
