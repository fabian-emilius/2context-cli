import { Module } from '@nestjs/common'

import { ContextGeneratorService } from '@/modules/context/context-generator.service.js'
import { GroupingModule } from '@/modules/grouping/grouping.module.js'
import { WriterModule } from '@/modules/writer/writer.module.js'

@Module({
  imports: [GroupingModule, WriterModule],
  providers: [ContextGeneratorService],
  exports: [ContextGeneratorService],
})
export class ContextModule {}
