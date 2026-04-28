import { Module } from '@nestjs/common'

import { AdaptersModule } from '@/modules/adapters/adapters.module.js'
import { IndexModule } from '@/modules/index/index.module.js'
import { PipelineService } from '@/modules/pipeline/pipeline.service.js'
import { ValidatorModule } from '@/modules/validator/validator.module.js'
import { WriterModule } from '@/modules/writer/writer.module.js'

@Module({
  imports: [AdaptersModule, IndexModule, ValidatorModule, WriterModule],
  providers: [PipelineService],
  exports: [PipelineService, ValidatorModule, IndexModule, AdaptersModule],
})
export class PipelineModule {}
