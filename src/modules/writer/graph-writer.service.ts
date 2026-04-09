import path from 'node:path'

import { Injectable } from '@nestjs/common'

import { FileSystem } from '@/helpers/fs.js'
import type { KnowledgeItem } from '@/modules/adapters/adapter.types.js'
import { KNOWLEDGE_CATEGORY_LABELS, ROOT_CATEGORIES } from '@/modules/adapters/adapter.types.js'
import type { GlobalState } from '@/modules/state/state.types.js'

interface SubcategoryNode {
  segment: string
  items: KnowledgeItem[]
  children: Map<string, SubcategoryNode>
}

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
 * The file is the single entry point an agent reads before starting a task.
 */
@Injectable()
export class GraphWriterService {
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
    const central = state.items.filter((i) => i.scope.type === 'general')

    const coLocatedDirs = this.groupCoLocated(coLocated)
    const categoryCount = new Set(central.map((i) => i.category)).size

    let out = ''
    out += `# Knowledge Graph\n\n`
    out += `_Last updated: ${state.lastRunDate} · ${totalItems} items · ${coLocatedDirs.size} co-located files · ${categoryCount} categor${categoryCount === 1 ? 'y' : 'ies'}_\n\n`
    out += `> **Agents:** this is the entry point. Scan the headings below to find relevant knowledge before starting work. If you discover something new that belongs here, mention it so it can be captured via \`2context ingest\`.\n\n`

    if (state.projectSummary) {
      out += `## Project summary\n${state.projectSummary}\n\n`
    }

    out += this.renderCoLocated(coLocatedDirs)
    out += this.renderCentral(central)
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

  private renderCentral(items: KnowledgeItem[]): string {
    let out = '## Central graph\n\n'

    for (const category of ROOT_CATEGORIES) {
      const categoryItems = items.filter((i) => i.category === category)
      if (categoryItems.length === 0) continue

      const label = KNOWLEDGE_CATEGORY_LABELS[category]
      out += `### ${label.toLowerCase()} (${categoryItems.length} items)\n`

      const tree = this.buildSubcategoryTree(categoryItems)
      out += this.renderSubcategoryTree(tree, 0)
      out += '\n'
    }

    return out
  }

  private buildSubcategoryTree(items: KnowledgeItem[]): Map<string, SubcategoryNode> {
    const root = new Map<string, SubcategoryNode>()
    // Use a sentinel segment '' for the flat (no subcategory) bucket under each category.
    const flatBucket: SubcategoryNode = { segment: '', items: [], children: new Map() }

    for (const item of items) {
      if (item.subcategoryPath.length === 0) {
        flatBucket.items.push(item)
        continue
      }

      let currentChildren = root
      let currentNode: SubcategoryNode | null = null

      for (const segment of item.subcategoryPath) {
        let next = currentChildren.get(segment)
        if (!next) {
          next = { segment, items: [], children: new Map() }
          currentChildren.set(segment, next)
        }
        currentNode = next
        currentChildren = next.children
      }

      if (currentNode) currentNode.items.push(item)
    }

    if (flatBucket.items.length > 0) {
      root.set('', flatBucket)
    }

    return root
  }

  private renderSubcategoryTree(tree: Map<string, SubcategoryNode>, depth: number): string {
    let out = ''
    const entries = [...tree.entries()].sort(([a], [b]) => {
      // Flat bucket always last so named subcategories are listed first
      if (a === '' && b !== '') return 1
      if (b === '' && a !== '') return -1
      return a.localeCompare(b)
    })

    for (const [segment, node] of entries) {
      const indent = '  '.repeat(depth)
      if (segment) {
        const count = this.countItemsRecursive(node)
        out += `${indent}- **${segment}/** (${count})\n`
        out += this.renderSubcategoryTree(node.children, depth + 1)
        for (const item of node.items) {
          out += this.renderItemLine(item, depth + 1)
        }
      } else {
        for (const item of node.items) {
          out += this.renderItemLine(item, depth)
        }
      }
    }

    return out
  }

  private countItemsRecursive(node: SubcategoryNode): number {
    let count = node.items.length
    for (const child of node.children.values()) {
      count += this.countItemsRecursive(child)
    }
    return count
  }

  private renderItemLine(item: KnowledgeItem, depth: number): string {
    const indent = '  '.repeat(depth)
    const sourcesTag = item.sources.length > 0 ? ` [${item.sources.join(', ')}]` : ''
    return `${indent}- *${item.title}* — ${item.summary}${sourcesTag}\n`
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
