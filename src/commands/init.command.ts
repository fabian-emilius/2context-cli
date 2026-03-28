import { Inject } from '@nestjs/common'
import { Command, Option } from 'nest-commander'

import { AI_PROVIDER_LABELS } from '@/constants/ai.js'
import { BaseCommand } from '@/helpers/base-command.js'
import { ConfigService } from '@/modules/config/config.service.js'
import { ContextGeneratorService } from '@/modules/context/context-generator.service.js'
import { TerminalUI } from '@/ui/terminal-ui.js'

interface InitOptions {
  branch?: string
  verbose?: boolean
  force?: boolean
}

@Command({
  name: 'init',
  description: 'Analyze repository commits and generate knowledge context files',
})
export class InitCommand extends BaseCommand {
  private readonly ui = new TerminalUI()

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(ContextGeneratorService) private readonly contextGenerator: ContextGeneratorService,
  ) {
    super()
  }

  protected async execute(_passedParam: string[], options?: InitOptions): Promise<void> {
    this.ui.header('2context', 'Knowledge Extraction CLI')

    // Resolve config: env vars → file → interactive wizard
    const config = await this.configService.resolve(this.ui)

    this.ui.keyValue([
      ['Provider', AI_PROVIDER_LABELS[config.provider]],
      ['Model', config.model],
    ])
    this.ui.blank()

    // Run analysis pipeline with spinner updates
    const spinner = this.ui.spinner('Analyzing repository...')

    const result = await this.contextGenerator.analyze(
      {
        branch: options?.branch || this.ui.env.branch,
        verbose: options?.verbose || this.ui.env.verbose,
        force: options?.force || this.ui.env.force,
      },
      (message) => spinner.update(message),
    )

    spinner.succeed('Analysis complete')

    // Summary
    this.ui.divider('Results')
    this.ui.keyValue([
      ['Commits analyzed', String(result.commitsAnalyzed)],
      ['Feature groups', String(result.featureGroups)],
      ['Insights', String(result.insightsGenerated)],
    ])

    if (result.isIncremental) {
      this.ui.dim('Mode: incremental (only new commits)')
    }

    if (result.knowledgeFilesWritten.length > 0) {
      this.ui.blank()
      this.ui.log('Knowledge files:')
      this.ui.list(result.knowledgeFilesWritten, { indent: 2 })
    }

    this.ui.blank()
    this.ui.cleanup()
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
    description: 'Include full diffs in analysis (more detailed but slower)',
  })
  parseVerbose(): boolean {
    return true
  }

  @Option({
    flags: '-f, --force',
    description: 'Force re-analysis of all commits (ignore previous state)',
  })
  parseForce(): boolean {
    return true
  }
}
