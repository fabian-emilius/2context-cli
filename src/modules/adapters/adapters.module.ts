import { Global, Module } from '@nestjs/common'

import { AdaptersRegistry } from '@/modules/adapters/adapters.registry.js'
import { GitCommitsModule } from '@/modules/adapters/git-commits/git-commits.module.js'

@Global()
@Module({
  imports: [GitCommitsModule],
  providers: [AdaptersRegistry],
  exports: [AdaptersRegistry, GitCommitsModule],
})
export class AdaptersModule {}
