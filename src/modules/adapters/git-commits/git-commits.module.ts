import { Module } from '@nestjs/common'

import { GitCommitsExtractionService } from '@/modules/adapters/git-commits/extraction.service.js'
import { GitCommitsAdapter } from '@/modules/adapters/git-commits/git-commits.adapter.js'
import { GitCommitsGroupingService } from '@/modules/adapters/git-commits/grouping.service.js'

@Module({
  providers: [GitCommitsGroupingService, GitCommitsExtractionService, GitCommitsAdapter],
  exports: [GitCommitsAdapter],
})
export class GitCommitsModule {}
