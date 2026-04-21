import { Global, Module } from '@nestjs/common'

import { ErrorLoggerService } from '@/modules/logging/error-logger.service.js'

@Global()
@Module({
  providers: [ErrorLoggerService],
  exports: [ErrorLoggerService],
})
export class LoggingModule {}
