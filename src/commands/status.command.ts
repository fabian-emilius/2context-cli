import { Inject } from '@nestjs/common'
import { Command } from 'nest-commander'

import { AI_PROVIDER_LABELS } from '@/constants/ai.js'
import { BaseCommand } from '@/helpers/base-command.js'
import { ConfigService } from '@/modules/config/config.service.js'
import { StateService } from '@/modules/state/state.service.js'
import { TerminalUI } from '@/ui/terminal-ui.js'

@Command({
  name: 'status',
  description: 'Show current 2context configuration and analysis status',
})
export class StatusCommand extends BaseCommand {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(StateService) private readonly stateService: StateService,
    @Inject(TerminalUI) private readonly ui: TerminalUI,
  ) {
    super()
  }

  protected async execute(): Promise<void> {
    this.ui.header('2context', 'Status')

    // Config status
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

    // Analysis state
    const state = await this.stateService.loadState()
    if (state) {
      this.ui.divider('Analysis')
      this.ui.keyValue([
        ['Last commit', `${state.lastAnalyzedCommit.substring(0, 12)}...`],
        ['Last run', state.lastRunDate],
        ['Commits analyzed', String(state.totalCommitsAnalyzed)],
        ['Feature groups', String(state.featureGroupsProcessed)],
        ['Knowledge files', String(state.knowledgeFiles.length)],
      ])

      if (state.knowledgeFiles.length > 0) {
        this.ui.blank()

        const sourceTreeFiles = state.knowledgeFiles.filter((f) => !f.startsWith('.2context'))
        const generalFiles = state.knowledgeFiles.filter((f) => f.startsWith('.2context'))

        if (sourceTreeFiles.length > 0) {
          this.ui.log('Source tree:')
          this.ui.list(sourceTreeFiles, { indent: 2 })
        }

        if (generalFiles.length > 0) {
          this.ui.log('General knowledge:')
          this.ui.list(generalFiles, { indent: 2 })
        }
      }
    } else {
      this.ui.info('No analysis performed yet. Run "2context init" to analyze.')
    }

    this.ui.blank()
    this.ui.cleanup()
  }
}
