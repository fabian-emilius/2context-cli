import path from 'node:path'

import { Inject, Injectable } from '@nestjs/common'

import { FileSystem } from '@/helpers/fs.js'
import type {
  AdapterContext,
  AdapterIngestCounters,
  IngestOptions,
  KnowledgeItem,
  SourceAdapter,
  ValidationVerdict,
} from '@/modules/adapters/adapter.types.js'
import { GitCommitsExtractionService } from '@/modules/adapters/git-commits/extraction.service.js'
import type { GitCommitsConfig, GitCommitsState } from '@/modules/adapters/git-commits/git-commits.types.js'
import {
  DEFAULT_GIT_COMMITS_CONFIG,
  GIT_COMMITS_STATE_VERSION,
  PROCESSED_HASH_CAP,
} from '@/modules/adapters/git-commits/git-commits.types.js'
import { GitCommitsGroupingService } from '@/modules/adapters/git-commits/grouping.service.js'
import { ErrorLoggerService } from '@/modules/logging/error-logger.service.js'
import type { SpinnerHandle } from '@/ui/terminal-ui.js'

const STATE_FILE = 'state.json'

@Injectable()
export class GitCommitsAdapter implements SourceAdapter<GitCommitsState> {
  public readonly id = 'git-commits'
  public readonly label = 'Git commits'

  private stateDir: string | null = null

  constructor(
    @Inject(GitCommitsGroupingService) private readonly grouping: GitCommitsGroupingService,
    @Inject(GitCommitsExtractionService) private readonly extraction: GitCommitsExtractionService,
    @Inject(ErrorLoggerService) private readonly errorLogger: ErrorLoggerService,
  ) {}

  public setStateDir(dir: string): void {
    this.stateDir = dir
  }

  public async loadState(): Promise<GitCommitsState> {
    const fs = this.requireFs()
    const raw = await fs.readFileOrNull(STATE_FILE)

    if (!raw) return this.seedState()

    try {
      const parsed = JSON.parse(raw) as GitCommitsState
      return {
        ...this.seedState(),
        ...parsed,
        config: { ...DEFAULT_GIT_COMMITS_CONFIG, ...(parsed.config || {}) },
      }
    } catch (error) {
      await this.errorLogger.warn('GitCommitsAdapter', 'Failed to parse git-commits state, seeding fresh state', error)
      return this.seedState()
    }
  }

  public async saveState(state: GitCommitsState): Promise<void> {
    const fs = this.requireFs()
    await fs.writeFileWithDir(STATE_FILE, JSON.stringify(state, null, 2))
  }

  public async hasUpdates(state: GitCommitsState, ctx: AdapterContext): Promise<boolean> {
    const commits = await this.fetchCommits(state, ctx)
    return commits.length > 0
  }

  public async ingest(
    state: GitCommitsState,
    ctx: AdapterContext,
    _opts: IngestOptions,
  ): Promise<{ items: KnowledgeItem[]; updatedState: GitCommitsState; counters: AdapterIngestCounters }> {
    let activeSpinner: SpinnerHandle | null = null
    try {
      activeSpinner = ctx.ui.spinner('[git-commits] fetching commits...')
      const commits = await this.fetchCommits(state, ctx)

      if (commits.length === 0) {
        activeSpinner.succeed('[git-commits] no new commits to analyze')
        activeSpinner = null
        return {
          items: [],
          updatedState: { ...state, lastRun: new Date().toISOString() },
          counters: { itemsProduced: 0, materialProcessed: 0, groupsProcessed: 0 },
        }
      }

      activeSpinner.succeed(`[git-commits] fetched ${commits.length} commits`)
      activeSpinner = null

      // Grouping
      activeSpinner = ctx.ui.spinner('[git-commits] grouping into features...')
      const groupingSpinner = activeSpinner
      const groups = await this.grouping.groupCommits(ctx.ai, ctx.git, commits, (msg) =>
        groupingSpinner.update(`[git-commits] ${msg}`),
      )
      activeSpinner.succeed(`[git-commits] ${groups.length} feature groups identified`)
      activeSpinner = null

      // Extraction
      activeSpinner = ctx.ui.spinner('[git-commits] extracting insights...')
      const extractionSpinner = activeSpinner
      const { items, stats } = await this.extraction.extractFromGroups(ctx.ai, ctx.git, groups, (msg) =>
        extractionSpinner.update(`[git-commits] ${msg}`),
      )
      activeSpinner.succeed(`[git-commits] extracted ${items.length} knowledge items`)
      activeSpinner = null

      // Update state
      const processedNow = commits.map((c) => c.hash)
      const mergedHashes = this.capHashes([...processedNow, ...state.processedHashes])
      const newCursor = commits[0]?.hash ?? state.cursor

      const updatedState: GitCommitsState = {
        ...state,
        cursor: newCursor,
        processedHashes: mergedHashes,
        lastRun: new Date().toISOString(),
        totalItemsExtracted: state.totalItemsExtracted + items.length,
      }

      return {
        items,
        updatedState,
        counters: {
          itemsProduced: items.length,
          materialProcessed: commits.length,
          groupsProcessed: stats.groupsProcessed,
        },
      }
    } catch (error) {
      if (activeSpinner) {
        activeSpinner.fail(`[git-commits] failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      throw error
    }
  }

  public async validateItem(item: KnowledgeItem, ctx: AdapterContext): Promise<ValidationVerdict> {
    // Check referenced files still exist under the repo root.
    for (const relatedFile of item.relatedFiles) {
      const abs = path.join(ctx.repoRoot, relatedFile)
      const exists = await this.pathExists(abs)
      if (!exists) {
        // A folder path may end without a trailing file — tolerate that if the folder itself exists.
        const fallback = path.resolve(ctx.repoRoot, relatedFile)
        if (!(await this.pathExists(fallback))) {
          return 'invalid'
        }
      }
    }

    // Check each source commit is reachable.
    for (const source of item.sources) {
      if (!source.startsWith(`${this.id}:`)) continue
      const hash = source.slice(this.id.length + 1)
      const reachable = await this.isCommitReachable(ctx, hash)
      if (!reachable) return 'stale'
    }

    return 'valid'
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private requireFs(): FileSystem {
    if (!this.stateDir) {
      throw new Error('GitCommitsAdapter.setStateDir() was not called before use.')
    }
    return new FileSystem(this.stateDir)
  }

  private seedState(): GitCommitsState {
    return {
      version: GIT_COMMITS_STATE_VERSION,
      cursor: null,
      processedHashes: [],
      lastRun: new Date().toISOString(),
      totalItemsExtracted: 0,
      config: { ...DEFAULT_GIT_COMMITS_CONFIG },
    }
  }

  /**
   * Fetch commits since the cursor (or all if no cursor), filtering out anything
   * already in `processedHashes` and anything matching `skipPatterns`.
   */
  private async fetchCommits(state: GitCommitsState, ctx: AdapterContext) {
    const branch = state.config.branch ?? undefined
    const processed = new Set(state.processedHashes)

    const raw = state.cursor
      ? await this.safeCommitsSince(ctx, state.cursor, branch)
      : await ctx.git.getAllCommits(branch)

    const limited = raw.slice(0, state.config.maxCommits)

    return limited.filter((c) => !processed.has(c.hash) && !this.isSkippable(c.message, state.config))
  }

  private async safeCommitsSince(ctx: AdapterContext, since: string, branch?: string) {
    try {
      return await ctx.git.getCommitsSince(since, branch)
    } catch (error) {
      await this.errorLogger.warn('GitCommitsAdapter', 'Previous cursor invalid, falling back to full history', error)
      return ctx.git.getAllCommits(branch)
    }
  }

  private isSkippable(message: string, config: GitCommitsConfig): boolean {
    if (message.length < config.minMessageLength) return true
    return config.skipPatterns.some((pattern) => {
      try {
        return new RegExp(pattern).test(message)
      } catch {
        return false
      }
    })
  }

  private capHashes(hashes: string[]): string[] {
    const seen = new Set<string>()
    const capped: string[] = []
    for (const h of hashes) {
      if (seen.has(h)) continue
      seen.add(h)
      capped.push(h)
      if (capped.length >= PROCESSED_HASH_CAP) break
    }
    return capped
  }

  private async pathExists(absPath: string): Promise<boolean> {
    const fs = new FileSystem('/')
    return fs.pathExists(absPath)
  }

  private async isCommitReachable(ctx: AdapterContext, hash: string): Promise<boolean> {
    try {
      await ctx.git.getCommitDiff(hash)
      return true
    } catch {
      return false
    }
  }
}
