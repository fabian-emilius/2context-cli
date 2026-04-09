import fs from 'node:fs/promises'

import { Inject, Injectable, Logger } from '@nestjs/common'

import { FileSystem } from '@/helpers/fs.js'
import type { AdapterContext, SourceAdapter } from '@/modules/adapters/adapter.types.js'
import { AdaptersRegistry } from '@/modules/adapters/adapters.registry.js'
import { AiService } from '@/modules/ai/ai.service.js'
import { GitService } from '@/modules/git/git.service.js'
import type { IngestCommandOptions, IngestResult, IngestSummary } from '@/modules/pipeline/pipeline.types.js'
import { RebalanceService } from '@/modules/rebalance/rebalance.service.js'
import { StateService } from '@/modules/state/state.service.js'
import type { GlobalState } from '@/modules/state/state.types.js'
import { AgentFileUpdater } from '@/modules/writer/agent-file-updater.js'
import type { SourceSummary } from '@/modules/writer/graph-writer.service.js'
import { GraphWriterService } from '@/modules/writer/graph-writer.service.js'
import { WriterService } from '@/modules/writer/writer.service.js'
import type { TerminalUI } from '@/ui/terminal-ui.js'

type ProgressCallback = (message: string) => void

@Injectable()
export class PipelineService {
  private readonly logger = new Logger('PipelineService')

  constructor(
    @Inject(AdaptersRegistry) private readonly registry: AdaptersRegistry,
    @Inject(StateService) private readonly stateService: StateService,
    @Inject(WriterService) private readonly writer: WriterService,
    @Inject(GraphWriterService) private readonly graphWriter: GraphWriterService,
    @Inject(RebalanceService) private readonly rebalance: RebalanceService,
    @Inject(AiService) private readonly ai: AiService,
    @Inject(GitService) private readonly git: GitService,
  ) {}

  /**
   * Scaffold .2context/ and write an empty initial state if one doesn't already exist.
   * Returns true if the directory was freshly created.
   */
  public async initializeWorkspace(ui: TerminalUI): Promise<{ fresh: boolean; state: GlobalState }> {
    await this.git.initialize()
    const repoInfo = await this.git.getRepoInfo()
    this.stateService.setRepoRoot(repoInfo.rootDir)

    await this.stateService.scaffoldDirs()

    const existing = await this.stateService.loadState()
    if (existing) {
      ui.dim('Existing .2context/ state detected — init will run an incremental ingest.')
      return { fresh: false, state: existing }
    }

    const state = this.stateService.createInitialState()
    await this.stateService.saveState(state)
    return { fresh: true, state }
  }

  /**
   * Run the full ingest pipeline:
   *   for each adapter:
   *     load adapter state → adapter.ingest → writer.writeNewItems → save adapter state
   *   rebalance → rebuild KNOWLEDGE_GRAPH.md → update CLAUDE.md → save global state
   */
  public async ingest(
    ui: TerminalUI,
    options: IngestCommandOptions,
    onProgress?: ProgressCallback,
  ): Promise<IngestResult> {
    const progress = onProgress ?? ((msg: string) => this.logger.log(msg))

    await this.git.initialize()
    const repoInfo = await this.git.getRepoInfo()
    this.stateService.setRepoRoot(repoInfo.rootDir)

    if (!(await this.stateService.isInitialized())) {
      throw new Error('.2context is not initialized. Run "2context init" first.')
    }

    let state = await this.stateService.loadState()
    if (!state) {
      state = this.stateService.createInitialState()
    }

    // --force wipes existing output and resets per-source state.
    if (options.force) {
      progress('--force: wiping existing graph and items')
      await this.wipeOutputs(state, repoInfo.rootDir)
    }

    const ctx: AdapterContext = {
      ai: this.ai,
      git: this.git,
      ui,
      repoRoot: repoInfo.rootDir,
    }

    const adapters = this.selectAdapters(options.source)
    const summaries: IngestSummary[] = []
    const sourceSummaries: SourceSummary[] = []
    const isIncremental = !options.force && state.items.length > 0
    const affectedFiles = new Set<string>()

    for (const adapter of adapters) {
      adapter.setStateDir(this.stateService.getAdapterStateDir(adapter.id))
      const adapterStateDir = this.stateService.getAdapterStateDir(adapter.id)
      await this.ensureDir(adapterStateDir)

      if (options.force) {
        await this.resetAdapterState(adapter, adapterStateDir)
      }

      progress(`[${adapter.id}] loading state`)
      const adapterState = await adapter.loadState()

      progress(`[${adapter.id}] ingesting`)
      const { items, updatedState, counters } = await adapter.ingest(adapterState, ctx, {
        branch: options.branch,
        verbose: options.verbose,
        full: options.force,
      })

      if (items.length > 0) {
        progress(`[${adapter.id}] writing ${items.length} items`)
        await this.writer.writeNewItems(items, repoInfo.rootDir)
        for (const item of items) {
          affectedFiles.add(item.writtenPath)
        }
        state.items.push(...items)
      }

      await adapter.saveState(updatedState)

      state.counters.totalMaterialProcessed += counters.materialProcessed
      state.counters.totalGroupsProcessed += counters.groupsProcessed

      summaries.push({
        adapterId: adapter.id,
        itemsProduced: counters.itemsProduced,
        materialProcessed: counters.materialProcessed,
        groupsProcessed: counters.groupsProcessed,
      })

      sourceSummaries.push(this.buildSourceSummary(adapter, updatedState, counters.materialProcessed))
    }

    // Rebalance unless disabled
    let rebalanceMoves = { moves: 0, splits: 0, merges: 0 }
    if (!options.noRebalance && state.items.length > 0) {
      progress('rebalancing central graph')
      const rebalanceResult = await this.rebalance.run(state, repoInfo.rootDir, false)
      rebalanceMoves = {
        moves: rebalanceResult.moves,
        splits: rebalanceResult.splits,
        merges: rebalanceResult.merges,
      }
      if (rebalanceResult.moves > 0) {
        for (const summary of rebalanceResult.summaries) progress(`[rebalance] ${summary}`)
      }
    }

    // Rebuild KNOWLEDGE_GRAPH.md from the final state
    await this.graphWriter.rebuild(repoInfo.rootDir, this.stateService.getGraphIndexPath(), state, sourceSummaries)

    // Update CLAUDE.md / AGENTS.md
    const coLocatedCount = new Set(state.items.filter((i) => i.scope.type !== 'general').map((i) => i.writtenPath)).size
    const updater = new AgentFileUpdater(repoInfo.rootDir)
    await updater.update({ totalItems: state.items.length, coLocatedFiles: coLocatedCount })

    await this.stateService.saveState(state)

    return {
      adapters: summaries,
      totalItemsProduced: summaries.reduce((acc, s) => acc + s.itemsProduced, 0),
      filesAffected: affectedFiles.size,
      rebalance: rebalanceMoves,
      isIncremental,
    }
  }

  /**
   * Build an AdapterContext suitable for validate/rebalance commands that
   * don't go through the full ingest path.
   */
  public async buildContext(ui: TerminalUI): Promise<{ ctx: AdapterContext; state: GlobalState }> {
    await this.git.initialize()
    const repoInfo = await this.git.getRepoInfo()
    this.stateService.setRepoRoot(repoInfo.rootDir)

    const state = await this.stateService.loadState()
    if (!state) {
      throw new Error('.2context is not initialized. Run "2context init" first.')
    }

    // Wire adapter state dirs so adapters can call validateItem and read their own state if needed.
    for (const adapter of this.registry.all()) {
      adapter.setStateDir(this.stateService.getAdapterStateDir(adapter.id))
    }

    return {
      ctx: { ai: this.ai, git: this.git, ui, repoRoot: repoInfo.rootDir },
      state,
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private selectAdapters(sourceId?: string): SourceAdapter[] {
    if (!sourceId) return this.registry.all()
    const adapter = this.registry.get(sourceId)
    if (!adapter) {
      throw new Error(`Unknown source "${sourceId}". Configured adapters: ${this.registry.ids().join(', ')}`)
    }
    return [adapter]
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true })
  }

  private buildSourceSummary(adapter: SourceAdapter, state: unknown, materialProcessed: number): SourceSummary {
    const shaped = state as { cursor?: string | null; lastRun?: string; totalItemsExtracted?: number }
    return {
      id: adapter.id,
      label: adapter.label,
      cursor: shaped.cursor ?? null,
      lastRun: shaped.lastRun ?? new Date().toISOString(),
      totalItemsExtracted: shaped.totalItemsExtracted ?? 0,
      materialProcessed,
    }
  }

  /**
   * Remove all extracted content but keep the `.2context` folder scaffold itself.
   * Called when `ingest --force` is used.
   */
  private async wipeOutputs(state: GlobalState, repoRoot: string): Promise<void> {
    const filesystem = new FileSystem(repoRoot)

    // Delete all co-located KNOWLEDGE.md files currently referenced in state.
    const coLocatedHosts = new Set(state.items.filter((i) => i.scope.type !== 'general').map((i) => i.writtenPath))
    for (const hostPath of coLocatedHosts) {
      const abs = filesystem.resolve(hostPath)
      try {
        await fs.unlink(abs)
      } catch {
        // ignore
      }
    }

    // Delete the graph directory contents and recreate the category folders.
    const graphDir = this.stateService.getGraphDir()
    try {
      await fs.rm(graphDir, { recursive: true, force: true })
    } catch {
      // ignore
    }

    // Reset in-memory state
    state.items = []
    state.counters.totalMaterialProcessed = 0
    state.counters.totalGroupsProcessed = 0
    state.counters.rebalanceCount = 0

    await this.stateService.scaffoldDirs()
  }

  /**
   * Wipe the per-source state directory so the adapter starts fresh on a forced run.
   */
  private async resetAdapterState(adapter: SourceAdapter, dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
    await fs.mkdir(dir, { recursive: true })
    adapter.setStateDir(dir)
  }

  /**
   * Expose a rebuild path for commands that mutate state without ingesting
   * (validate, rebalance). Rewrites KNOWLEDGE_GRAPH.md and CLAUDE.md/AGENTS.md
   * from the given state, then persists state.
   */
  public async finalize(ui: TerminalUI, state: GlobalState, repoRoot: string): Promise<void> {
    const sourceSummaries: SourceSummary[] = []
    for (const adapter of this.registry.all()) {
      adapter.setStateDir(this.stateService.getAdapterStateDir(adapter.id))
      try {
        const adapterState = (await adapter.loadState()) as {
          cursor?: string | null
          lastRun?: string
          totalItemsExtracted?: number
        }
        sourceSummaries.push({
          id: adapter.id,
          label: adapter.label,
          cursor: adapterState.cursor ?? null,
          lastRun: adapterState.lastRun ?? state.lastRunDate,
          totalItemsExtracted: adapterState.totalItemsExtracted ?? 0,
          materialProcessed: 0,
        })
      } catch {
        // Adapter has no state yet.
      }
    }

    await this.graphWriter.rebuild(repoRoot, this.stateService.getGraphIndexPath(), state, sourceSummaries)

    const coLocatedCount = new Set(state.items.filter((i) => i.scope.type !== 'general').map((i) => i.writtenPath)).size

    const updater = new AgentFileUpdater(repoRoot)
    await updater.update({ totalItems: state.items.length, coLocatedFiles: coLocatedCount })

    await this.stateService.saveState(state)
    ui.dim('State and KNOWLEDGE_GRAPH.md updated.')
  }
}
