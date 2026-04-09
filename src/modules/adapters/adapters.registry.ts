import { Inject, Injectable } from '@nestjs/common'

import type { SourceAdapter } from '@/modules/adapters/adapter.types.js'
import { GitCommitsAdapter } from '@/modules/adapters/git-commits/git-commits.adapter.js'

/**
 * Registry of all configured source adapters.
 *
 * New adapters are added by importing their module and injecting the adapter
 * service into this registry. Keep the list small and deterministic so the
 * pipeline runs adapters in a predictable order.
 */
@Injectable()
export class AdaptersRegistry {
  private readonly adapters: SourceAdapter[]

  constructor(@Inject(GitCommitsAdapter) gitCommits: GitCommitsAdapter) {
    this.adapters = [gitCommits]
  }

  /** All adapters in their registered order. */
  public all(): SourceAdapter[] {
    return this.adapters
  }

  /** Look up an adapter by id. */
  public get(id: string): SourceAdapter | undefined {
    return this.adapters.find((a) => a.id === id)
  }

  /** True if an id matches a registered adapter. */
  public has(id: string): boolean {
    return this.adapters.some((a) => a.id === id)
  }

  /** List of registered adapter ids. */
  public ids(): string[] {
    return this.adapters.map((a) => a.id)
  }
}
