import { KNOWLEDGE_CATEGORY_DESCRIPTIONS } from '@/modules/adapters/adapter.types.js'
import type { FeatureGroup } from '@/modules/adapters/git-commits/git-commits.types.js'
import type { CommitDiff } from '@/modules/git/git.types.js'
import { SystemPrompt } from '@/prompts/system-prompt.js'
import { TextPrompt } from '@/prompts/text-prompt.js'

export class InsightExtractionSystemPrompt extends SystemPrompt {
  constructor() {
    const categoryList = Object.entries(KNOWLEDGE_CATEGORY_DESCRIPTIONS)
      .map(([key, desc]) => `- ${key}: ${desc}`)
      .join('\n')

    super(
      'You are an architectural decision extractor. You examine groups of related git commits to identify ' +
        'architectural decisions, coding conventions, and patterns that future developers and AI agents need to know. ' +
        'You do NOT summarize what code changed — you only extract decisions that establish precedent.',
      [
        {
          name: 'extraction_principles',
          content:
            'What to extract:\n' +
            '- Architectural decisions: new patterns, design choices, or conventions that set a precedent\n' +
            '- Examples: "We now use X pattern for Y", "Service communication uses Z approach", "Error handling follows this convention"\n' +
            '- Technical lessons: what was tried, what failed, what was changed and why\n' +
            '- Only extract knowledge that a developer or AI agent would need when implementing FUTURE features\n' +
            '\n' +
            'What NOT to extract:\n' +
            '- Do NOT summarize what the commits changed\n' +
            '- Do NOT describe implementation details of the specific feature built\n' +
            '- Do NOT extract routine bug fixes, dependency updates, or trivial changes\n' +
            '- If a commit group only implements features without introducing new patterns, produce NO outputs\n' +
            '\n' +
            'Quality bar:\n' +
            '- Ask yourself: "Would a developer working on a different feature need to know this?"\n' +
            '- If the answer is no, do not extract it\n' +
            '- It is perfectly fine — and expected — to produce ZERO outputs for many commit groups\n' +
            '- Only the most architecturally significant changes should produce outputs',
        },
        {
          name: 'scope_classification',
          content:
            'For each insight, determine its scope:\n' +
            '- "file" scope: The insight is specific to a particular file. Provide the filePath.\n' +
            '- "folder" scope: The insight applies to a directory/module. Provide the folderPath.\n' +
            '- "general" scope: The insight applies to the entire codebase.\n' +
            '\n' +
            'Use the most specific scope that makes sense. If a pattern applies only to src/auth/, use folder scope.\n' +
            'If it applies broadly across the project, use general scope.',
        },
        {
          name: 'knowledge_categories',
          content: 'Classify each insight into one of these categories:\n' + categoryList,
        },
        {
          name: 'summary_requirement',
          content:
            'For each insight, also provide a SUMMARY: a single, self-contained sentence (≤ 25 words) that ' +
            'conveys the gist of the insight without needing the body. This summary will appear in the project index ' +
            '(KNOWLEDGE_GRAPH.md), so an agent must be able to decide relevance from the summary alone.',
        },
      ],
      [
        'Never summarize code changes — only extract decisions and patterns.',
        'Producing zero outputs is the correct result for many commit groups.',
        'Write each insight as a reusable guideline: "When doing X, use Y approach because Z".',
        'Include concrete file paths as examples to ground each insight.',
        'Every insight must include a one-sentence summary suitable for an index.',
      ],
    )

    this.setTemperature(0)
  }
}

export function buildInsightExtractionPrompt(group: FeatureGroup, diffs: CommitDiff[]): string {
  const prompt = TextPrompt.create()

  prompt.text('=== TASK ===')
  prompt.text(`Analyze the commit group "${group.name}" to extract architectural decisions, conventions, and patterns.`)
  prompt.text(
    'Do NOT summarize what changed. Only extract decisions that a developer working on a different feature would need to know.',
  )
  prompt.emptyLine()

  prompt.section('group', group.description, { name: group.name })
  prompt.emptyLine()

  prompt.text('=== COMMITS ===')
  for (const commit of group.commits) {
    prompt.text(`[${commit.shortHash}] ${commit.date} by ${commit.author}: ${commit.message}`)
  }
  prompt.emptyLine()

  if (group.primaryFiles.length > 0) {
    prompt.text('=== PRIMARY FILES ===')
    prompt.list(group.primaryFiles)
    prompt.emptyLine()
  }

  if (diffs.length > 0) {
    prompt.text('=== FILE CHANGES ===')
    const diffPrompt = TextPrompt.create()

    for (const commitDiff of diffs) {
      for (const file of commitDiff.files) {
        if (file.diff && !isNoiseFile(file.filename)) {
          diffPrompt.section('diff', file.diff, {
            file: file.filename,
            commit: commitDiff.commit.shortHash,
          })
        }
      }
    }

    prompt.text(diffPrompt.build())
  }

  prompt.emptyLine()
  prompt.text(
    'IMPORTANT: It is expected to produce zero insights for routine changes. ' +
      'Only output insights for genuine architectural decisions and patterns. ' +
      'Every insight you DO emit must include a single-sentence summary suitable for an index.',
  )

  return prompt.build()
}

/**
 * Filter out noise files that rarely contain architectural insights.
 */
function isNoiseFile(filename: string): boolean {
  const noisePatterns = [
    /package-lock\.json$/,
    /yarn\.lock$/,
    /pnpm-lock\.yaml$/,
    /\.lock$/,
    /node_modules\//,
    /dist\//,
    /\.min\./,
    /\.map$/,
    /\.d\.ts$/,
    /\.snap$/,
    /\.png$/,
    /\.jpg$/,
    /\.svg$/,
    /\.ico$/,
    /\.woff/,
    /\.ttf$/,
    /\.eot$/,
  ]

  return noisePatterns.some((pattern) => pattern.test(filename))
}
