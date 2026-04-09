import path from 'node:path'

import { Inject, Injectable, Logger } from '@nestjs/common'

import type { AdapterContext, KnowledgeItem, ValidationVerdict } from '@/modules/adapters/adapter.types.js'
import { AdaptersRegistry } from '@/modules/adapters/adapters.registry.js'
import { StateService } from '@/modules/state/state.service.js'
import type { GlobalState } from '@/modules/state/state.types.js'
import { WriterService } from '@/modules/writer/writer.service.js'

const STALE_THRESHOLD = 2

export interface ValidationAction {
  itemId: string
  title: string
  verdict: ValidationVerdict
  action: 'keep' | 'flag-stale' | 'remove'
}

export interface ValidationResult {
  actions: ValidationAction[]
  removed: number
  stale: number
  valid: number
}

@Injectable()
export class ValidatorService {
  private readonly logger = new Logger('ValidatorService')

  constructor(
    @Inject(AdaptersRegistry) private readonly registry: AdaptersRegistry,
    @Inject(StateService) private readonly stateService: StateService,
    @Inject(WriterService) private readonly writer: WriterService,
  ) {}

  /**
   * Validate every item in state against its source adapter.
   * When `dryRun` is true, compute actions without touching state or disk.
   * Otherwise, items graduating past the stale threshold are removed from
   * state and from their hosting files.
   */
  public async validate(state: GlobalState, ctx: AdapterContext, dryRun = false): Promise<ValidationResult> {
    const actions: ValidationAction[] = []
    const itemsToRemove: KnowledgeItem[] = []

    for (const item of state.items) {
      const adapterId = this.primaryAdapterId(item)
      const adapter = adapterId ? this.registry.get(adapterId) : undefined

      if (!adapter) {
        this.logger.warn(`No adapter found for item ${item.id} (adapter: ${adapterId})`)
        actions.push({ itemId: item.id, title: item.title, verdict: 'valid', action: 'keep' })
        continue
      }

      const verdict = await adapter.validateItem(item, ctx)

      if (verdict === 'valid') {
        if (!dryRun) {
          item.staleCount = 0
          item.lastValidated = new Date().toISOString()
        }
        actions.push({ itemId: item.id, title: item.title, verdict, action: 'keep' })
      } else if (verdict === 'stale') {
        const newCount = item.staleCount + 1
        if (newCount >= STALE_THRESHOLD) {
          itemsToRemove.push(item)
          actions.push({ itemId: item.id, title: item.title, verdict, action: 'remove' })
        } else {
          if (!dryRun) {
            item.staleCount = newCount
            item.lastValidated = new Date().toISOString()
          }
          actions.push({ itemId: item.id, title: item.title, verdict, action: 'flag-stale' })
        }
      } else {
        itemsToRemove.push(item)
        actions.push({ itemId: item.id, title: item.title, verdict, action: 'remove' })
      }
    }

    if (!dryRun && itemsToRemove.length > 0) {
      await this.removeItems(state, ctx.repoRoot, itemsToRemove)
    }

    return {
      actions,
      removed: actions.filter((a) => a.action === 'remove').length,
      stale: actions.filter((a) => a.action === 'flag-stale').length,
      valid: actions.filter((a) => a.action === 'keep').length,
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private primaryAdapterId(item: KnowledgeItem): string | null {
    if (item.sources.length === 0) return null
    const [prefix] = item.sources[0].split(':', 1)
    return prefix || null
  }

  private async removeItems(state: GlobalState, repoRoot: string, toRemove: KnowledgeItem[]): Promise<void> {
    const removeIds = new Set(toRemove.map((i) => i.id))

    // Group co-located removals by host file so we can rewrite each file once.
    const coLocatedByHost = new Map<string, KnowledgeItem[]>()
    for (const item of toRemove) {
      if (item.scope.type === 'general') {
        await this.writer.removeItem(item, repoRoot)
      } else {
        const list = coLocatedByHost.get(item.writtenPath) ?? []
        list.push(item)
        coLocatedByHost.set(item.writtenPath, list)
      }
    }

    // After removing from state, rewrite each affected co-located file from the
    // remaining items that still point at it. This keeps the file in sync even
    // when multiple items share a host.
    state.items = state.items.filter((i) => !removeIds.has(i.id))

    for (const [hostPath] of coLocatedByHost) {
      const remaining = state.items.filter((i) => i.writtenPath === hostPath && i.scope.type !== 'general')
      await this.writer.rewriteCoLocatedFromItems(repoRoot, hostPath, remaining)
    }

    // Clean up any central graph dirs emptied by removals.
    await this.pruneEmptyGraphDirs(repoRoot)
  }

  private async pruneEmptyGraphDirs(repoRoot: string): Promise<void> {
    // Best-effort cleanup; failures are ignored.
    const fs = await import('node:fs/promises')
    const graphRoot = path.join(repoRoot, '.2context', 'graph')

    const walk = async (dir: string): Promise<boolean> => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        let allEmpty = entries.length === 0
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const child = path.join(dir, entry.name)
            const empty = await walk(child)
            if (!empty) allEmpty = false
          } else {
            allEmpty = false
          }
        }
        if (allEmpty && dir !== graphRoot) {
          await fs.rmdir(dir)
          return true
        }
        return false
      } catch {
        return false
      }
    }

    await walk(graphRoot)
  }
}
