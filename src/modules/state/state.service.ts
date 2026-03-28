import path from 'node:path'

import { Injectable, Logger } from '@nestjs/common'

import { FileSystem } from '@/helpers/fs.js'
import type { AnalysisState } from '@/modules/context/context.types.js'

const STATE_DIR = '.2context'
const STATE_FILE = 'state.json'
const CURRENT_VERSION = '1.0.0'

@Injectable()
export class StateService {
  private readonly logger = new Logger('StateService')

  private fs: FileSystem = new FileSystem(process.cwd())

  /**
   * Set the repository root directory for state file resolution.
   */
  public setRepoRoot(rootDir: string): void {
    this.fs = new FileSystem(rootDir)
  }

  /**
   * Get the absolute path to the .2context directory.
   */
  public getStateDir(): string {
    return path.join(this.fs.workingPath, STATE_DIR)
  }

  /**
   * Get the absolute path to the knowledge output directory.
   */
  public getKnowledgeDir(): string {
    return path.join(this.getStateDir(), 'knowledge')
  }

  /**
   * Load the persisted analysis state, or null if none exists.
   */
  public async loadState(): Promise<AnalysisState | null> {
    const statePath = path.join(this.getStateDir(), STATE_FILE)

    const raw = await this.fs.readFileOrNull(statePath)
    if (!raw) return null

    try {
      return JSON.parse(raw) as AnalysisState
    } catch (error) {
      this.logger.warn(`Failed to parse state file: ${error}`)
      return null
    }
  }

  /**
   * Persist the given analysis state to disk.
   */
  public async saveState(state: AnalysisState): Promise<void> {
    const statePath = path.join(this.getStateDir(), STATE_FILE)

    await this.fs.writeFileWithDir(statePath, JSON.stringify(state, null, 2))
    this.logger.log('Analysis state saved')
  }

  /**
   * Create a blank initial state for the first run.
   */
  public createInitialState(): AnalysisState {
    return {
      version: CURRENT_VERSION,
      lastAnalyzedCommit: '',
      lastRunDate: '',
      totalCommitsAnalyzed: 0,
      featureGroupsProcessed: 0,
      knowledgeFiles: [],
    }
  }

  /**
   * Merge partial updates into an existing state object and stamp the current date.
   */
  public updateState(existing: AnalysisState, update: Partial<Omit<AnalysisState, 'version'>>): AnalysisState {
    return {
      ...existing,
      ...update,
      version: CURRENT_VERSION,
      lastRunDate: new Date().toISOString(),
    }
  }

  /**
   * Ensure the knowledge category directories exist under .2context/knowledge/.
   */
  public async ensureKnowledgeDirs(): Promise<void> {
    const knowledgeDir = this.getKnowledgeDir()
    const categories = ['architecture', 'convention', 'decision', 'pattern']

    for (const category of categories) {
      await this.fs.ensureDir(path.join(knowledgeDir, category))
    }
  }
}
