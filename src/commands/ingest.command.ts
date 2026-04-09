import { Inject } from '@nestjs/common'
import { Command, Option } from 'nest-commander'

import { BaseCommand } from '@/helpers/base-command.js'
import { ConfigService } from '@/modules/config/config.service.js'
import { PipelineService } from '@/modules/pipeline/pipeline.service.js'
import { TerminalUI } from '@/ui/terminal-ui.js'

interface IngestOptions {
  branch?: string
  verbose?: boolean
  force?: boolean
  source?: string
  noRebalance?: boolean
}

@Command({
  name: 'ingest',
  description: 'Run the ingestion pipeline across all configured sources',
})
export class IngestCommand extends BaseCommand {
  private readonly ui = new TerminalUI()

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(PipelineService) private readonly pipeline: PipelineService,
  ) {
    super()
  }

  protected async execute(_passedParam: string[], options?: IngestOptions): Promise<void> {
    this.ui.header('2context', 'Ingest')
    await this.configService.resolve(this.ui)

    if (options?.force) {
      const confirmed = await this.confirmForce()
      if (!confirmed) {
        this.ui.warning('Aborted.')
        this.ui.cleanup()
        return
      }
    }

    const spinner = this.ui.spinner('Ingesting...')
    const result = await this.pipeline.ingest(
      this.ui,
      {
        branch: options?.branch || this.ui.env.branch,
        verbose: options?.verbose || this.ui.env.verbose,
        force: options?.force,
        source: options?.source,
        noRebalance: options?.noRebalance,
      },
      (msg) => spinner.update(msg),
    )
    spinner.succeed('Ingest complete')

    this.ui.divider('Results')
    this.ui.keyValue([
      ['Items produced', String(result.totalItemsProduced)],
      ['Files touched', String(result.filesAffected)],
      [
        'Rebalance',
        result.rebalance.moves > 0
          ? `${result.rebalance.moves} moves (${result.rebalance.splits} split, ${result.rebalance.merges} merge)`
          : 'no changes',
      ],
      ['Mode', result.isIncremental ? 'incremental' : 'full'],
    ])

    for (const summary of result.adapters) {
      this.ui.dim(
        `[${summary.adapterId}] ${summary.itemsProduced} items · ${summary.materialProcessed} items processed · ${summary.groupsProcessed} groups`,
      )
    }

    this.ui.blank()
    this.ui.cleanup()
  }

  private async confirmForce(): Promise<boolean> {
    if (this.ui.isCI) {
      this.ui.warning('--force: wiping existing items (auto-confirmed in CI mode)')
      return true
    }
    this.ui.warning('This will wipe all extracted items and reset source cursors. Continue?')
    return this.ui.askBoolean('Proceed with --force')
  }

  @Option({
    flags: '-b, --branch <name>',
    description: 'Branch to analyze (default: main/master)',
  })
  parseBranch(val: string): string {
    return val
  }

  @Option({
    flags: '-v, --verbose',
    description: 'Verbose logging',
  })
  parseVerbose(): boolean {
    return true
  }

  @Option({
    flags: '-f, --force',
    description: 'Wipe existing items and reprocess everything from scratch',
  })
  parseForce(): boolean {
    return true
  }

  @Option({
    flags: '-s, --source <id>',
    description: 'Only run the adapter with this id (e.g. git-commits)',
  })
  parseSource(val: string): string {
    return val
  }

  @Option({
    flags: '--no-rebalance',
    description: 'Skip the post-ingest rebalance step',
  })
  parseNoRebalance(): boolean {
    return true
  }
}
