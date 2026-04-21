import fs from 'node:fs/promises'
import path from 'node:path'

import { Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'

import { slugify } from '@/helpers/slug.js'
import type { KnowledgeCategory, KnowledgeItem } from '@/modules/adapters/adapter.types.js'
import { ROOT_CATEGORIES } from '@/modules/adapters/adapter.types.js'
import { AiService } from '@/modules/ai/ai.service.js'
import { ErrorLoggerService } from '@/modules/logging/error-logger.service.js'
import { ClusterSystemPrompt } from '@/modules/rebalance/prompts/cluster.system-prompt.js'
import { StateService } from '@/modules/state/state.service.js'
import type { GlobalState, RebalanceConfig } from '@/modules/state/state.types.js'
import { WriterService } from '@/modules/writer/writer.service.js'
import { TextPrompt } from '@/prompts/text-prompt.js'

const ClusterSchema = z.object({
  clusters: z.array(
    z.object({
      name: z.string().describe('Short kebab-case subcategory name'),
      itemIds: z.array(z.string()).describe('Item ids assigned to this cluster'),
    }),
  ),
  ungrouped: z.array(z.string()).describe('Item ids that do not fit any cluster'),
})

interface MoveAction {
  itemId: string
  oldPath: string
  newPath: string
  newSubcategoryPath: string[]
}

export interface RebalanceResult {
  moves: number
  splits: number
  merges: number
  summaries: string[]
}

@Injectable()
export class RebalanceService {
  constructor(
    @Inject(AiService) private readonly ai: AiService,
    @Inject(StateService) private readonly stateService: StateService,
    @Inject(WriterService) private readonly writer: WriterService,
    @Inject(ErrorLoggerService) private readonly errorLogger: ErrorLoggerService,
  ) {}

  /**
   * Run a full rebalance pass over the central graph.
   * Split and merge phases run recursively on each root category.
   * Mutates `state.items` and returns a summary of what moved.
   *
   * @param dryRun  When true, computes moves without writing files or updating state.
   */
  public async run(
    state: GlobalState,
    repoRoot: string,
    dryRun = false,
    onProgress?: (message: string) => void,
  ): Promise<RebalanceResult> {
    const result: RebalanceResult = { moves: 0, splits: 0, merges: 0, summaries: [] }
    const graphRoot = this.stateService.getGraphDir()

    for (const category of ROOT_CATEGORIES) {
      onProgress?.(`clustering ${category}`)
      const folderPath = path.join(graphRoot, category)
      await this.rebalanceFolder(state, repoRoot, folderPath, [category], result, dryRun)
    }

    if (result.moves > 0 && !dryRun) {
      state.counters.rebalanceCount += 1
    }

    return result
  }

  // ── Recursive per-folder rebalance ─────────────────────────────────────────

  private async rebalanceFolder(
    state: GlobalState,
    repoRoot: string,
    folderPath: string,
    pathSegments: string[],
    result: RebalanceResult,
    dryRun: boolean,
  ): Promise<void> {
    const config = state.config
    const rootCategory = pathSegments[0] as KnowledgeCategory
    const subcategoryPath = pathSegments.slice(1)

    // ── Split phase ──
    const directItems = state.items.filter(
      (item) =>
        item.scope.type === 'general' &&
        item.category === rootCategory &&
        this.arraysEqual(item.subcategoryPath, subcategoryPath),
    )

    if (directItems.length > config.maxChildren) {
      const splitMoves = await this.attemptSplit(directItems, pathSegments, config)
      if (splitMoves.length > 0) {
        await this.applyMoves(state, repoRoot, splitMoves, dryRun)
        result.splits += 1
        result.moves += splitMoves.length
        const uniqueClusters = new Set(splitMoves.map((m) => m.newSubcategoryPath.at(-1)))
        result.summaries.push(
          `split ${pathSegments.join('/')} into ${uniqueClusters.size} subcategories (${splitMoves.length} items moved)`,
        )
      }
    }

    // ── Recurse into children ──
    const existingSubdirs = await this.listSubdirs(folderPath)
    for (const subdir of existingSubdirs) {
      await this.rebalanceFolder(
        state,
        repoRoot,
        path.join(folderPath, subdir),
        [...pathSegments, subdir],
        result,
        dryRun,
      )
    }

    // ── Merge phase (post-order) ──
    // Recount direct items after splits.
    const directAfter = state.items.filter(
      (item) =>
        item.scope.type === 'general' &&
        item.category === rootCategory &&
        this.arraysEqual(item.subcategoryPath, subcategoryPath),
    )

    const subdirsAfter = await this.listSubdirs(folderPath)
    let capacity = directAfter.length

    for (const subdir of subdirsAfter) {
      const subPath = [...subcategoryPath, subdir]
      const subtreeItems = state.items.filter(
        (item) =>
          item.scope.type === 'general' &&
          item.category === rootCategory &&
          this.pathStartsWith(item.subcategoryPath, subPath),
      )

      if (subtreeItems.length === 0) {
        // Empty subdir — just prune it.
        if (!dryRun) await this.removeEmptyDir(path.join(folderPath, subdir))
        continue
      }

      // Only merge leaf subcategories (no nested subdirs) with few items into the parent.
      const grandchildren = await this.listSubdirs(path.join(folderPath, subdir))
      if (grandchildren.length > 0) continue

      if (subtreeItems.length < config.minChildren && capacity + subtreeItems.length <= config.maxChildren) {
        const mergeMoves: MoveAction[] = subtreeItems.map((item) => ({
          itemId: item.id,
          oldPath: item.writtenPath,
          newPath: path.join('.2context', 'graph', ...pathSegments, `${item.id}.md`),
          newSubcategoryPath: subcategoryPath,
        }))
        await this.applyMoves(state, repoRoot, mergeMoves, dryRun)
        if (!dryRun) await this.removeEmptyDir(path.join(folderPath, subdir))
        result.merges += 1
        result.moves += mergeMoves.length
        capacity += subtreeItems.length
        result.summaries.push(`merged ${pathSegments.join('/')}/${subdir} back into parent`)
      }
    }
  }

  // ── LLM clustering ─────────────────────────────────────────────────────────

  private async attemptSplit(
    items: KnowledgeItem[],
    pathSegments: string[],
    config: RebalanceConfig,
  ): Promise<MoveAction[]> {
    try {
      const clusters = await this.clusterWithLLM(items, pathSegments, config)
      return this.planSplitMoves(items, clusters, pathSegments, config)
    } catch (error) {
      await this.errorLogger.warn('RebalanceService', `Clustering failed for ${pathSegments.join('/')}`, error)
      return []
    }
  }

  private async clusterWithLLM(
    items: KnowledgeItem[],
    pathSegments: string[],
    config: RebalanceConfig,
  ): Promise<z.infer<typeof ClusterSchema>> {
    const prompt = TextPrompt.create()
    prompt.text(`You are clustering knowledge items that currently live under \`${pathSegments.join(' / ')}\`.`)
    prompt.text(
      `Propose subcategories where each contains at least ${config.minClusterSize} items. ` +
        `Items that do not fit any clear cluster go into "ungrouped".`,
    )
    prompt.emptyLine()
    prompt.text('=== ITEMS ===')
    for (const item of items) {
      prompt.text(`- id=${item.id} | title="${item.title}" | summary=${item.summary}`)
    }

    const systemPrompt = new ClusterSystemPrompt()
    const response = await this.ai.generateStructured<z.infer<typeof ClusterSchema>>(
      prompt.build(),
      systemPrompt.build().prompt,
      ClusterSchema,
    )
    return response.object
  }

  private planSplitMoves(
    items: KnowledgeItem[],
    clusters: z.infer<typeof ClusterSchema>,
    pathSegments: string[],
    config: RebalanceConfig,
  ): MoveAction[] {
    const itemById = new Map(items.map((i) => [i.id, i]))
    const moves: MoveAction[] = []

    const usedNames = new Set<string>()

    for (const cluster of clusters.clusters) {
      const clusterItems = cluster.itemIds.map((id) => itemById.get(id)).filter((i): i is KnowledgeItem => !!i)

      if (clusterItems.length < config.minClusterSize) continue

      const name = this.uniqueClusterName(cluster.name, usedNames)
      usedNames.add(name)

      for (const item of clusterItems) {
        const newSubPath = [...pathSegments.slice(1), name]
        moves.push({
          itemId: item.id,
          oldPath: item.writtenPath,
          newPath: path.join('.2context', 'graph', pathSegments[0], ...newSubPath.slice(0), `${item.id}.md`),
          newSubcategoryPath: newSubPath,
        })
      }
    }

    return moves
  }

  private uniqueClusterName(raw: string, used: Set<string>): string {
    const base = slugify(raw) || 'group'
    if (!used.has(base)) return base
    let counter = 2
    while (used.has(`${base}-${counter}`)) counter += 1
    return `${base}-${counter}`
  }

  // ── Apply moves ────────────────────────────────────────────────────────────

  private async applyMoves(state: GlobalState, repoRoot: string, moves: MoveAction[], dryRun: boolean): Promise<void> {
    if (dryRun || moves.length === 0) return

    for (const move of moves) {
      const item = state.items.find((i) => i.id === move.itemId)
      if (!item) continue

      const oldAbs = path.join(repoRoot, move.oldPath)
      const newAbs = path.join(repoRoot, move.newPath)

      // Update the in-memory item first so the re-render uses the new path.
      item.subcategoryPath = move.newSubcategoryPath
      item.writtenPath = move.newPath

      // Move on disk: ensure dir, rename if possible, else fall back to rewrite from state.
      await fs.mkdir(path.dirname(newAbs), { recursive: true })
      try {
        if (oldAbs !== newAbs) {
          await fs.rename(oldAbs, newAbs)
        }
      } catch {
        // The old file may not exist (e.g. first run after state edit). Re-render instead.
      }

      // Always re-render the file so the Category header reflects the new path.
      await this.writer.writeCentralItem(repoRoot, item)

      // Try cleaning up empty parent directories of the old path.
      await this.removeEmptyDir(path.dirname(oldAbs))
    }
  }

  // ── Small helpers ─────────────────────────────────────────────────────────

  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
    return true
  }

  private pathStartsWith(full: string[], prefix: string[]): boolean {
    if (full.length < prefix.length) return false
    for (let i = 0; i < prefix.length; i += 1) if (full[i] !== prefix[i]) return false
    return true
  }

  private async listSubdirs(folder: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(folder, { withFileTypes: true })
      return entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return []
    }
  }

  private async removeEmptyDir(folder: string): Promise<void> {
    try {
      const entries = await fs.readdir(folder)
      if (entries.length === 0) {
        await fs.rmdir(folder)
      }
    } catch {
      // Not a directory, already removed, or not empty — all fine.
    }
  }
}
