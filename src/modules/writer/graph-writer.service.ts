import path from 'node:path'

import { Injectable } from '@nestjs/common'

import { FileSystem } from '@/helpers/fs.js'
import type { KnowledgeItem } from '@/modules/adapters/adapter.types.js'
import { KNOWLEDGE_CATEGORY_LABELS, ROOT_CATEGORIES } from '@/modules/adapters/adapter.types.js'
import type { GlobalState, GraphNode } from '@/modules/state/state.types.js'

export interface SourceSummary {
  id: string
  label: string
  cursor: string | null
  lastRun: string
  totalItemsExtracted: number
  materialProcessed: number
}

/**
 * Regenerates `.2context/KNOWLEDGE_GRAPH.md` from the global state.
 *
 * The output is intentionally shallow: a project blurb, then a top-level
 * outline of co-located dirs, then each root category's first 1-2 levels of
 * tree with summaries. Agents drill deeper by reading the per-folder
 * `_index.md` files — they should not need to read the entire graph from this
 * one file.
 */
@Injectable()
export class GraphWriterService {
  /** How many tree levels to render under each root category. */
  private static readonly TREE_DEPTH_LIMIT = 2

  public async rebuild(
    repoRoot: string,
    targetPath: string,
    state: GlobalState,
    sources: SourceSummary[],
  ): Promise<void> {
    const filesystem = new FileSystem(repoRoot)
    const content = this.render(state, sources)
    await filesystem.writeFileWithDir(targetPath, content)
  }

  private render(state: GlobalState, sources: SourceSummary[]): string {
    const totalItems = state.items.length
    const coLocated = state.items.filter((i) => i.scope.type !== 'general')

    const coLocatedDirs = this.groupCoLocated(coLocated)
    const totalLeafFiles = Object.values(state.graphTree.nodes).filter((n) => n.kind === 'leaf').length

    let out = ''
    out += `# Knowledge Graph\n\n`
    out += `_Last updated: ${state.lastRunDate} · ${totalItems} items · ${totalLeafFiles} central leaf file${totalLeafFiles === 1 ? '' : 's'} · ${coLocatedDirs.size} co-located file${coLocatedDirs.size === 1 ? '' : 's'}_\n\n`
    out +=
      `> **Agents:** start here. Each category below points at a folder under \`.2context/graph/\`. ` +
      `Open the \`_index.md\` inside any folder to see its child summaries and decide where to descend. ` +
      `Leaf \`.md\` files contain the actual findings, grouped by topic.\n\n`

    if (state.projectSummary) {
      out += `## Project summary\n${state.projectSummary}\n\n`
    }

    out += this.renderCoLocated(coLocatedDirs)
    out += this.renderCentral(state)
    out += this.renderSources(sources)

    return out
  }

  private groupCoLocated(items: KnowledgeItem[]): Map<string, KnowledgeItem[]> {
    const map = new Map<string, KnowledgeItem[]>()
    for (const item of items) {
      const dir = path.dirname(item.writtenPath)
      const existing = map.get(dir) ?? []
      existing.push(item)
      map.set(dir, existing)
    }
    return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)))
  }

  private renderCoLocated(dirs: Map<string, KnowledgeItem[]>): string {
    if (dirs.size === 0) return ''
    let out = '## Co-located knowledge\n\n'
    out += 'Directories with a local `KNOWLEDGE.md`:\n\n'

    for (const [dir, items] of dirs) {
      out += `- **\`${dir}/\`** (${items.length} item${items.length === 1 ? '' : 's'})\n`
      for (const item of items) {
        const sourcesTag = item.sources.length > 0 ? ` [${item.sources.join(', ')}]` : ''
        out += `  - *${item.title}* — ${item.summary}${sourcesTag}\n`
      }
    }

    out += '\n'
    return out
  }

  private renderCentral(state: GlobalState): string {
    let out = '## Central graph\n\n'
    out += 'Each root category is a self-balancing tree. Open `_index.md` inside any folder for child summaries.\n\n'

    for (const category of ROOT_CATEGORIES) {
      const rootId = state.graphTree.rootIds[String(category)]
      const root = rootId ? state.graphTree.nodes[rootId] : undefined
      if (!root) continue

      const itemCount = this.countItemsInSubtree(state, root)
      const label = KNOWLEDGE_CATEGORY_LABELS[category]
      out += `### ${label.toLowerCase()} (${itemCount} item${itemCount === 1 ? '' : 's'})\n`
      if (root.summary) {
        out += `${root.summary}\n\n`
      } else {
        out += `_No knowledge yet._\n\n`
      }
      out += this.renderChildren(state, root, 0)
      out += '\n'
    }

    return out
  }

  private renderChildren(state: GlobalState, node: GraphNode, depth: number): string {
    if (depth >= GraphWriterService.TREE_DEPTH_LIMIT) return ''
    const childIds = node.childIds ?? []
    if (childIds.length === 0) return ''

    let out = ''
    const indent = '  '.repeat(depth)

    for (const childId of childIds) {
      const child = state.graphTree.nodes[childId]
      if (!child) continue

      const filename = child.kind === 'leaf' ? `${child.segment}.md` : `${child.segment}/`
      const itemCount = this.countItemsInSubtree(state, child)
      const summary = child.summary || '_(no summary yet)_'
      out += `${indent}- **\`${filename}\`** (${itemCount}) — ${summary}\n`

      if (child.kind === 'branch') {
        out += this.renderChildren(state, child, depth + 1)
      }
    }

    return out
  }

  private countItemsInSubtree(state: GlobalState, node: GraphNode): number {
    if (node.kind === 'leaf') return node.itemIds?.length ?? 0
    let total = 0
    for (const childId of node.childIds ?? []) {
      const child = state.graphTree.nodes[childId]
      if (child) total += this.countItemsInSubtree(state, child)
    }
    return total
  }

  private renderSources(sources: SourceSummary[]): string {
    if (sources.length === 0) return ''
    let out = '## Sources\n\n'
    for (const source of sources) {
      const cursorPart = source.cursor ? ` · cursor \`${source.cursor.slice(0, 8)}\`` : ''
      out += `- **${source.label}** (${source.id})${cursorPart} · last run ${source.lastRun} · ${source.totalItemsExtracted} items from ${source.materialProcessed} items processed\n`
    }
    return out
  }
}
