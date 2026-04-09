import { FileSystem } from '@/helpers/fs.js'

const SECTION_MARKER = '## Knowledge Context'

const SECTION_TEMPLATE = (date: string, totalItems: number, coLocatedFiles: number) => `## Knowledge Context

**Before starting any task, read \`.2context/KNOWLEDGE_GRAPH.md\` first.**

That file is the index of everything this project has learned:
- Co-located \`KNOWLEDGE.md\` files next to the code they describe (architectural decisions, pitfalls, conventions scoped to a directory)
- A central knowledge graph under \`.2context/graph/\` organized by category: architecture, convention, decision, pattern

Always check whether relevant knowledge already exists before making architectural decisions or implementing patterns. If you discover something that should be documented, mention it in your response so it can be captured by running \`2context ingest\`.

_Managed by 2context. Last updated: ${date} · ${totalItems} items, ${coLocatedFiles} co-located files._
`

/**
 * Updates CLAUDE.md or AGENTS.md with a Knowledge Context reference section.
 */
export class AgentFileUpdater {
  private readonly fs: FileSystem

  constructor(repoRoot: string) {
    this.fs = new FileSystem(repoRoot)
  }

  async update(stats: { totalItems: number; coLocatedFiles: number }): Promise<string> {
    const date = new Date().toISOString()
    const sectionContent = SECTION_TEMPLATE(date, stats.totalItems, stats.coLocatedFiles)

    const claudeFile = 'CLAUDE.md'
    const agentsFile = 'AGENTS.md'

    let targetFile: string
    if (await this.fs.pathExists(claudeFile)) {
      targetFile = claudeFile
    } else if (await this.fs.pathExists(agentsFile)) {
      targetFile = agentsFile
    } else {
      targetFile = claudeFile
    }

    let content = (await this.fs.readFileOrNull(targetFile)) || ''

    if (content.includes(SECTION_MARKER)) {
      content = this.replaceSection(content, sectionContent)
    } else {
      if (content && !content.endsWith('\n')) {
        content += '\n'
      }
      content += '\n' + sectionContent
    }

    await this.fs.writeFileWithDir(targetFile, content)

    return targetFile
  }

  private replaceSection(content: string, newSection: string): string {
    const markerIndex = content.indexOf(SECTION_MARKER)

    if (markerIndex === -1) return content + '\n' + newSection

    const lines = content.split('\n')
    let startLine = -1
    let endLine = lines.length

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(SECTION_MARKER)) {
        startLine = i
        continue
      }

      if (startLine !== -1 && i > startLine && /^#{1,6} /.test(lines[i])) {
        endLine = i
        break
      }
    }

    if (startLine === -1) return content + '\n' + newSection

    const before = lines.slice(0, startLine).join('\n').trimEnd()
    const after = lines.slice(endLine).join('\n')

    return before + '\n\n' + newSection + (after ? '\n' + after : '')
  }
}
