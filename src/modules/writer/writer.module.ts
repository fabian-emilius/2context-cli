import { Module } from '@nestjs/common'

import { WriterService } from '@/modules/writer/writer.service.js'

@Module({
  providers: [WriterService],
  exports: [WriterService],
})
export class WriterModule {}
