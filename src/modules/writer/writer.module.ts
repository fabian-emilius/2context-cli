import { Global, Module } from '@nestjs/common'

import { GraphWriterService } from '@/modules/writer/graph-writer.service.js'
import { WriterService } from '@/modules/writer/writer.service.js'

@Global()
@Module({
  providers: [WriterService, GraphWriterService],
  exports: [WriterService, GraphWriterService],
})
export class WriterModule {}
