import { Injectable, Logger } from '@nestjs/common'
import { z } from 'zod'

import type { FeatureGroup } from '@/modules/adapters/git-commits/git-commits.types.js'
import { CommitGroupingSystemPrompt } from '@/modules/adapters/git-commits/prompts/grouping.system-prompt.js'
import type { AiService } from '@/modules/ai/ai.service.js'
import type { GitService } from '@/modules/git/git.service.js'
import type { CommitInfo } from '@/modules/git/git.types.js'
import { TextPrompt } from '@/prompts/text-prompt.js'

/** Max commits per AI grouping call. */
const BATCH_SIZE = 150

const CommitGroupSchema = z.object({
  groups: z.array(
    z.object({
      name: z.string().describe('Descriptive name for the feature group'),
      description: z.string().describe('Brief description of what this group of changes does'),
      commitHashes: z.array(z.string()).describe('Array of commit short hashes belonging to this group'),
      primaryFiles: z.array(z.string()).describe('Most important file paths touched by this group'),
    }),
  ),
})

@Injectable()
export class GitCommitsGroupingService {
  private readonly logger = new Logger('GitCommitsGroupingService')

  /**
   * Group commits into logical feature groups using AI.
   * Batches large sets and processes each batch independently.
   */
  public async groupCommits(ai: AiService, git: GitService, commits: CommitInfo[]): Promise<FeatureGroup[]> {
    if (commits.length === 0) return []

    if (commits.length <= BATCH_SIZE) {
      return this.groupBatch(ai, git, commits)
    }

    const allGroups: FeatureGroup[] = []
    const batches = this.createBatches(commits, BATCH_SIZE)

    this.logger.log(`Processing ${batches.length} batches of commits`)

    for (const batch of batches) {
      const batchGroups = await this.groupBatch(ai, git, batch)
      allGroups.push(...batchGroups)
    }

    return allGroups
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async groupBatch(ai: AiService, git: GitService, commits: CommitInfo[]): Promise<FeatureGroup[]> {
    const fileLists = await git.getCommitFileLists(commits.map((c) => c.hash))

    const prompt = this.buildGroupingPrompt(commits, fileLists)
    const systemPrompt = new CommitGroupingSystemPrompt()

    try {
      const response = await ai.generateStructured<z.infer<typeof CommitGroupSchema>>(
        prompt,
        systemPrompt.build().prompt,
        CommitGroupSchema,
      )

      return this.resolveGroups(response.object.groups, commits)
    } catch (error) {
      this.logger.warn(`AI grouping failed, using single group fallback: ${error}`)

      return [
        {
          name: 'All Changes',
          description: 'All commits (AI grouping unavailable)',
          commits,
          primaryFiles: this.extractPrimaryFiles(commits, fileLists),
        },
      ]
    }
  }

  private buildGroupingPrompt(commits: CommitInfo[], fileLists: Map<string, string[]>): string {
    const prompt = TextPrompt.create()

    prompt.text('Group the following commits into logical feature groups.')
    prompt.text(`Total commits: ${commits.length}`)
    prompt.emptyLine()

    prompt.text('=== COMMITS ===')
    for (const commit of commits) {
      const files = fileLists.get(commit.hash) || []
      const truncatedFiles = files.slice(0, 5)
      const suffix = files.length > 5 ? `, +${files.length - 5} more` : ''
      const fileStr = truncatedFiles.length > 0 ? ` [${truncatedFiles.join(', ')}${suffix}]` : ''
      prompt.text(`${commit.shortHash} | ${commit.date} | ${commit.author} | ${commit.message}${fileStr}`)
    }

    return prompt.build()
  }

  /**
   * Resolve AI-returned group data back to actual CommitInfo objects.
   * Each commit is assigned to at most one group.
   */
  private resolveGroups(rawGroups: z.infer<typeof CommitGroupSchema>['groups'], commits: CommitInfo[]): FeatureGroup[] {
    const commitMap = new Map<string, CommitInfo>()
    for (const commit of commits) {
      commitMap.set(commit.shortHash, commit)
      commitMap.set(commit.hash, commit)
    }

    const groups: FeatureGroup[] = []
    const assignedHashes = new Set<string>()

    for (const raw of rawGroups) {
      const resolvedCommits: CommitInfo[] = []

      for (const hash of raw.commitHashes) {
        const commit = commitMap.get(hash)
        if (commit && !assignedHashes.has(commit.hash)) {
          resolvedCommits.push(commit)
          assignedHashes.add(commit.hash)
        }
      }

      if (resolvedCommits.length > 0) {
        groups.push({
          name: raw.name,
          description: raw.description,
          commits: resolvedCommits,
          primaryFiles: raw.primaryFiles,
        })
      }
    }

    // Collect any unassigned commits
    const unassigned = commits.filter((c) => !assignedHashes.has(c.hash))
    if (unassigned.length > 0) {
      groups.push({
        name: 'Other Changes',
        description: 'Commits not matching a specific feature group',
        commits: unassigned,
        primaryFiles: [],
      })
    }

    return groups
  }

  private extractPrimaryFiles(commits: CommitInfo[], fileLists: Map<string, string[]>): string[] {
    const fileCounts = new Map<string, number>()

    for (const commit of commits) {
      const files = fileLists.get(commit.hash) || []
      for (const file of files) {
        fileCounts.set(file, (fileCounts.get(file) || 0) + 1)
      }
    }

    return [...fileCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file]) => file)
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = []

    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize))
    }

    return batches
  }
}
