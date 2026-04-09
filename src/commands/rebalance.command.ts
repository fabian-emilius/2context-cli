import { Inject } from '@nestjs/common'
import { Command, Option } from 'nest-commander'

import { BaseCommand } from '@/helpers/base-command.js'
import { ConfigService } from '@/modules/config/config.service.js'
import { PipelineService } from '@/modules/pipeline/pipeline.service.js'
import { RebalanceService } from '@/modules/rebalance/rebalance.service.js'
import { TerminalUI } from '@/ui/terminal-ui.js'

interface RebalanceOptions {
  dryRun?: boolean
  verbose?: boolean
}

@Command({
  name: 'rebalance',
  description: 'Split overfull category folders and merge underfull subcategories in the central graph',
})
export class RebalanceCommand extends BaseCommand {
  private readonly ui = new TerminalUI()

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(PipelineService) private readonly pipeline: PipelineService,
    @Inject(RebalanceService) private readonly rebalance: RebalanceService,
  ) {
    super()
  }

  protected async execute(_passedParam: string[], options?: RebalanceOptions): Promise<void> {
    this.ui.header('2context', 'Rebalance')
    await this.configService.resolve(this.ui)

    const { ctx, state } = await this.pipeline.buildContext(this.ui)

    const spinner = this.ui.spinner(options?.dryRun ? 'Rebalancing (dry run)...' : 'Rebalancing...')
    const result = await this.rebalance.run(state, ctx.repoRoot, options?.dryRun ?? false)
    spinner.succeed('Rebalance complete')

    this.ui.divider('Results')
    this.ui.keyValue([
      ['Moves', String(result.moves)],
      ['Splits', String(result.splits)],
      ['Merges', String(result.merges)],
    ])

    if (result.summaries.length > 0 && (options?.verbose || options?.dryRun)) {
      this.ui.blank()
      for (const summary of result.summaries) {
        this.ui.dim(summary)
      }
    }

    if (!options?.dryRun && result.moves > 0) {
      await this.pipeline.finalize(this.ui, state, ctx.repoRoot)
    }

    this.ui.blank()
    this.ui.cleanup()
  }

  @Option({
    flags: '--dry-run',
    description: 'Report proposed splits/merges without moving files',
  })
  parseDryRun(): boolean {
    return true
  }

  @Option({
    flags: '-v, --verbose',
    description: 'Print per-move summaries',
  })
  parseVerbose(): boolean {
    return true
  }
}
