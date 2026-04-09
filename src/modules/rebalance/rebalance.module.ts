import { Module } from '@nestjs/common'

import { RebalanceService } from '@/modules/rebalance/rebalance.service.js'

@Module({
  providers: [RebalanceService],
  exports: [RebalanceService],
})
export class RebalanceModule {}
