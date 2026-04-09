import { FileSystem } from '@/helpers/fs.js'

const SECTION_MARKER = '## Knowledge Context'

const SECTION_TEMPLATE = (date: string, commitCount: number, groupCount: number) => `## Knowledge Context

This project uses 2context for AI-assisted knowledge extraction from commit history.

**Before making changes, check these knowledge sources:**

- **Directory-level knowledge:** Look for \`KNOWLEDGE.md\` files in the directory you're working with. These contain file/folder-specific patterns, conventions, and decisions.
- **General codebase knowledge:** Check \`.2context/knowledge/\` for broader architectural and convention documentation:
  - \`architecture/\` — System design patterns and structural decisions
  - \`convention/\` — Coding standards, naming rules, file organization
  - \`decision/\` — Technical decisions with rationale
  - \`pattern/\` — Recurring implementation patterns

> Last analyzed: ${date} | Commits: ${commitCount} | Feature groups: ${groupCount}
`

/**
 * Updates CLAUDE.md or AGENTS.md with a Knowledge Context reference section.
 */
export class AgentFileUpdater {
  private readonly fs: FileSystem

  constructor(repoRoot: string) {
    this.fs = new FileSystem(repoRoot)
  }

  async update(stats: { commitCount: number; groupCount: number }): Promise<string> {
    const date = new Date().toISOString().split('T')[0]
    const sectionContent = SECTION_TEMPLATE(date, stats.commitCount, stats.groupCount)

    // Check for existing agent files
    const claudeFile = 'CLAUDE.md'
    const agentsFile = 'AGENTS.md'

    let targetFile: string

    if (await this.fs.pathExists(claudeFile)) {
      targetFile = claudeFile
    } else if (await this.fs.pathExists(agentsFile)) {
      targetFile = agentsFile
    } else {
      // Create CLAUDE.md
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

    // Find the end of the Knowledge Context section.
    // Walk line-by-line from the marker to find either:
    //   - a new heading at the same level (## …) that is NOT the marker itself
    //   - end of file
    const lines = content.split('\n')
    let startLine = -1
    let endLine = lines.length

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(SECTION_MARKER)) {
        startLine = i
        continue
      }

      // Once we've found the start, look for the next heading of any level
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
