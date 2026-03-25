import { Module } from '@nestjs/common'

import { GroupingService } from '@/modules/grouping/grouping.service.js'

@Module({
  providers: [GroupingService],
  exports: [GroupingService],
})
export class GroupingModule {}
