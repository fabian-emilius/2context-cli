import { Global, Module } from '@nestjs/common'

import { GitService } from '@/modules/git/git.service.js'

@Global()
@Module({
  providers: [GitService],
  exports: [GitService],
})
export class GitModule {}
