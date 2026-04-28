import fs from 'node:fs/promises'
import path from 'node:path'

import { Inject, Injectable, Logger } from '@nestjs/common'
import { z } from 'zod'

import { slugify } from '@/helpers/slug.js'
import type { KnowledgeItem } from '@/modules/adapters/adapter.types.js'
import { AiService } from '@/modules/ai/ai.service.js'
import { ClusterSystemPrompt } from '@/modules/index/prompts/cluster.system-prompt.js'
import { RouteItemSystemPrompt } from '@/modules/index/prompts/route-item.system-prompt.js'
import { SummarizeBranchSystemPrompt } from '@/modules/index/prompts/summarize-branch.system-prompt.js'
import { SummarizeLeafSystemPrompt } from '@/modules/index/prompts/summarize-leaf.system-prompt.js'
import { ErrorLoggerService } from '@/modules/logging/error-logger.service.js'
import type { GlobalState, GraphNode } from '@/modules/state/state.types.js'
import { WriterService } from '@/modules/writer/writer.service.js'
import { TextPrompt } from '@/prompts/text-prompt.js'

const RouteSchema = z
  .object({
    chosenChildId: z
      .string()
      .nullable()
      .describe('Id of the existing child to descend into, or null if creating a new sibling.'),
    createNewSibling: z
      .boolean()
      .describe('True iff none of the existing children fits and a new leaf should be created.'),
    newSiblingName: z
      .string()
      .nullable()
      .describe('Short kebab-case name for the new sibling when createNewSibling is true; otherwise null.'),
  })
  .describe('Routing decision at one branch level.')

const ClusterSchema = z.object({
  clusters: z.array(
    z.object({
      name: z.string().describe('Short kebab-case subgroup name'),
      memberIds: z.array(z.string()).describe('Ids assigned to this subgroup'),
    }),
  ),
  ungrouped: z.array(z.string()).describe('Ids that do not fit any subgroup'),
})

const SummarySchema = z.object({
  summary: z.string().describe('One-sentence summary, ≤ 25 words.'),
  keywords: z.array(z.string()).describe('3-5 short kebab-case topic keywords.'),
})

export interface IndexResult {
  inserts: number
  splits: number
  merges: number
  summaries: string[]
}

interface SplitContext {
  reason: string
  segments: string[]
}

@Injectable()
export class IndexService {
  private readonly logger = new Logger('IndexService')

  constructor(
    @Inject(AiService) private readonly ai: AiService,
    @Inject(WriterService) private readonly writer: WriterService,
    @Inject(ErrorLoggerService) private readonly errorLogger: ErrorLoggerService,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Insert one general-scope item into the tree. Routes top-down using the
   * LLM at each branch, places the item in a leaf, then walks back to the
   * root applying splits and regenerating summaries on dirty nodes.
   */
  public async insertItem(
    state: GlobalState,
    repoRoot: string,
    item: KnowledgeItem,
    result: IndexResult,
  ): Promise<void> {
    if (item.scope.type !== 'general') {
      throw new Error(`IndexService.insertItem only handles general-scope items (got ${item.scope.type}).`)
    }

    if (state.items.some((existing) => existing.id === item.id && existing !== item)) {
      this.logger.log(`Skipping duplicate item id "${item.id}" — already in state.`)
      return
    }

    const rootId = state.graphTree.rootIds[String(item.category)]
    const rootBranch = state.graphTree.nodes[rootId]
    if (!rootBranch || rootBranch.kind !== 'branch') {
      throw new Error(`Root branch missing for category "${item.category}". State is corrupt.`)
    }

    const leaf = await this.routeItemToLeaf(state, rootBranch, item)
    this.attachItemToLeaf(state, leaf, item)
    result.inserts += 1

    await this.fixUpFrom(state, repoRoot, leaf.id, result)
  }

  /**
   * Remove one item from the tree. Used by the validator after an item is
   * judged invalid/stale. Updates the host leaf, deletes empty leaves, and
   * regenerates summaries up the chain.
   */
  public async removeItem(state: GlobalState, repoRoot: string, itemId: string): Promise<void> {
    const item = state.items.find((i) => i.id === itemId)
    if (!item || item.scope.type !== 'general' || !item.leafId) return

    const leaf = state.graphTree.nodes[item.leafId]
    if (!leaf || leaf.kind !== 'leaf') return

    leaf.itemIds = (leaf.itemIds ?? []).filter((id) => id !== itemId)

    const result: IndexResult = { inserts: 0, splits: 0, merges: 0, summaries: [] }

    if (leaf.itemIds.length === 0) {
      const parentId = leaf.parentId
      await this.deleteLeaf(state, repoRoot, leaf)
      if (parentId) await this.fixUpFrom(state, repoRoot, parentId, result)
    } else {
      await this.fixUpFrom(state, repoRoot, leaf.id, result)
    }
  }

  /**
   * Sweep the whole tree, regenerate every node's summary, and re-evaluate
   * every threshold. Used by the standalone `2context rebalance` command.
   * In dry-run mode, only counts what would change.
   */
  public async runFullRebalance(
    state: GlobalState,
    repoRoot: string,
    dryRun: boolean,
    onProgress?: (message: string) => void,
  ): Promise<IndexResult> {
    const result: IndexResult = { inserts: 0, splits: 0, merges: 0, summaries: [] }

    if (dryRun) {
      // Cheap planning pass: count threshold violations without mutating state.
      for (const node of Object.values(state.graphTree.nodes)) {
        if (node.kind === 'leaf' && (node.itemIds?.length ?? 0) > state.config.maxItemsPerLeaf) {
          result.splits += 1
        } else if (node.kind === 'branch' && (node.childIds?.length ?? 0) > state.config.maxChildrenPerBranch) {
          result.splits += 1
        }
      }
      result.summaries.push(`dry run: ${result.splits} node(s) currently exceed thresholds`)
      return result
    }

    const rootIds = Object.values(state.graphTree.rootIds)
    for (const rootId of rootIds) {
      const root = state.graphTree.nodes[rootId]
      if (!root) continue
      onProgress?.(`rebalancing ${root.segment}`)
      await this.sweepNode(state, repoRoot, root, result)
    }

    if (result.splits + result.merges > 0) {
      state.counters.rebalanceCount += 1
    }

    return result
  }

  // ── Routing ────────────────────────────────────────────────────────────────

  /**
   * Walk top-down from the given branch, asking the LLM at each branch which
   * existing child to descend into (or whether to create a new sibling leaf).
   * Returns the leaf where the item should land — creating one if necessary.
   */
  private async routeItemToLeaf(state: GlobalState, fromBranch: GraphNode, item: KnowledgeItem): Promise<GraphNode> {
    let current = fromBranch
    while (true) {
      if (current.kind === 'leaf') return current

      const childIds = current.childIds ?? []
      const children = childIds.map((id) => state.graphTree.nodes[id]).filter((c): c is GraphNode => Boolean(c))

      if (children.length === 0) {
        return this.createLeafUnder(state, current, this.proposeLeafName(item, current), item)
      }

      // Trivial shortcut: a single leaf child below the per-leaf cap absorbs the item
      // without spending an LLM call on the routing decision.
      const onlyChild = children.length === 1 ? children[0] : null
      if (onlyChild && onlyChild.kind === 'leaf' && (onlyChild.itemIds?.length ?? 0) < state.config.maxItemsPerLeaf) {
        current = onlyChild
        continue
      }

      const decision = await this.askRoutingLLM(current, children, item)

      if (decision.createNewSibling) {
        const baseName = decision.newSiblingName?.trim() || this.proposeLeafName(item, current)
        return this.createLeafUnder(state, current, baseName, item)
      }

      if (!decision.chosenChildId) {
        // LLM returned an inconsistent response; fall back to creating a new sibling.
        return this.createLeafUnder(state, current, this.proposeLeafName(item, current), item)
      }

      const chosen = state.graphTree.nodes[decision.chosenChildId]
      if (!chosen) {
        // Hallucinated id — fall back to a new sibling so we never lose the item.
        return this.createLeafUnder(state, current, this.proposeLeafName(item, current), item)
      }

      current = chosen
    }
  }

  private async askRoutingLLM(
    branch: GraphNode,
    children: GraphNode[],
    item: KnowledgeItem,
  ): Promise<z.infer<typeof RouteSchema>> {
    const prompt = TextPrompt.create()
    prompt.text(`Branch path: ${branch.path}`)
    if (branch.summary) {
      prompt.text(`Branch summary: ${branch.summary}`)
    }
    prompt.emptyLine()

    prompt.text('=== EXISTING CHILDREN ===')
    for (const child of children) {
      const kindLabel = child.kind === 'branch' ? 'folder' : 'file'
      const summary = child.summary || '(no summary yet)'
      prompt.text(`- id=${child.id} | ${kindLabel}=${child.segment} | summary=${summary}`)
    }
    prompt.emptyLine()

    prompt.text('=== NEW ITEM ===')
    prompt.text(`title: ${item.title}`)
    prompt.text(`summary: ${item.summary}`)
    prompt.emptyLine()

    prompt.text(
      'Decide: pick one child by id, or set createNewSibling=true with a short kebab-case newSiblingName. ' +
        'Only create a new sibling if no existing child genuinely fits.',
    )

    try {
      const response = await this.ai.generateStructured<z.infer<typeof RouteSchema>>(
        prompt.build(),
        new RouteItemSystemPrompt().build().prompt,
        RouteSchema,
      )
      return response.object
    } catch (error) {
      await this.errorLogger.warn('IndexService', `Routing LLM call failed at "${branch.path}"`, error)
      return { chosenChildId: null, createNewSibling: true, newSiblingName: null }
    }
  }

  // ── Leaf operations ────────────────────────────────────────────────────────

  private createLeafUnder(state: GlobalState, parent: GraphNode, baseName: string, item: KnowledgeItem): GraphNode {
    const segment = this.uniqueChildSegment(state, parent, slugify(baseName) || slugify(item.title) || 'leaf')
    const id = this.uniqueNodeId(state, `${parent.id}__${segment}`)

    const leaf: GraphNode = {
      id,
      kind: 'leaf',
      segment,
      path: path.posix.join(parent.path, `${segment}.md`),
      parentId: parent.id,
      summary: '',
      keywords: [],
      summaryUpdatedAt: '',
      itemIds: [],
    }

    state.graphTree.nodes[id] = leaf
    parent.childIds = [...(parent.childIds ?? []), id]
    return leaf
  }

  private attachItemToLeaf(state: GlobalState, leaf: GraphNode, item: KnowledgeItem): void {
    if (leaf.kind !== 'leaf') throw new Error(`attachItemToLeaf called on non-leaf "${leaf.id}".`)
    leaf.itemIds = leaf.itemIds ?? []
    if (!leaf.itemIds.includes(item.id)) leaf.itemIds.push(item.id)
    item.leafId = leaf.id
    item.writtenPath = leaf.path
    item.subcategoryPath = this.subcategorySegments(state, leaf)
  }

  private async deleteLeaf(state: GlobalState, repoRoot: string, leaf: GraphNode): Promise<void> {
    if (leaf.parentId) {
      const parent = state.graphTree.nodes[leaf.parentId]
      if (parent) parent.childIds = (parent.childIds ?? []).filter((id) => id !== leaf.id)
    }
    delete state.graphTree.nodes[leaf.id]

    try {
      await fs.unlink(path.join(repoRoot, leaf.path))
    } catch {
      // missing file is fine
    }
  }

  /**
   * Cluster a leaf's items via LLM and redistribute them into new sibling
   * leaves under the same parent. The original leaf is deleted; ungrouped
   * items go into a fallback sibling so nothing is lost.
   */
  private async splitLeaf(state: GlobalState, repoRoot: string, leaf: GraphNode, result: IndexResult): Promise<void> {
    if (leaf.kind !== 'leaf' || !leaf.parentId) return
    const parent = state.graphTree.nodes[leaf.parentId]
    if (!parent || parent.kind !== 'branch') return

    const items = (leaf.itemIds ?? [])
      .map((id) => state.items.find((i) => i.id === id))
      .filter((x): x is KnowledgeItem => Boolean(x))
    if (items.length <= state.config.maxItemsPerLeaf) return

    const clusters = await this.runClustering(
      items.map((i) => ({ id: i.id, title: i.title, summary: i.summary })),
      { reason: `leaf "${leaf.path}" has ${items.length} items`, segments: leaf.path.split('/') },
      Math.max(2, Math.floor(state.config.minClusterSize / 2)),
    )

    if (clusters.clusters.length < 2) {
      this.logger.log(`Leaf split skipped for "${leaf.path}" — clustering returned <2 groups.`)
      return
    }

    const oldLeafPath = leaf.path
    // Remove the old leaf from the parent first; we'll create new siblings in its place.
    parent.childIds = (parent.childIds ?? []).filter((id) => id !== leaf.id)
    delete state.graphTree.nodes[leaf.id]

    const newLeafIds: string[] = []
    const usedSegments = new Set<string>(
      (parent.childIds ?? []).map((id) => state.graphTree.nodes[id]?.segment).filter((s): s is string => Boolean(s)),
    )

    for (const cluster of clusters.clusters) {
      const memberItems = cluster.memberIds
        .map((id) => items.find((i) => i.id === id))
        .filter((x): x is KnowledgeItem => Boolean(x))
      if (memberItems.length === 0) continue

      const segment = this.uniqueSegment(slugify(cluster.name) || 'group', usedSegments)
      usedSegments.add(segment)
      const newLeaf = this.makeLeaf(state, parent, segment)
      for (const item of memberItems) this.attachItemToLeaf(state, newLeaf, item)
      newLeafIds.push(newLeaf.id)
    }

    // Place ungrouped items in their own catch-all sibling so nothing is dropped.
    const ungroupedItems = clusters.ungrouped
      .map((id) => items.find((i) => i.id === id))
      .filter((x): x is KnowledgeItem => Boolean(x))
    const placedIds = new Set(newLeafIds.flatMap((id) => state.graphTree.nodes[id]?.itemIds ?? []))
    const orphanItems = items.filter((i) => !placedIds.has(i.id) && !ungroupedItems.includes(i))
    const fallbackItems = [...ungroupedItems, ...orphanItems]
    if (fallbackItems.length > 0) {
      const segment = this.uniqueSegment('mixed', usedSegments)
      usedSegments.add(segment)
      const fallbackLeaf = this.makeLeaf(state, parent, segment)
      for (const item of fallbackItems) this.attachItemToLeaf(state, fallbackLeaf, item)
      newLeafIds.push(fallbackLeaf.id)
    }

    // Delete the old leaf file from disk after the new leaves replace it.
    try {
      await fs.unlink(path.join(repoRoot, oldLeafPath))
    } catch {
      // ignore
    }

    result.splits += 1
    result.summaries.push(`split leaf "${oldLeafPath}" into ${newLeafIds.length} sibling(s)`)

    // Render each new leaf now so subsequent routing sees fresh summaries.
    for (const id of newLeafIds) {
      const newLeaf = state.graphTree.nodes[id]
      if (newLeaf) await this.regenerateSummaryAndWrite(state, repoRoot, newLeaf)
    }
  }

  private makeLeaf(state: GlobalState, parent: GraphNode, segment: string): GraphNode {
    const id = this.uniqueNodeId(state, `${parent.id}__${segment}`)
    const leaf: GraphNode = {
      id,
      kind: 'leaf',
      segment,
      path: path.posix.join(parent.path, `${segment}.md`),
      parentId: parent.id,
      summary: '',
      keywords: [],
      summaryUpdatedAt: '',
      itemIds: [],
    }
    state.graphTree.nodes[id] = leaf
    parent.childIds = [...(parent.childIds ?? []), id]
    return leaf
  }

  // ── Branch operations ──────────────────────────────────────────────────────

  /**
   * Cluster a branch's children via LLM and group each cluster under a new
   * intermediate sub-branch. Children that don't fit any cluster stay where
   * they are. This shrinks the parent's direct child count back below the cap.
   */
  private async splitBranch(
    state: GlobalState,
    repoRoot: string,
    branch: GraphNode,
    result: IndexResult,
  ): Promise<void> {
    if (branch.kind !== 'branch') return
    const childIds = branch.childIds ?? []
    if (childIds.length <= state.config.maxChildrenPerBranch) return

    const children = childIds.map((id) => state.graphTree.nodes[id]).filter((c): c is GraphNode => Boolean(c))

    const clusters = await this.runClustering(
      children.map((c) => ({ id: c.id, title: c.segment, summary: c.summary || '(no summary yet)' })),
      { reason: `branch "${branch.path}" has ${children.length} children`, segments: branch.path.split('/') },
      state.config.minClusterSize,
    )

    if (clusters.clusters.length === 0) {
      this.logger.log(`Branch split skipped for "${branch.path}" — clustering returned no groups.`)
      return
    }

    const usedSegments = new Set<string>(
      children
        .map((c) => c.segment)
        .concat((branch.childIds ?? []).map((id) => state.graphTree.nodes[id]?.segment ?? '')),
    )

    let movedAny = false
    for (const cluster of clusters.clusters) {
      const members = cluster.memberIds
        .map((id) => children.find((c) => c.id === id))
        .filter((c): c is GraphNode => Boolean(c))
      if (members.length < state.config.minClusterSize) continue

      const segment = this.uniqueSegment(slugify(cluster.name) || 'group', usedSegments)
      usedSegments.add(segment)
      const intermediate = this.makeBranch(state, branch, segment)

      for (const child of members) {
        await this.relocateUnder(state, repoRoot, child, intermediate)
        movedAny = true
      }

      await this.regenerateSummaryAndWrite(state, repoRoot, intermediate)
    }

    if (movedAny) {
      result.splits += 1
      result.summaries.push(`split branch "${branch.path}" into intermediate sub-branches`)
    }
  }

  private makeBranch(state: GlobalState, parent: GraphNode, segment: string): GraphNode {
    const id = this.uniqueNodeId(state, `${parent.id}__${segment}`)
    const branch: GraphNode = {
      id,
      kind: 'branch',
      segment,
      path: path.posix.join(parent.path, segment),
      parentId: parent.id,
      summary: '',
      keywords: [],
      summaryUpdatedAt: '',
      childIds: [],
    }
    state.graphTree.nodes[id] = branch
    parent.childIds = [...(parent.childIds ?? []), id]
    return branch
  }

  /**
   * Re-parent a node (leaf or branch) under a new parent. Updates the in-memory
   * tree, recomputes paths for the entire subtree, and renames files on disk.
   */
  private async relocateUnder(
    state: GlobalState,
    repoRoot: string,
    node: GraphNode,
    newParent: GraphNode,
  ): Promise<void> {
    const oldPath = node.path
    const oldParentId = node.parentId
    if (oldParentId) {
      const oldParent = state.graphTree.nodes[oldParentId]
      if (oldParent) oldParent.childIds = (oldParent.childIds ?? []).filter((id) => id !== node.id)
    }
    node.parentId = newParent.id
    newParent.childIds = [...(newParent.childIds ?? []), node.id]

    const newPath =
      node.kind === 'leaf'
        ? path.posix.join(newParent.path, `${node.segment}.md`)
        : path.posix.join(newParent.path, node.segment)
    this.recomputePathsRecursive(state, node, newPath)

    // Move on disk; ensure parent dir exists first.
    const oldAbs = path.join(repoRoot, oldPath)
    const newAbs = path.join(repoRoot, newPath)
    if (oldAbs !== newAbs) {
      try {
        await fs.mkdir(path.dirname(newAbs), { recursive: true })
        await fs.rename(oldAbs, newAbs)
      } catch (error) {
        await this.errorLogger.warn('IndexService', `Failed to rename ${oldAbs} -> ${newAbs}`, error)
      }
    }

    await this.removeEmptyDir(path.dirname(oldAbs))
  }

  private recomputePathsRecursive(state: GlobalState, node: GraphNode, newPath: string): void {
    node.path = newPath

    if (node.kind === 'leaf') {
      for (const itemId of node.itemIds ?? []) {
        const item = state.items.find((i) => i.id === itemId)
        if (item) {
          item.writtenPath = newPath
          item.subcategoryPath = this.subcategorySegments(state, node)
        }
      }
      return
    }

    for (const childId of node.childIds ?? []) {
      const child = state.graphTree.nodes[childId]
      if (!child) continue
      const childNewPath =
        child.kind === 'leaf'
          ? path.posix.join(newPath, `${child.segment}.md`)
          : path.posix.join(newPath, child.segment)
      this.recomputePathsRecursive(state, child, childNewPath)
    }
  }

  /**
   * Collapse a branch that has exactly one child by merging the child up one
   * level. Avoids degenerate single-corridor sub-trees that add depth without
   * adding navigation value. Root branches are never collapsed.
   */
  private async maybeCollapseSingleChild(
    state: GlobalState,
    repoRoot: string,
    branch: GraphNode,
    result: IndexResult,
  ): Promise<boolean> {
    if (branch.kind !== 'branch' || !branch.parentId) return false
    const childIds = branch.childIds ?? []
    if (childIds.length !== 1) return false

    const parent = state.graphTree.nodes[branch.parentId]
    const child = state.graphTree.nodes[childIds[0]]
    if (!parent || !child) return false

    await this.relocateUnder(state, repoRoot, child, parent)

    // Drop the now-empty branch.
    parent.childIds = (parent.childIds ?? []).filter((id) => id !== branch.id)
    delete state.graphTree.nodes[branch.id]

    try {
      await fs.rm(path.join(repoRoot, branch.path), { recursive: true, force: true })
    } catch {
      // ignore
    }

    result.merges += 1
    result.summaries.push(`collapsed single-child branch "${branch.path}"`)
    return true
  }

  // ── Fix-up walk ────────────────────────────────────────────────────────────

  /**
   * Walk from a dirty node up to the root. At each node, apply structural
   * thresholds (split/collapse), then regenerate the summary and re-render.
   * The walk stops at the root branch.
   */
  private async fixUpFrom(state: GlobalState, repoRoot: string, fromId: string, result: IndexResult): Promise<void> {
    let currentId: string | null = fromId
    while (currentId) {
      const node: GraphNode | undefined = state.graphTree.nodes[currentId]
      if (!node) break

      if (node.kind === 'leaf') {
        const itemCount = node.itemIds?.length ?? 0
        const oversize =
          itemCount > state.config.maxItemsPerLeaf ||
          (await this.estimateLeafBytes(state, node)) > state.config.maxLeafBytes

        if (oversize) {
          const parentId: string | null = node.parentId
          await this.splitLeaf(state, repoRoot, node, result)
          // Original leaf is gone; continue from parent (which now has new siblings).
          currentId = parentId
          continue
        }

        await this.regenerateSummaryAndWrite(state, repoRoot, node)
        currentId = node.parentId
        continue
      }

      // Branch
      const childCount = node.childIds?.length ?? 0
      if (childCount > state.config.maxChildrenPerBranch) {
        await this.splitBranch(state, repoRoot, node, result)
      }
      // Try collapsing single-child branches (cheap, no LLM cost).
      const collapsed = await this.maybeCollapseSingleChild(state, repoRoot, node, result)
      if (collapsed) {
        currentId = node.parentId
        continue
      }

      await this.regenerateSummaryAndWrite(state, repoRoot, node)
      currentId = node.parentId
    }
  }

  /**
   * Top-down sweep used by the standalone rebalance command. Recurses into
   * children first, then evaluates the current node — so structural changes
   * at deeper levels finish before the parent is summarized.
   */
  private async sweepNode(state: GlobalState, repoRoot: string, node: GraphNode, result: IndexResult): Promise<void> {
    if (node.kind === 'branch') {
      const childIds = [...(node.childIds ?? [])]
      for (const childId of childIds) {
        const child = state.graphTree.nodes[childId]
        if (child) await this.sweepNode(state, repoRoot, child, result)
      }

      const childCount = node.childIds?.length ?? 0
      if (childCount > state.config.maxChildrenPerBranch) {
        await this.splitBranch(state, repoRoot, node, result)
      }
      await this.maybeCollapseSingleChild(state, repoRoot, node, result)
      await this.regenerateSummaryAndWrite(state, repoRoot, node)
      return
    }

    // Leaf
    const itemCount = node.itemIds?.length ?? 0
    if (itemCount > state.config.maxItemsPerLeaf) {
      await this.splitLeaf(state, repoRoot, node, result)
      return
    }
    await this.regenerateSummaryAndWrite(state, repoRoot, node)
  }

  // ── Summary regeneration ───────────────────────────────────────────────────

  private async regenerateSummaryAndWrite(state: GlobalState, repoRoot: string, node: GraphNode): Promise<void> {
    if (node.kind === 'leaf') {
      const items = (node.itemIds ?? [])
        .map((id) => state.items.find((i) => i.id === id))
        .filter((x): x is KnowledgeItem => Boolean(x))

      if (items.length === 0) {
        // Empty leaf — clean up.
        await this.deleteLeaf(state, repoRoot, node)
        return
      }

      // Skip the LLM for trivial single-item leaves — reuse the item's own summary.
      if (items.length === 1) {
        node.summary = items[0].summary
        node.keywords = []
      } else if (this.shouldRegenerate(node)) {
        const generated = await this.generateLeafSummary(node, items)
        node.summary = generated.summary
        node.keywords = generated.keywords
      }
      node.summaryUpdatedAt = new Date().toISOString()
      await this.writer.writeLeafFile(repoRoot, node, items)
      return
    }

    // Branch
    const children = (node.childIds ?? [])
      .map((id) => state.graphTree.nodes[id])
      .filter((c): c is GraphNode => Boolean(c))

    if (children.length === 1) {
      node.summary = children[0].summary
      node.keywords = children[0].keywords
    } else if (children.length > 0 && this.shouldRegenerate(node)) {
      const generated = await this.generateBranchSummary(node, children)
      node.summary = generated.summary
      node.keywords = generated.keywords
    } else if (children.length === 0) {
      node.summary = ''
      node.keywords = []
    }
    node.summaryUpdatedAt = new Date().toISOString()
    await this.writer.writeBranchIndex(repoRoot, node, children)
  }

  /**
   * Cheap check: only regenerate the summary if it is empty or if the node
   * has been touched since its last summary timestamp. The caller updates
   * `summaryUpdatedAt` after every successful insert/split, so a node that
   * wasn't structurally changed will skip the LLM call here.
   */
  private shouldRegenerate(node: GraphNode): boolean {
    if (!node.summary) return true
    // For now, always regen on dirty walk — the fix-up walk only visits dirty nodes.
    return true
  }

  private async generateLeafSummary(leaf: GraphNode, items: KnowledgeItem[]): Promise<z.infer<typeof SummarySchema>> {
    const prompt = TextPrompt.create()
    prompt.text(`Leaf path: ${leaf.path}`)
    prompt.emptyLine()
    prompt.text('=== ITEMS ===')
    for (const item of items) {
      prompt.text(`- title: ${item.title}`)
      prompt.text(`  summary: ${item.summary}`)
    }
    prompt.emptyLine()
    prompt.text('Write one sentence summarizing the common theme, plus 3-5 keywords.')

    try {
      const response = await this.ai.generateStructured<z.infer<typeof SummarySchema>>(
        prompt.build(),
        new SummarizeLeafSystemPrompt().build().prompt,
        SummarySchema,
      )
      return response.object
    } catch (error) {
      await this.errorLogger.warn('IndexService', `Leaf summary generation failed for "${leaf.path}"`, error)
      return { summary: items.map((i) => i.title).join('; '), keywords: [] }
    }
  }

  private async generateBranchSummary(
    branch: GraphNode,
    children: GraphNode[],
  ): Promise<z.infer<typeof SummarySchema>> {
    const prompt = TextPrompt.create()
    prompt.text(`Branch path: ${branch.path}`)
    prompt.emptyLine()
    prompt.text('=== CHILDREN ===')
    for (const child of children) {
      const kindLabel = child.kind === 'branch' ? 'folder' : 'file'
      prompt.text(`- ${kindLabel} ${child.segment}: ${child.summary || '(no summary yet)'}`)
    }
    prompt.emptyLine()
    prompt.text('Write one sentence summarizing what this folder collectively covers, plus 3-5 keywords.')

    try {
      const response = await this.ai.generateStructured<z.infer<typeof SummarySchema>>(
        prompt.build(),
        new SummarizeBranchSystemPrompt().build().prompt,
        SummarySchema,
      )
      return response.object
    } catch (error) {
      await this.errorLogger.warn('IndexService', `Branch summary generation failed for "${branch.path}"`, error)
      return { summary: children.map((c) => c.segment).join(', '), keywords: [] }
    }
  }

  // ── Clustering ─────────────────────────────────────────────────────────────

  private async runClustering(
    members: { id: string; title: string; summary: string }[],
    ctx: SplitContext,
    minClusterSize: number,
  ): Promise<z.infer<typeof ClusterSchema>> {
    const prompt = TextPrompt.create()
    prompt.text(`Clustering trigger: ${ctx.reason}.`)
    prompt.text(`Branch path: ${ctx.segments.join(' / ')}.`)
    prompt.text(`Each subgroup must contain at least ${minClusterSize} entries.`)
    prompt.emptyLine()
    prompt.text('=== ENTRIES ===')
    for (const member of members) {
      prompt.text(`- id=${member.id} | title="${member.title}" | summary=${member.summary}`)
    }

    try {
      const response = await this.ai.generateStructured<z.infer<typeof ClusterSchema>>(
        prompt.build(),
        new ClusterSystemPrompt().build().prompt,
        ClusterSchema,
      )
      return response.object
    } catch (error) {
      await this.errorLogger.warn('IndexService', `Clustering failed at "${ctx.segments.join('/')}"`, error)
      return { clusters: [], ungrouped: members.map((m) => m.id) }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async estimateLeafBytes(state: GlobalState, leaf: GraphNode): Promise<number> {
    const items = (leaf.itemIds ?? [])
      .map((id) => state.items.find((i) => i.id === id))
      .filter((x): x is KnowledgeItem => Boolean(x))
    let total = 0
    for (const item of items) {
      total += item.title.length + item.summary.length + item.content.length + 200
    }
    return total
  }

  private subcategorySegments(state: GlobalState, leaf: GraphNode): string[] {
    const segments: string[] = []
    let current: GraphNode | undefined = leaf
    while (current && current.parentId) {
      const parent: GraphNode | undefined = state.graphTree.nodes[current.parentId]
      if (!parent) break
      // Skip the root category; subcategoryPath is relative to it.
      if (parent.parentId === null) break
      segments.unshift(parent.segment)
      current = parent
    }
    return segments
  }

  private proposeLeafName(item: KnowledgeItem, parent: GraphNode): string {
    const fromTitle = slugify(item.title)
    if (fromTitle) return fromTitle
    return `${parent.segment}-leaf`
  }

  private uniqueChildSegment(state: GlobalState, parent: GraphNode, base: string): string {
    const used = new Set<string>(
      (parent.childIds ?? []).map((id) => state.graphTree.nodes[id]?.segment).filter((s): s is string => Boolean(s)),
    )
    return this.uniqueSegment(base, used)
  }

  private uniqueSegment(base: string, used: Set<string>): string {
    if (!used.has(base)) return base
    let counter = 2
    while (used.has(`${base}-${counter}`)) counter += 1
    return `${base}-${counter}`
  }

  private uniqueNodeId(state: GlobalState, base: string): string {
    if (!state.graphTree.nodes[base]) return base
    let counter = 2
    while (state.graphTree.nodes[`${base}-${counter}`]) counter += 1
    return `${base}-${counter}`
  }

  private async removeEmptyDir(folder: string): Promise<void> {
    try {
      const entries = await fs.readdir(folder)
      if (entries.length === 0) await fs.rmdir(folder)
    } catch {
      // ignore
    }
  }
}
