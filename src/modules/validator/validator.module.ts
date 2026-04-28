import { Module } from '@nestjs/common'

import { IndexModule } from '@/modules/index/index.module.js'
import { ValidatorService } from '@/modules/validator/validator.service.js'

@Module({
  imports: [IndexModule],
  providers: [ValidatorService],
  exports: [ValidatorService],
})
export class ValidatorModule {}
