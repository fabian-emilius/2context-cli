import { Injectable, Logger } from '@nestjs/common'
import { z } from 'zod'

import type { AiService } from '@/modules/ai/ai.service.js'
import type {
  AnalysisResult,
  AnalysisState,
  AnalyzeOptions,
  CommitGroup,
  KnowledgeInsight,
} from '@/modules/context/context.types.js'
import { KnowledgeCategory } from '@/modules/context/context.types.js'
import {
  buildInsightExtractionPrompt,
  InsightExtractionSystemPrompt,
} from '@/modules/context/prompts/analysis.system-prompt.js'
import type { GitService } from '@/modules/git/git.service.js'
import type { CommitDiff, CommitInfo } from '@/modules/git/git.types.js'
import type { GroupingService } from '@/modules/grouping/grouping.service.js'
import type { StateService } from '@/modules/state/state.service.js'
import { updateAgentFile } from '@/modules/writer/agent-file-updater.js'
import type { WriterService } from '@/modules/writer/writer.service.js'

/** Progress callback that commands can use to display status to the user. */
export type ProgressCallback = (message: string) => void

const InsightSchema = z.object({
  insights: z.array(
    z.object({
      title: z.string().describe('Concise title for the insight'),
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

/** Max parallel feature groups to analyze simultaneously. */
const CONCURRENCY_LIMIT = 3

/** Max diffs to fetch per group to limit API costs. */
const MAX_DIFFS_PER_GROUP = 10

/** Percentage threshold — skip a group if more than this ratio is trivial commits. */
const TRIVIAL_THRESHOLD = 0.8

@Injectable()
export class ContextGeneratorService {
  private readonly logger = new Logger('ContextGeneratorService')

  constructor(
    private readonly aiService: AiService,
    private readonly gitService: GitService,
    private readonly groupingService: GroupingService,
    private readonly writerService: WriterService,
    private readonly stateService: StateService,
  ) {}

  /**
   * Run the full analysis pipeline:
   *   config check → fetch commits → group → extract insights → write files → update agent file → save state.
   *
   * @param options  Branch, verbose, force flags.
   * @param onProgress  Optional callback to report progress to the calling command.
   */
  public async analyze(options: AnalyzeOptions, onProgress?: ProgressCallback): Promise<AnalysisResult> {
    const progress = onProgress || ((msg: string) => this.logger.log(msg))

    // 1. Initialize git
    await this.gitService.initialize()
    const repoInfo = await this.gitService.getRepoInfo()
    this.stateService.setRepoRoot(repoInfo.rootDir)

    // 2. Load existing state
    const existingState = options.force ? null : await this.stateService.loadState()

    // 3. Fetch commits
    const commits = await this.fetchCommits(existingState?.lastAnalyzedCommit, options.branch)

    if (commits.length === 0) {
      progress('No new commits to analyze.')
      return this.emptyResult(!!existingState)
    }

    progress(`Found ${commits.length} commits to analyze.`)

    // 4. Group commits into feature groups
    progress('Grouping commits into feature groups...')
    const groups = await this.groupingService.groupCommits(commits)
    progress(`Identified ${groups.length} feature groups.`)

    // 5. Extract insights from each group
    progress('Extracting knowledge from feature groups...')
    const allInsights = await this.extractInsightsFromGroups(groups, progress)
    progress(`Extracted ${allInsights.length} insights.`)

    // Still save state even when there are no insights — to mark commits as analyzed
    if (allInsights.length === 0) {
      await this.persistState(existingState, commits, groups.length, [])
      return {
        commitsAnalyzed: commits.length,
        featureGroups: groups.length,
        insightsGenerated: 0,
        knowledgeFilesWritten: [],
        isIncremental: !!existingState,
      }
    }

    // 6. Write knowledge files
    progress('Writing knowledge files...')
    const writtenFiles = await this.writerService.writeInsights(allInsights, repoInfo.rootDir)
    progress(`Wrote ${writtenFiles.length} files.`)

    // 7. Update CLAUDE.md / AGENTS.md
    progress('Updating agent file...')
    const totalCommits = (existingState?.totalCommitsAnalyzed || 0) + commits.length
    const agentFile = await updateAgentFile(repoInfo.rootDir, {
      commitCount: totalCommits,
      groupCount: (existingState?.featureGroupsProcessed || 0) + groups.length,
    })
    progress(`Updated ${agentFile}`)

    // 8. Save state
    await this.persistState(existingState, commits, groups.length, writtenFiles)

    return {
      commitsAnalyzed: commits.length,
      featureGroups: groups.length,
      insightsGenerated: allInsights.length,
      knowledgeFilesWritten: writtenFiles,
      isIncremental: !!existingState,
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async fetchCommits(lastAnalyzedCommit: string | undefined, branch?: string): Promise<CommitInfo[]> {
    if (lastAnalyzedCommit) {
      try {
        return await this.gitService.getCommitsSince(lastAnalyzedCommit, branch)
      } catch {
        this.logger.warn('Previous analysis state invalid. Analyzing all commits.')
      }
    }

    return this.gitService.getAllCommits(branch)
  }

  private async extractInsightsFromGroups(
    groups: CommitGroup[],
    progress: ProgressCallback,
  ): Promise<KnowledgeInsight[]> {
    const allInsights: KnowledgeInsight[] = []

    const meaningfulGroups = groups.filter((g) => !this.isTrivialGroup(g))

    if (meaningfulGroups.length < groups.length) {
      this.logger.log(
        `Skipping ${groups.length - meaningfulGroups.length} trivial groups (dependency bumps, merges, etc.)`,
      )
    }

    for (let i = 0; i < meaningfulGroups.length; i += CONCURRENCY_LIMIT) {
      const batch = meaningfulGroups.slice(i, i + CONCURRENCY_LIMIT)

      const results = await Promise.allSettled(batch.map((group) => this.extractInsightsFromGroup(group)))

      for (const result of results) {
        if (result.status === 'fulfilled') {
          allInsights.push(...result.value)
        } else {
          this.logger.warn(`Failed to analyze group: ${result.reason}`)
        }
      }

      const processed = Math.min(i + CONCURRENCY_LIMIT, meaningfulGroups.length)
      progress(`Processed ${processed}/${meaningfulGroups.length} groups...`)
    }

    return allInsights
  }

  private async extractInsightsFromGroup(group: CommitGroup): Promise<KnowledgeInsight[]> {
    const diffs = await this.getGroupDiffs(group)
    const systemPrompt = new InsightExtractionSystemPrompt()
    const userPrompt = buildInsightExtractionPrompt(group, diffs)

    try {
      const result = await this.aiService.generateStructured(
        {
          systemPrompt: systemPrompt.build().prompt,
          prompt: userPrompt,
          temperature: 0,
          maxTokens: 4000,
        },
        InsightSchema,
      )

      const validCategories = new Set<string>(Object.values(KnowledgeCategory))

      return result.insights
        .filter((raw) => raw.content.trim().length > 0)
        .map((raw) => ({
          title: raw.title,
          category: validCategories.has(raw.category) ? (raw.category as KnowledgeCategory) : KnowledgeCategory.Pattern,
          content: raw.content,
          scope: raw.scope,
          sourceCommits: raw.sourceCommitHashes,
        }))
    } catch (error) {
      this.logger.warn(`AI analysis failed for group "${group.name}": ${error}`)
      return []
    }
  }

  private async getGroupDiffs(group: CommitGroup): Promise<CommitDiff[]> {
    const diffs: CommitDiff[] = []
    const commitsToInspect = group.commits.slice(0, MAX_DIFFS_PER_GROUP)

    for (const commit of commitsToInspect) {
      try {
        const diff = await this.gitService.getCommitDiff(commit.hash)
        diffs.push(diff)
      } catch {
        // Skip commits that fail to diff (e.g., root commit edge cases)
      }
    }

    return diffs
  }

  /**
   * Returns true if the group is trivially maintenance-only and unlikely to contain insights.
   */
  private isTrivialGroup(group: CommitGroup): boolean {
    const trivialPatterns = [
      /^(chore|deps|dependabot)/i,
      /bump.*version/i,
      /update.*(lock|package)/i,
      /^merge (branch|pull request|remote)/i,
    ]

    const allMessages = group.commits.map((c) => c.message)
    const trivialCount = allMessages.filter((msg) => trivialPatterns.some((p) => p.test(msg))).length

    return trivialCount / allMessages.length > TRIVIAL_THRESHOLD
  }

  private async persistState(
    existingState: AnalysisState | null,
    commits: CommitInfo[],
    groupCount: number,
    writtenFiles: string[],
  ): Promise<void> {
    const state = existingState || this.stateService.createInitialState()

    const updatedState = this.stateService.updateState(state, {
      lastAnalyzedCommit: commits[0]?.hash || state.lastAnalyzedCommit,
      totalCommitsAnalyzed: (state.totalCommitsAnalyzed || 0) + commits.length,
      featureGroupsProcessed: (state.featureGroupsProcessed || 0) + groupCount,
      knowledgeFiles: [...new Set([...(state.knowledgeFiles || []), ...writtenFiles])],
    })

    await this.stateService.saveState(updatedState)
  }

  private emptyResult(isIncremental: boolean): AnalysisResult {
    return {
      commitsAnalyzed: 0,
      featureGroups: 0,
      insightsGenerated: 0,
      knowledgeFilesWritten: [],
      isIncremental,
    }
  }
}
