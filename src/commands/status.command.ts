import path from 'node:path'

import { Inject } from '@nestjs/common'
import { Command } from 'nest-commander'

import { AI_PROVIDER_LABELS } from '@/constants/ai.js'
import { BaseCommand } from '@/helpers/base-command.js'
import { FileSystem } from '@/helpers/fs.js'
import { KNOWLEDGE_CATEGORY_LABELS, ROOT_CATEGORIES } from '@/modules/adapters/adapter.types.js'
import { AdaptersRegistry } from '@/modules/adapters/adapters.registry.js'
import { ConfigService } from '@/modules/config/config.service.js'
import { GitService } from '@/modules/git/git.service.js'
import { StateService } from '@/modules/state/state.service.js'
import { TerminalUI } from '@/ui/terminal-ui.js'

@Command({
  name: 'status',
  description: 'Show configuration, cursors, and item counts',
})
export class StatusCommand extends BaseCommand {
  private readonly ui = new TerminalUI()

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(StateService) private readonly stateService: StateService,
    @Inject(AdaptersRegistry) private readonly registry: AdaptersRegistry,
    @Inject(GitService) private readonly gitService: GitService,
  ) {
    super()
  }

  protected async execute(): Promise<void> {
    this.ui.header('2context', 'Status')

    // Config
    const config = await this.configService.loadConfig()
    if (config) {
      this.ui.divider('Configuration')
      const keyCount = Object.values(config.keys).filter(Boolean).length
      this.ui.keyValue([
        ['Provider', AI_PROVIDER_LABELS[config.provider]],
        ['Model', config.model],
        ['API Keys', `${keyCount} configured`],
      ])
    } else {
      this.ui.warning('Not configured. Run "2context init" to set up.')
    }

    this.ui.blank()

    // Determine repo root for state
    try {
      await this.gitService.initialize()
      const info = await this.gitService.getRepoInfo()
      this.stateService.setRepoRoot(info.rootDir)
    } catch {
      this.ui.warning('Not a git repository — state information unavailable.')
      this.ui.cleanup()
      return
    }

    const state = await this.stateService.loadState()
    if (!state) {
      this.ui.info('Workspace not initialized. Run "2context init" to analyze.')
      this.ui.cleanup()
      return
    }

    // Global
    this.ui.divider('Global')
    this.ui.keyValue([
      ['Last run', state.lastRunDate],
      ['Total items', String(state.items.length)],
      ['Material processed', String(state.counters.totalMaterialProcessed)],
      ['Groups processed', String(state.counters.totalGroupsProcessed)],
      ['Rebalances', String(state.counters.rebalanceCount)],
    ])

    this.ui.blank()

    // Category breakdown
    this.ui.divider('Items by category')
    const general = state.items.filter((i) => i.scope.type === 'general')
    const coLocated = state.items.filter((i) => i.scope.type !== 'general')

    const categoryCounts: [string, string][] = ROOT_CATEGORIES.map((cat) => {
      const count = state.items.filter((i) => i.category === cat).length
      return [KNOWLEDGE_CATEGORY_LABELS[cat], String(count)]
    })
    this.ui.keyValue(categoryCounts)

    this.ui.blank()

    // Co-located files list
    const coLocatedHosts = new Map<string, number>()
    for (const item of coLocated) {
      coLocatedHosts.set(item.writtenPath, (coLocatedHosts.get(item.writtenPath) ?? 0) + 1)
    }
    if (coLocatedHosts.size > 0) {
      this.ui.divider('Co-located files')
      this.ui.list(
        [...coLocatedHosts.entries()].map(([file, count]) => `${file} (${count})`),
        { indent: 2 },
      )
      this.ui.blank()
    }

    this.ui.dim(`General items: ${general.length}`)
    this.ui.blank()

    // Per-source state
    this.ui.divider('Sources')
    for (const adapter of this.registry.all()) {
      adapter.setStateDir(this.stateService.getAdapterStateDir(adapter.id))
      const sourceDir = this.stateService.getAdapterStateDir(adapter.id)
      const fs = new FileSystem(path.dirname(sourceDir))
      const exists = await fs.pathExists(sourceDir)
      if (!exists) {
        this.ui.dim(`[${adapter.id}] no state yet`)
        continue
      }
      try {
        const state = (await adapter.loadState()) as Record<string, unknown>
        const cursor = typeof state.cursor === 'string' ? state.cursor.slice(0, 8) : '—'
        const lastRun = typeof state.lastRun === 'string' ? state.lastRun : '—'
        const totalExtracted = typeof state.totalItemsExtracted === 'number' ? state.totalItemsExtracted : 0
        this.ui.dim(`[${adapter.id}] cursor ${cursor} · last run ${lastRun} · ${totalExtracted} items extracted`)
      } catch {
        this.ui.dim(`[${adapter.id}] unable to read state`)
      }
    }

    this.ui.blank()
    this.ui.cleanup()
  }
}
