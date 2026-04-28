import { Inject } from '@nestjs/common'
import { Command, Option } from 'nest-commander'

import { BaseCommand } from '@/helpers/base-command.js'
import { ConfigService } from '@/modules/config/config.service.js'
import { IndexService } from '@/modules/index/index.service.js'
import { PipelineService } from '@/modules/pipeline/pipeline.service.js'
import { TerminalUI } from '@/ui/terminal-ui.js'

interface RebalanceOptions {
  dryRun?: boolean
  verbose?: boolean
}

@Command({
  name: 'rebalance',
  description:
    'Sweep the central knowledge tree: re-evaluate every leaf and branch, ' +
    're-cluster overfull nodes, regenerate node summaries.',
})
export class RebalanceCommand extends BaseCommand {
  private readonly ui = new TerminalUI()

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(PipelineService) private readonly pipeline: PipelineService,
    @Inject(IndexService) private readonly indexService: IndexService,
  ) {
    super()
  }

  protected async execute(_passedParam: string[], options?: RebalanceOptions): Promise<void> {
    this.ui.header('2context', 'Rebalance')
    await this.configService.resolve(this.ui)

    const { ctx, state } = await this.pipeline.buildContext(this.ui)

    const spinner = this.ui.spinner(options?.dryRun ? 'Rebalancing (dry run)...' : 'Rebalancing...')
    const result = await this.indexService.runFullRebalance(state, ctx.repoRoot, options?.dryRun ?? false, (msg) =>
      spinner.update(msg),
    )
    spinner.succeed('Rebalance complete')

    this.ui.divider('Results')
    this.ui.keyValue([
      ['Inserts', String(result.inserts)],
      ['Splits', String(result.splits)],
      ['Merges', String(result.merges)],
    ])

    if (result.summaries.length > 0 && (options?.verbose || options?.dryRun)) {
      this.ui.blank()
      for (const summary of result.summaries) {
        this.ui.dim(summary)
      }
    }

    if (!options?.dryRun && result.splits + result.merges > 0) {
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
