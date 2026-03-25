import { Global, Module } from '@nestjs/common'

import { AiService } from '@/modules/ai/ai.service.js'

@Global()
@Module({
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
