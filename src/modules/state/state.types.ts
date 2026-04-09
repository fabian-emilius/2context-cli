import type { KnowledgeItem } from '@/modules/adapters/adapter.types.js'

/**
 * Thresholds that drive the rebalance algorithm. Stored in the global state
 * file so users can tune them without touching code.
 */
export interface RebalanceConfig {
  /** A folder with more direct `.md` children than this triggers a split. */
  maxChildren: number
  /** A subcategory with fewer items than this is merged up if the parent has capacity. */
  minChildren: number
  /** A proposed cluster must have at least this many items to become a subcategory. */
  minClusterSize: number
}

export interface GlobalCounters {
  totalMaterialProcessed: number
  totalGroupsProcessed: number
  rebalanceCount: number
}

export interface GlobalState {
  version: string
  createdAt: string
  lastRunDate: string
  /** Short human-readable description of the project, shown at the top of KNOWLEDGE_GRAPH.md. */
  projectSummary: string
  config: RebalanceConfig
  items: KnowledgeItem[]
  counters: GlobalCounters
}

export const CURRENT_STATE_VERSION = '2.0.0'

export const DEFAULT_REBALANCE_CONFIG: RebalanceConfig = {
  maxChildren: 15,
  minChildren: 3,
  minClusterSize: 4,
}
