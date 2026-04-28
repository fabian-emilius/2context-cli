import { SystemPrompt } from '@/prompts/system-prompt.js'

/**
 * Generates a one-sentence summary of a branch directory from the summaries
 * of its direct children (which can themselves be leaves or branches). The
 * output ends up in the branch's `_index.md` and in the parent's child outline.
 */
export class SummarizeBranchSystemPrompt extends SystemPrompt {
  constructor() {
    super(
      'You write very short topic summaries for a knowledge index. Your output is read by another agent who is ' +
        'deciding whether to descend into this folder, so it must be concrete and discriminating.',
      [
        {
          name: 'summary_principles',
          content:
            'Rules:\n' +
            '- Output ONE sentence (≤ 25 words) covering what the children collectively address.\n' +
            '- Be specific about the topic. Do not say "various subcategories" or "miscellaneous".\n' +
            '- If the children span multiple themes, name 2-3 of the dominant ones within one sentence.\n' +
            '- Also propose 3-5 short kebab-case keywords useful for navigation.',
        },
      ],
    )
    this.setTemperature(0)
  }
}
