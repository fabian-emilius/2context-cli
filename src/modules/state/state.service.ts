import path from 'node:path'

import { Injectable, Logger } from '@nestjs/common'

import { FileSystem } from '@/helpers/fs.js'
import type { GlobalState } from '@/modules/state/state.types.js'
import { CURRENT_STATE_VERSION, DEFAULT_REBALANCE_CONFIG } from '@/modules/state/state.types.js'

const STATE_DIR = '.2context'
const STATE_FILE = 'state.json'
const SOURCES_SUBDIR = 'sources'
const GRAPH_SUBDIR = 'graph'

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

  /** Absolute path to `.2context/`. */
  public getStateDir(): string {
    return path.join(this.fs.workingPath, STATE_DIR)
  }

  /** Absolute path to `.2context/graph/`. */
  public getGraphDir(): string {
    return path.join(this.getStateDir(), GRAPH_SUBDIR)
  }

  /** Absolute path to `.2context/sources/`. */
  public getSourcesDir(): string {
    return path.join(this.getStateDir(), SOURCES_SUBDIR)
  }

  /** Absolute path to `.2context/sources/{adapterId}/`. */
  public getAdapterStateDir(adapterId: string): string {
    return path.join(this.getSourcesDir(), adapterId)
  }

  /** Absolute path to the root KNOWLEDGE_GRAPH.md. */
  public getGraphIndexPath(): string {
    return path.join(this.getStateDir(), 'KNOWLEDGE_GRAPH.md')
  }

  /**
   * Load the persisted global state, or null if none exists.
   */
  public async loadState(): Promise<GlobalState | null> {
    const statePath = path.join(this.getStateDir(), STATE_FILE)

    const raw = await this.fs.readFileOrNull(statePath)
    if (!raw) return null

    try {
      const parsed = JSON.parse(raw) as GlobalState
      // Forward-migrate missing config with defaults in case the user edited the file.
      parsed.config = { ...DEFAULT_REBALANCE_CONFIG, ...(parsed.config || {}) }
      if (!parsed.counters) {
        parsed.counters = { totalMaterialProcessed: 0, totalGroupsProcessed: 0, rebalanceCount: 0 }
      }
      if (!parsed.items) parsed.items = []
      return parsed
    } catch (error) {
      this.logger.warn(`Failed to parse state file: ${error}`)
      return null
    }
  }

  /**
   * Persist the given global state to disk, stamping the run date.
   */
  public async saveState(state: GlobalState): Promise<void> {
    const stamped: GlobalState = {
      ...state,
      version: CURRENT_STATE_VERSION,
      lastRunDate: new Date().toISOString(),
    }

    const statePath = path.join(this.getStateDir(), STATE_FILE)
    await this.fs.writeFileWithDir(statePath, JSON.stringify(stamped, null, 2))
    this.logger.log('Global state saved')
  }

  /**
   * Create a blank initial state for a first run.
   */
  public createInitialState(): GlobalState {
    const now = new Date().toISOString()
    return {
      version: CURRENT_STATE_VERSION,
      createdAt: now,
      lastRunDate: now,
      projectSummary: '',
      config: { ...DEFAULT_REBALANCE_CONFIG },
      items: [],
      counters: { totalMaterialProcessed: 0, totalGroupsProcessed: 0, rebalanceCount: 0 },
    }
  }

  /**
   * Ensure `.2context/`, `sources/`, and `graph/{category}/` exist.
   */
  public async scaffoldDirs(): Promise<void> {
    await this.fs.ensureDir(this.getStateDir())
    await this.fs.ensureDir(this.getSourcesDir())
    await this.fs.ensureDir(this.getGraphDir())
    const categories = ['architecture', 'convention', 'decision', 'pattern']
    for (const category of categories) {
      await this.fs.ensureDir(path.join(this.getGraphDir(), category))
    }
  }

  /** True if `.2context/state.json` already exists. */
  public async isInitialized(): Promise<boolean> {
    const statePath = path.join(this.getStateDir(), STATE_FILE)
    return this.fs.pathExists(statePath)
  }
}
