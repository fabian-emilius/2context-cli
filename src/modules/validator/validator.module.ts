import { Module } from '@nestjs/common'

import { ValidatorService } from '@/modules/validator/validator.service.js'

@Module({
  providers: [ValidatorService],
  exports: [ValidatorService],
})
export class ValidatorModule {}
