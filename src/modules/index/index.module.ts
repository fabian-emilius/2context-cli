import { Module } from '@nestjs/common'

import { IndexService } from '@/modules/index/index.service.js'

@Module({
  providers: [IndexService],
  exports: [IndexService],
})
export class IndexModule {}
