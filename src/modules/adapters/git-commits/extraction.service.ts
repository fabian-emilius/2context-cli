import path from 'node:path'

import { Inject, Injectable, Logger } from '@nestjs/common'
import { z } from 'zod'

import { slugify } from '@/helpers/slug.js'
import type { KnowledgeItem } from '@/modules/adapters/adapter.types.js'
import { KnowledgeCategory } from '@/modules/adapters/adapter.types.js'
import type { FeatureGroup } from '@/modules/adapters/git-commits/git-commits.types.js'
import {
  buildInsightExtractionPrompt,
  InsightExtractionSystemPrompt,
} from '@/modules/adapters/git-commits/prompts/analysis.system-prompt.js'
import type { AiService } from '@/modules/ai/ai.service.js'
import type { GitService } from '@/modules/git/git.service.js'
import type { CommitDiff } from '@/modules/git/git.types.js'
import { ErrorLoggerService } from '@/modules/logging/error-logger.service.js'

/** Max parallel feature groups to analyze simultaneously. */
const CONCURRENCY_LIMIT = 3

/** Max diffs to fetch per group to limit API costs. */
const MAX_DIFFS_PER_GROUP = 10

/** Percentage threshold — skip a group if more than this ratio is trivial commits. */
const TRIVIAL_THRESHOLD = 0.8

const ADAPTER_ID = 'git-commits'

const InsightSchema = z.object({
  insights: z.array(
    z.object({
      title: z.string().describe('Concise title for the insight'),
      summary: z
        .string()
        .describe('Single self-contained sentence (≤ 25 words) describing the insight, for the project index.'),
      category: z.enum(['architecture', 'convention', 'decision', 'pattern']).describe('Knowledge category'),
      content: z.string().describe('The insight written as a reusable guideline'),
      scope: z
        .discriminatedUnion('type', [
          z.object({
            type: z.literal('file'),
            filePath: z.string().describe('Path to the specific file'),
          }),
          z.object({
            type: z.literal('folder'),
            folderPath: z.string().describe('Path to the folder/module'),
          }),
          z.object({
            type: z.literal('general'),
          }),
        ])
        .describe('Where this knowledge applies'),
      sourceCommitHashes: z.array(z.string()).describe('Short hashes of commits that demonstrate this'),
    }),
  ),
})

type RawInsight = z.infer<typeof InsightSchema>['insights'][number]

export interface ExtractionStats {
  groupsProcessed: number
}

@Injectable()
export class GitCommitsExtractionService {
  private readonly logger = new Logger('GitCommitsExtractionService')

  constructor(@Inject(ErrorLoggerService) private readonly errorLogger: ErrorLoggerService) {}

  /**
   * Extract knowledge items from feature groups. Runs extraction for
   * non-trivial groups with bounded concurrency, fetches diffs per group,
   * and returns finished `KnowledgeItem` objects with sources stamped.
   */
  public async extractFromGroups(
    ai: AiService,
    git: GitService,
    groups: FeatureGroup[],
    onProgress: (message: string) => void,
  ): Promise<{ items: KnowledgeItem[]; stats: ExtractionStats }> {
    const allItems: KnowledgeItem[] = []

    const meaningfulGroups = groups.filter((g) => !this.isTrivialGroup(g))

    if (meaningfulGroups.length < groups.length) {
      this.logger.log(
        `Skipping ${groups.length - meaningfulGroups.length} trivial groups (dependency bumps, merges, etc.)`,
      )
    }

    onProgress(`extracting insights (0/${meaningfulGroups.length} groups)`)

    for (let i = 0; i < meaningfulGroups.length; i += CONCURRENCY_LIMIT) {
      const batch = meaningfulGroups.slice(i, i + CONCURRENCY_LIMIT)

      const results = await Promise.allSettled(batch.map((group) => this.extractFromGroup(ai, git, group)))

      for (let idx = 0; idx < results.length; idx++) {
        const result = results[idx]
        if (result.status === 'fulfilled') {
          allItems.push(...result.value)
        } else {
          await this.errorLogger.warn(
            'GitCommitsExtractionService',
            `Group analysis rejected for "${batch[idx].name}"`,
            result.reason,
          )
        }
      }

      const processed = Math.min(i + CONCURRENCY_LIMIT, meaningfulGroups.length)
      onProgress(`extracting insights (${processed}/${meaningfulGroups.length} groups)`)
    }

    return { items: allItems, stats: { groupsProcessed: meaningfulGroups.length } }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async extractFromGroup(ai: AiService, git: GitService, group: FeatureGroup): Promise<KnowledgeItem[]> {
    const diffs = await this.getGroupDiffs(git, group)
    const systemPrompt = new InsightExtractionSystemPrompt()
    const userPrompt = buildInsightExtractionPrompt(group, diffs)

    try {
      const response = await ai.generateStructured<z.infer<typeof InsightSchema>>(
        userPrompt,
        systemPrompt.build().prompt,
        InsightSchema,
      )

      const now = new Date().toISOString()
      const validCategories = new Set<string>(Object.values(KnowledgeCategory))

      return response.object.insights
        .filter((raw) => raw.content.trim().length > 0 && raw.title.trim().length > 0)
        .map((raw) => this.rawToKnowledgeItem(raw, validCategories, now))
    } catch (error) {
      await this.errorLogger.warn('GitCommitsExtractionService', `AI analysis failed for group "${group.name}"`, error)
      return []
    }
  }

  private rawToKnowledgeItem(raw: RawInsight, validCategories: Set<string>, timestamp: string): KnowledgeItem {
    const category = validCategories.has(raw.category) ? (raw.category as KnowledgeCategory) : KnowledgeCategory.Pattern

    const id = slugify(raw.title)
    const sources = raw.sourceCommitHashes.map((hash) => `${ADAPTER_ID}:${hash}`)
    const relatedFiles = this.scopeRelatedFiles(raw)
    const writtenPath = this.computeInitialWrittenPath(raw, category, id)

    return {
      id,
      title: raw.title,
      summary: raw.summary.trim(),
      content: raw.content,
      category,
      subcategoryPath: [],
      scope: raw.scope,
      sources,
      relatedFiles,
      writtenPath,
      firstSeen: timestamp,
      lastValidated: timestamp,
      staleCount: 0,
    }
  }

  private scopeRelatedFiles(raw: RawInsight): string[] {
    if (raw.scope.type === 'file') return [raw.scope.filePath]
    if (raw.scope.type === 'folder') return [raw.scope.folderPath]
    return []
  }

  /**
   * Compute the initial `writtenPath` based on scope + category.
   * Rebalance may later move general-scope items into subcategories.
   * Path is relative to the repository root.
   */
  private computeInitialWrittenPath(raw: RawInsight, category: KnowledgeCategory, id: string): string {
    if (raw.scope.type === 'file') {
      const dir = path.dirname(raw.scope.filePath)
      return path.join(dir, 'KNOWLEDGE.md')
    }

    if (raw.scope.type === 'folder') {
      return path.join(raw.scope.folderPath, 'KNOWLEDGE.md')
    }

    return path.join('.2context', 'graph', category, `${id}.md`)
  }

  private async getGroupDiffs(git: GitService, group: FeatureGroup): Promise<CommitDiff[]> {
    const diffs: CommitDiff[] = []
    const commitsToInspect = group.commits.slice(0, MAX_DIFFS_PER_GROUP)

    for (const commit of commitsToInspect) {
      try {
        const diff = await git.getCommitDiff(commit.hash)
        diffs.push(diff)
      } catch {
        // Skip commits that fail to diff (e.g., root commit edge cases)
      }
    }

    return diffs
  }

  /**
   * True if the group is overwhelmingly maintenance-only and unlikely to contain insights.
   */
  private isTrivialGroup(group: FeatureGroup): boolean {
    const trivialPatterns = [
      /^(chore|deps|dependabot)/i,
      /bump.*version/i,
      /update.*(lock|package)/i,
      /^merge (branch|pull request|remote)/i,
    ]

    const allMessages = group.commits.map((c) => c.message)
    if (allMessages.length === 0) return true

    const trivialCount = allMessages.filter((msg) => trivialPatterns.some((p) => p.test(msg))).length

    return trivialCount / allMessages.length > TRIVIAL_THRESHOLD
  }
}
