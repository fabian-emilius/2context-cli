import fs from 'node:fs/promises'

import { Inject, Injectable } from '@nestjs/common'

import { FileSystem } from '@/helpers/fs.js'
import type { AdapterContext, SourceAdapter } from '@/modules/adapters/adapter.types.js'
import { AdaptersRegistry } from '@/modules/adapters/adapters.registry.js'
import { AiService } from '@/modules/ai/ai.service.js'
import { GitService } from '@/modules/git/git.service.js'
import type { IndexResult } from '@/modules/index/index.service.js'
import { IndexService } from '@/modules/index/index.service.js'
import { ErrorLoggerService } from '@/modules/logging/error-logger.service.js'
import type { IngestCommandOptions, IngestResult, IngestSummary } from '@/modules/pipeline/pipeline.types.js'
import { StateService } from '@/modules/state/state.service.js'
import type { GlobalState } from '@/modules/state/state.types.js'
import { AgentFileUpdater } from '@/modules/writer/agent-file-updater.js'
import type { SourceSummary } from '@/modules/writer/graph-writer.service.js'
import { GraphWriterService } from '@/modules/writer/graph-writer.service.js'
import { WriterService } from '@/modules/writer/writer.service.js'
import type { SpinnerHandle, TerminalUI } from '@/ui/terminal-ui.js'

@Injectable()
export class PipelineService {
  constructor(
    @Inject(AdaptersRegistry) private readonly registry: AdaptersRegistry,
    @Inject(StateService) private readonly stateService: StateService,
    @Inject(WriterService) private readonly writer: WriterService,
    @Inject(GraphWriterService) private readonly graphWriter: GraphWriterService,
    @Inject(IndexService) private readonly indexService: IndexService,
    @Inject(AiService) private readonly ai: AiService,
    @Inject(GitService) private readonly git: GitService,
    @Inject(ErrorLoggerService) private readonly errorLogger: ErrorLoggerService,
  ) {}

  /**
   * Scaffold .2context/ and write an empty initial state if one doesn't already exist.
   * Returns true if the directory was freshly created.
   */
  public async initializeWorkspace(ui: TerminalUI): Promise<{ fresh: boolean; state: GlobalState }> {
    await this.git.initialize()
    const repoInfo = await this.git.getRepoInfo()
    this.stateService.setRepoRoot(repoInfo.rootDir)
    this.errorLogger.setRepoRoot(repoInfo.rootDir)

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
   *     load adapter state → adapter.ingest → split items by scope:
   *       co-located → writer.writeCoLocatedItems
   *       general    → indexService.insertItem (per-item, balanced on every insert)
   *     → save adapter state
   *   rebuild KNOWLEDGE_GRAPH.md → update CLAUDE.md → save global state
   */
  public async ingest(ui: TerminalUI, options: IngestCommandOptions): Promise<IngestResult> {
    this.errorLogger.resetRunCounters()

    let activeSpinner: SpinnerHandle | null = null
    try {
      // ── Phase 1: Preparing workspace ──────────────────────────────────────
      const adapters = this.selectAdapters(options.source)

      const phases: string[] = ['Preparing workspace']
      if (options.force) phases.push('Wiping previous outputs')
      for (const a of adapters) phases.push(`Ingesting ${a.label}`)
      phases.push('Rebuilding knowledge index', 'Saving state')

      let stepIdx = 0
      const totalSteps = () => phases.length
      const nextStep = (label: string): void => {
        stepIdx += 1
        ui.step(stepIdx, totalSteps(), label)
      }

      nextStep(phases[0])
      activeSpinner = ui.spinner('Checking git repository...')
      await this.git.initialize()
      const repoInfo = await this.git.getRepoInfo()
      this.stateService.setRepoRoot(repoInfo.rootDir)
      this.errorLogger.setRepoRoot(repoInfo.rootDir)

      if (!(await this.stateService.isInitialized())) {
        throw new Error('.2context is not initialized. Run "2context init" first.')
      }

      activeSpinner.update('Loading state...')
      let state = await this.stateService.loadState()
      if (!state) {
        state = this.stateService.createInitialState()
      }
      activeSpinner.succeed(`Workspace ready (${repoInfo.rootDir}) — ${state.items.length} existing item(s)`)
      activeSpinner = null

      // ── Phase 2 (optional): Wiping previous outputs ────────────────────────
      if (options.force) {
        nextStep('Wiping previous outputs')
        activeSpinner = ui.spinner('Removing existing graph and items...')
        state = await this.wipeOutputs(state, repoInfo.rootDir)
        activeSpinner.succeed('Previous outputs wiped')
        activeSpinner = null
      }

      const ctx: AdapterContext = {
        ai: this.ai,
        git: this.git,
        ui,
        repoRoot: repoInfo.rootDir,
      }

      const summaries: IngestSummary[] = []
      const sourceSummaries: SourceSummary[] = []
      const isIncremental = !options.force && state.items.length > 0
      const affectedFiles = new Set<string>()
      const totalIndexResult: IndexResult = { inserts: 0, splits: 0, merges: 0, summaries: [] }

      // ── Phase 3..M: Ingesting <adapter.label> ──────────────────────────────
      for (const adapter of adapters) {
        nextStep(`Ingesting ${adapter.label}`)

        adapter.setStateDir(this.stateService.getAdapterStateDir(adapter.id))
        const adapterStateDir = this.stateService.getAdapterStateDir(adapter.id)
        await this.ensureDir(adapterStateDir)

        if (options.force) {
          await this.resetAdapterState(adapter, adapterStateDir)
        }

        const adapterState = await adapter.loadState()
        const { items, updatedState, counters } = await adapter.ingest(adapterState, ctx, {
          branch: options.branch,
          verbose: options.verbose,
          full: options.force,
        })

        if (items.length > 0) {
          activeSpinner = ui.spinner(`[${adapter.id}] writing ${items.length} knowledge items...`)

          // Co-located items go straight to disk; general items get routed through the index.
          const coLocated = items.filter((i) => i.scope.type !== 'general')
          const general = items.filter((i) => i.scope.type === 'general')

          await this.writer.writeCoLocatedItems(coLocated, repoInfo.rootDir)
          for (const item of coLocated) {
            state.items.push(item)
            affectedFiles.add(item.writtenPath)
          }

          for (let i = 0; i < general.length; i += 1) {
            const item = general[i]
            activeSpinner.update(`[${adapter.id}] indexing ${i + 1}/${general.length} — ${item.title}`)
            state.items.push(item)
            await this.indexService.insertItem(state, repoInfo.rootDir, item, totalIndexResult)
            affectedFiles.add(item.writtenPath)
          }

          activeSpinner.succeed(
            `[${adapter.id}] ${coLocated.length} co-located, ${general.length} indexed (${totalIndexResult.splits} split${totalIndexResult.splits === 1 ? '' : 's'} so far)`,
          )
          activeSpinner = null
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

      if (totalIndexResult.splits + totalIndexResult.merges > 0) {
        state.counters.rebalanceCount += 1
      }

      // ── Phase M+1: Rebuilding knowledge index ──────────────────────────────
      nextStep('Rebuilding knowledge index')
      activeSpinner = ui.spinner('Rebuilding KNOWLEDGE_GRAPH.md...')
      await this.graphWriter.rebuild(repoInfo.rootDir, this.stateService.getGraphIndexPath(), state, sourceSummaries)
      activeSpinner.update('Updating CLAUDE.md / AGENTS.md...')
      const coLocatedCount = new Set(state.items.filter((i) => i.scope.type !== 'general').map((i) => i.writtenPath))
        .size
      const updater = new AgentFileUpdater(repoInfo.rootDir)
      await updater.update({ totalItems: state.items.length, coLocatedFiles: coLocatedCount })
      activeSpinner.succeed(`Index rebuilt (${state.items.length} items across ${coLocatedCount} co-located files)`)
      activeSpinner = null

      // ── Phase M+2: Saving state ────────────────────────────────────────────
      nextStep('Saving state')
      activeSpinner = ui.spinner('Writing .2context/state.json...')
      await this.stateService.saveState(state)
      activeSpinner.succeed('State saved')
      activeSpinner = null

      return {
        adapters: summaries,
        totalItemsProduced: summaries.reduce((acc, s) => acc + s.itemsProduced, 0),
        filesAffected: affectedFiles.size,
        rebalance: {
          moves: totalIndexResult.inserts,
          splits: totalIndexResult.splits,
          merges: totalIndexResult.merges,
        },
        isIncremental,
        warningsLogged: this.errorLogger.count('warn'),
      }
    } catch (error) {
      if (activeSpinner) {
        activeSpinner.fail(error instanceof Error ? error.message : String(error))
      }
      throw error
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
      throw new Error(
        '.2context is not initialized or is from an incompatible older version. Run "2context init" first.',
      )
    }

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
   * Wipe all extracted content but keep the `.2context` folder scaffold.
   * Returns a fresh state with the four root branches re-seeded so the next
   * insert has a tree to route into.
   */
  private async wipeOutputs(state: GlobalState, repoRoot: string): Promise<GlobalState> {
    const filesystem = new FileSystem(repoRoot)

    const coLocatedHosts = new Set(state.items.filter((i) => i.scope.type !== 'general').map((i) => i.writtenPath))
    for (const hostPath of coLocatedHosts) {
      const abs = filesystem.resolve(hostPath)
      try {
        await fs.unlink(abs)
      } catch {
        // ignore
      }
    }

    const graphDir = this.stateService.getGraphDir()
    try {
      await fs.rm(graphDir, { recursive: true, force: true })
    } catch {
      // ignore
    }

    await this.stateService.scaffoldDirs()

    // Replace state with a fresh seed so the index tree is consistent with disk.
    const fresh = this.stateService.createInitialState()
    fresh.projectSummary = state.projectSummary
    return fresh
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
