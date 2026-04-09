import type { CommitInfo } from '@/modules/git/git.types.js'

export interface GitCommitsConfig {
  branch: string | null
  maxCommits: number
  minMessageLength: number
  skipPatterns: string[]
}

export interface GitCommitsState {
  version: string
  cursor: string | null
  /** Most recent N commit hashes we've processed. FIFO-capped to PROCESSED_CAP. */
  processedHashes: string[]
  lastRun: string
  totalItemsExtracted: number
  config: GitCommitsConfig
}

export const GIT_COMMITS_STATE_VERSION = '1.0.0'
export const PROCESSED_HASH_CAP = 5000

export const DEFAULT_GIT_COMMITS_CONFIG: GitCommitsConfig = {
  branch: null,
  maxCommits: 1000,
  minMessageLength: 0,
  skipPatterns: ['^chore\\(deps\\):', '^Merge branch', '^Merge pull request', '^formatting:'],
}

/** A group of commits identified as a cohesive feature/change-set. */
export interface FeatureGroup {
  name: string
  description: string
  commits: CommitInfo[]
  primaryFiles: string[]
}
