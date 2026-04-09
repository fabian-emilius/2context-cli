import { Module } from '@nestjs/common'

import { AdaptersModule } from '@/modules/adapters/adapters.module.js'
import { PipelineService } from '@/modules/pipeline/pipeline.service.js'
import { RebalanceModule } from '@/modules/rebalance/rebalance.module.js'
import { ValidatorModule } from '@/modules/validator/validator.module.js'
import { WriterModule } from '@/modules/writer/writer.module.js'

@Module({
  imports: [AdaptersModule, RebalanceModule, ValidatorModule, WriterModule],
  providers: [PipelineService],
  exports: [PipelineService, ValidatorModule, RebalanceModule, AdaptersModule],
})
export class PipelineModule {}
