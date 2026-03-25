import type { CommitInfo } from '@/modules/git/git.types.js'

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

// ── Knowledge Scope ─────────────────────────────────────────────────────────

export type KnowledgeScope =
  | { type: 'file'; filePath: string }
  | { type: 'folder'; folderPath: string }
  | { type: 'general' }

// ── Knowledge Insight ───────────────────────────────────────────────────────

export interface KnowledgeInsight {
  title: string
  category: KnowledgeCategory
  content: string
  scope: KnowledgeScope
  sourceCommits: string[]
}

// ── Commit Grouping ─────────────────────────────────────────────────────────

export interface CommitGroup {
  name: string
  description: string
  commits: CommitInfo[]
  primaryFiles: string[]
}

// ── Analysis State ──────────────────────────────────────────────────────────

export interface AnalysisState {
  version: string
  lastAnalyzedCommit: string
  lastRunDate: string
  totalCommitsAnalyzed: number
  featureGroupsProcessed: number
  knowledgeFiles: string[]
}

// ── Analysis Options ────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  branch?: string
  verbose?: boolean
  force?: boolean
}

export interface AnalysisResult {
  commitsAnalyzed: number
  featureGroups: number
  insightsGenerated: number
  knowledgeFilesWritten: string[]
  isIncremental: boolean
}
