import { Global, Module } from '@nestjs/common'

import { ConfigService } from '@/modules/config/config.service.js'

@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
