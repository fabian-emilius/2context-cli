import path from 'node:path'

import { pathExists, readFileOrNull, writeFileWithDir } from '@/helpers/fs.js'

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
export async function updateAgentFile(
  repoRoot: string,
  stats: { commitCount: number; groupCount: number },
): Promise<string> {
  const date = new Date().toISOString().split('T')[0]
  const sectionContent = SECTION_TEMPLATE(date, stats.commitCount, stats.groupCount)

  // Check for existing agent files
  const claudeFile = path.join(repoRoot, 'CLAUDE.md')
  const agentsFile = path.join(repoRoot, 'AGENTS.md')

  let targetFile: string

  if (await pathExists(claudeFile)) {
    targetFile = claudeFile
  } else if (await pathExists(agentsFile)) {
    targetFile = agentsFile
  } else {
    // Create CLAUDE.md
    targetFile = claudeFile
  }

  let content = (await readFileOrNull(targetFile)) || ''

  if (content.includes(SECTION_MARKER)) {
    content = replaceSection(content, sectionContent)
  } else {
    if (content && !content.endsWith('\n')) {
      content += '\n'
    }
    content += '\n' + sectionContent
  }

  await writeFileWithDir(targetFile, content)

  return path.relative(repoRoot, targetFile)
}

function replaceSection(content: string, newSection: string): string {
  const markerIndex = content.indexOf(SECTION_MARKER)

  if (markerIndex === -1) return content + '\n' + newSection

  // Find the end of the section (next ## heading or end of file)
  const afterMarker = content.indexOf('\n', markerIndex)
  let endIndex = content.length

  // Look for next section heading
  const nextHeading = content.indexOf('\n## ', afterMarker + 1)
  if (nextHeading !== -1) {
    endIndex = nextHeading
  }

  const before = content.substring(0, markerIndex).trimEnd()
  const after = content.substring(endIndex)

  return before + '\n\n' + newSection + after
}
