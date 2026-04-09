import { Inject } from '@nestjs/common'
import { Command, Option } from 'nest-commander'

import { BaseCommand } from '@/helpers/base-command.js'
import { ConfigService } from '@/modules/config/config.service.js'
import { PipelineService } from '@/modules/pipeline/pipeline.service.js'
import { ValidatorService } from '@/modules/validator/validator.service.js'
import { TerminalUI } from '@/ui/terminal-ui.js'

interface ValidateOptions {
  dryRun?: boolean
  verbose?: boolean
}

@Command({
  name: 'validate',
  description: 'Check each stored item against its source and remove stale/invalid entries',
})
export class ValidateCommand extends BaseCommand {
  private readonly ui = new TerminalUI()

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(PipelineService) private readonly pipeline: PipelineService,
    @Inject(ValidatorService) private readonly validator: ValidatorService,
  ) {
    super()
  }

  protected async execute(_passedParam: string[], options?: ValidateOptions): Promise<void> {
    this.ui.header('2context', 'Validate')
    await this.configService.resolve(this.ui)

    const { ctx, state } = await this.pipeline.buildContext(this.ui)

    const spinner = this.ui.spinner(options?.dryRun ? 'Validating (dry run)...' : 'Validating...')
    const result = await this.validator.validate(state, ctx, options?.dryRun ?? false)
    spinner.succeed('Validation complete')

    this.ui.divider('Results')
    this.ui.keyValue([
      ['Valid', String(result.valid)],
      ['Flagged stale', String(result.stale)],
      ['Removed', String(result.removed)],
    ])

    if (options?.verbose || options?.dryRun) {
      this.ui.blank()
      for (const action of result.actions.filter((a) => a.action !== 'keep')) {
        const label = action.action === 'remove' ? 'REMOVE' : 'STALE '
        this.ui.dim(`${label} ${action.title} [${action.verdict}]`)
      }
    }

    if (!options?.dryRun && (result.removed > 0 || result.stale > 0)) {
      await this.pipeline.finalize(this.ui, state, ctx.repoRoot)
    }

    this.ui.blank()
    this.ui.cleanup()
  }

  @Option({
    flags: '--dry-run',
    description: 'Compute validation results without modifying state or files',
  })
  parseDryRun(): boolean {
    return true
  }

  @Option({
    flags: '-v, --verbose',
    description: 'Print per-item verdicts',
  })
  parseVerbose(): boolean {
    return true
  }
}
