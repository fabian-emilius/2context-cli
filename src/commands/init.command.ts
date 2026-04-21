import { Inject } from '@nestjs/common'
import { Command, Option } from 'nest-commander'

import { AI_PROVIDER_LABELS } from '@/constants/ai.js'
import { BaseCommand } from '@/helpers/base-command.js'
import { ConfigService } from '@/modules/config/config.service.js'
import { ErrorLoggerService } from '@/modules/logging/error-logger.service.js'
import { PipelineService } from '@/modules/pipeline/pipeline.service.js'
import { TerminalUI } from '@/ui/terminal-ui.js'

interface InitOptions {
  branch?: string
  verbose?: boolean
}

@Command({
  name: 'init',
  description: 'Scaffold .2context/, configure the AI provider, and run the first ingest',
})
export class InitCommand extends BaseCommand {
  private readonly ui = new TerminalUI()

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(PipelineService) private readonly pipeline: PipelineService,
    @Inject(ErrorLoggerService) private readonly errorLogger: ErrorLoggerService,
  ) {
    super()
  }

  protected async execute(_passedParam: string[], options?: InitOptions): Promise<void> {
    this.ui.header('2context', 'Knowledge Graph CLI')

    // Resolve config: env vars → file → interactive wizard
    const config = await this.configService.resolve(this.ui)

    this.ui.keyValue([
      ['Provider', AI_PROVIDER_LABELS[config.provider]],
      ['Model', config.model],
    ])
    this.ui.blank()

    // Scaffold .2context/ (writes empty state if needed)
    await this.pipeline.initializeWorkspace(this.ui)
    this.ui.success('Workspace scaffolded: .2context/')
    this.ui.blank()

    // First ingest — the pipeline owns per-phase step counters and spinners.
    const result = await this.pipeline.ingest(this.ui, {
      branch: options?.branch || this.ui.env.branch,
      verbose: options?.verbose || this.ui.env.verbose,
    })

    this.ui.blank()
    this.ui.success('Ingest complete')
    this.printResult(result)

    if (result.warningsLogged > 0) {
      this.ui.warning(`${result.warningsLogged} warning(s) logged to ${this.errorLogger.getLogFileRelativePath()}`)
    }

    this.ui.blank()
    this.ui.cleanup()
  }

  protected async persistFatal(error: Error): Promise<void> {
    this.errorLogger.setRepoRoot(process.cwd())
    await this.errorLogger.error('InitCommand', error.message, error)
    this.ui.error(`See ${this.errorLogger.getLogFileRelativePath()} for details.`)
    this.ui.cleanup()
  }

  private printResult(result: Awaited<ReturnType<PipelineService['ingest']>>): void {
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
    ])

    for (const summary of result.adapters) {
      this.ui.dim(
        `[${summary.adapterId}] ${summary.itemsProduced} items · ${summary.materialProcessed} items processed · ${summary.groupsProcessed} groups`,
      )
    }
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
}
