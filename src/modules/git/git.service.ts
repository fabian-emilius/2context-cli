import path from 'node:path'

import { Injectable, Logger } from '@nestjs/common'
import type { SimpleGit } from 'simple-git'
import simpleGit from 'simple-git'

import type { CommitDiff, CommitInfo, FileDiff, RepoInfo } from '@/modules/git/git.types.js'

@Injectable()
export class GitService {
  private readonly logger = new Logger('GitService')

  private git: SimpleGit | null = null
  private repoRoot: string | null = null

  /**
   * Initialize the git client for the given working directory (defaults to cwd).
   */
  public async initialize(cwd?: string): Promise<void> {
    const workDir = cwd || process.cwd()
    this.git = simpleGit(workDir)

    const isRepo = await this.git.checkIsRepo()
    if (!isRepo) {
      throw new Error(`Not a git repository: ${workDir}`)
    }

    this.repoRoot = await this.git.revparse(['--show-toplevel'])
    this.logger.log(`Initialized for repository at ${this.repoRoot}`)
  }

  private getGit(): SimpleGit {
    if (!this.git) {
      throw new Error('GitService not initialized. Call initialize() first.')
    }
    return this.git
  }

  /**
   * Get basic info about the current repository.
   */
  public async getRepoInfo(): Promise<RepoInfo> {
    const git = this.getGit()

    const branch = await git.revparse(['--abbrev-ref', 'HEAD'])

    let remoteUrl: string | null = null
    try {
      const remotes = await git.getRemotes(true)
      const origin = remotes.find((r) => r.name === 'origin')
      remoteUrl = origin?.refs?.fetch || null
    } catch {
      // No remotes configured
    }

    const rootDir = this.repoRoot || process.cwd()
    const name = path.basename(rootDir) || 'unknown'

    return { rootDir, currentBranch: branch.trim(), remoteUrl, name }
  }

  /**
   * Get the N most recent commits from a branch.
   */
  public async getRecentCommits(count: number = 50, branch?: string): Promise<CommitInfo[]> {
    const git = this.getGit()

    const logArgs = ['--format=%H|%h|%an|%aI|%s', `-${count}`]
    if (branch) {
      logArgs.push(branch)
    }

    const result = await git.raw(['log', ...logArgs])

    return this.parseCommitLog(result)
  }

  /**
   * Get the full diff for a single commit, including file stats and patch content.
   */
  public async getCommitDiff(commitHash: string): Promise<CommitDiff> {
    const git = this.getGit()

    const logResult = await git.raw(['log', '--format=%H|%h|%an|%aI|%s', '-1', commitHash])
    const commit = this.parseCommitLine(logResult.trim())

    // Use diff-tree which natively supports --root for the initial commit
    const diffStatResult = await git
      .raw(['diff-tree', '--no-commit-id', '-r', '--numstat', commitHash])
      .catch(() => git.raw(['diff-tree', '--no-commit-id', '-r', '--numstat', '--root', commitHash]))

    const files: FileDiff[] = []

    for (const line of diffStatResult.trim().split('\n').filter(Boolean)) {
      const [addStr, delStr, ...filenameParts] = line.split('\t')
      const filename = filenameParts.join('\t')
      const binary = addStr === '-'

      let diff: string | null = null
      if (!binary) {
        try {
          diff = await git
            .raw(['diff', `${commitHash}~1`, commitHash, '--', filename])
            .catch(() => git.raw(['show', '--format=', commitHash, '--', filename]))
        } catch {
          // Skip files that fail to diff
        }
      }

      files.push({
        filename,
        additions: binary ? 0 : parseInt(addStr, 10),
        deletions: binary ? 0 : parseInt(delStr, 10),
        binary,
        diff,
      })
    }

    return { commit, files }
  }

  /**
   * Get commits in a range (exclusive of `fromHash`).
   */
  public async getCommitRange(fromHash: string, toHash: string): Promise<CommitInfo[]> {
    const git = this.getGit()

    const result = await git.raw(['log', '--format=%H|%h|%an|%aI|%s', `${fromHash}..${toHash}`])

    return this.parseCommitLog(result)
  }

  /**
   * Get the raw unified diff between two commits.
   */
  public async getDiffBetween(fromHash: string, toHash: string): Promise<string> {
    const git = this.getGit()
    return git.raw(['diff', fromHash, toHash])
  }

  /**
   * Get file change statistics between two commits (no patch content).
   */
  public async getFilesChanged(fromHash: string, toHash: string): Promise<FileDiff[]> {
    const git = this.getGit()

    const diffStatResult = await git.raw(['diff', '--numstat', fromHash, toHash])
    const files: FileDiff[] = []

    for (const line of diffStatResult.trim().split('\n').filter(Boolean)) {
      const [addStr, delStr, ...filenameParts] = line.split('\t')
      const filename = filenameParts.join('\t')
      const binary = addStr === '-'

      files.push({
        filename,
        additions: binary ? 0 : parseInt(addStr, 10),
        deletions: binary ? 0 : parseInt(delStr, 10),
        binary,
        diff: null,
      })
    }

    return files
  }

  /**
   * Get the content of a file at a specific commit.
   */
  public async getFileContent(commitHash: string, filePath: string): Promise<string | null> {
    const git = this.getGit()
    try {
      return await git.raw(['show', `${commitHash}:${filePath}`])
    } catch {
      return null
    }
  }

  /**
   * Detect the default branch name (tries main, then master, then current).
   */
  public async getDefaultBranch(): Promise<string> {
    const git = this.getGit()

    for (const branch of ['main', 'master']) {
      try {
        await git.raw(['rev-parse', '--verify', branch])
        return branch
      } catch {
        // Branch doesn't exist
      }
    }

    const current = await git.revparse(['--abbrev-ref', 'HEAD'])
    return current.trim()
  }

  /**
   * Get ALL commits from the given branch (or default branch).
   */
  public async getAllCommits(branch?: string): Promise<CommitInfo[]> {
    const git = this.getGit()

    const targetBranch = branch || (await this.getDefaultBranch())
    const result = await git.raw(['log', '--format=%H|%h|%an|%aI|%s', targetBranch])

    return this.parseCommitLog(result)
  }

  /**
   * Get commits since a specific hash (exclusive).
   */
  public async getCommitsSince(sinceHash: string, branch?: string): Promise<CommitInfo[]> {
    const git = this.getGit()

    const targetBranch = branch || (await this.getDefaultBranch())
    const result = await git.raw(['log', '--format=%H|%h|%an|%aI|%s', `${sinceHash}..${targetBranch}`])

    if (!result.trim()) return []

    return this.parseCommitLog(result)
  }

  /**
   * Get total commit count for a branch.
   */
  public async getCommitCount(branch?: string): Promise<number> {
    const git = this.getGit()

    const targetBranch = branch || (await this.getDefaultBranch())
    const result = await git.raw(['rev-list', '--count', targetBranch])
    return parseInt(result.trim(), 10)
  }

  /**
   * Get files changed by a specific commit (paths only, no diffs).
   */
  public async getCommitFileList(commitHash: string): Promise<string[]> {
    const git = this.getGit()

    try {
      const result = await git.raw(['diff-tree', '--no-commit-id', '-r', '--name-only', commitHash])
      return result.trim().split('\n').filter(Boolean)
    } catch {
      return []
    }
  }

  /**
   * Batch get file lists for multiple commits in parallel batches of 20.
   */
  public async getCommitFileLists(commitHashes: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>()

    if (commitHashes.length === 0) return result

    const batchSize = 20
    for (let i = 0; i < commitHashes.length; i += batchSize) {
      const batch = commitHashes.slice(i, i + batchSize)

      const promises = batch.map(async (hash) => {
        try {
          const files = await this.getCommitFileList(hash)
          return { hash, files }
        } catch {
          return { hash, files: [] as string[] }
        }
      })

      const batchResults = await Promise.all(promises)
      for (const { hash, files } of batchResults) {
        result.set(hash, files)
      }
    }

    return result
  }

  /**
   * Get the root directory of the repository.
   */
  public getRepoRoot(): string {
    return this.repoRoot || process.cwd()
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private parseCommitLog(raw: string): CommitInfo[] {
    return raw
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => this.parseCommitLine(line))
  }

  private parseCommitLine(line: string): CommitInfo {
    const [hash, shortHash, author, date, ...messageParts] = line.split('|')
    return { hash, shortHash, author, date, message: messageParts.join('|') }
  }
}
