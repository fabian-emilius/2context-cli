import { Module } from '@nestjs/common'
import { CommandRunnerModule } from 'nest-commander'

import { InitCommand } from '@/commands/init.command.js'
import { StatusCommand } from '@/commands/status.command.js'
import { AiModule } from '@/modules/ai/ai.module.js'
import { ConfigModule } from '@/modules/config/config.module.js'
import { ContextModule } from '@/modules/context/context.module.js'
import { GitModule } from '@/modules/git/git.module.js'
import { StateModule } from '@/modules/state/state.module.js'
import { UIModule } from '@/ui/ui.module.js'

@Module({
  imports: [CommandRunnerModule, UIModule, ConfigModule, GitModule, AiModule, StateModule, ContextModule],
  providers: [InitCommand, StatusCommand],
})
export class AppModule {}
