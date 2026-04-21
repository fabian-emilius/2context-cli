import { Module } from '@nestjs/common'
import { CommandRunnerModule } from 'nest-commander'

import { IngestCommand } from '@/commands/ingest.command.js'
import { InitCommand } from '@/commands/init.command.js'
import { RebalanceCommand } from '@/commands/rebalance.command.js'
import { StatusCommand } from '@/commands/status.command.js'
import { ValidateCommand } from '@/commands/validate.command.js'
import { AdaptersModule } from '@/modules/adapters/adapters.module.js'
import { AiModule } from '@/modules/ai/ai.module.js'
import { ConfigModule } from '@/modules/config/config.module.js'
import { GitModule } from '@/modules/git/git.module.js'
import { LoggingModule } from '@/modules/logging/logging.module.js'
import { PipelineModule } from '@/modules/pipeline/pipeline.module.js'
import { RebalanceModule } from '@/modules/rebalance/rebalance.module.js'
import { StateModule } from '@/modules/state/state.module.js'
import { ValidatorModule } from '@/modules/validator/validator.module.js'
import { WriterModule } from '@/modules/writer/writer.module.js'

@Module({
  imports: [
    CommandRunnerModule,
    LoggingModule,
    ConfigModule,
    GitModule,
    AiModule,
    StateModule,
    WriterModule,
    AdaptersModule,
    RebalanceModule,
    ValidatorModule,
    PipelineModule,
  ],
  providers: [InitCommand, IngestCommand, ValidateCommand, RebalanceCommand, StatusCommand],
})
export class AppModule {}
