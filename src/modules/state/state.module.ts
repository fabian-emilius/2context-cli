import { Global, Module } from '@nestjs/common'

import { StateService } from '@/modules/state/state.service.js'

@Global()
@Module({
  providers: [StateService],
  exports: [StateService],
})
export class StateModule {}
