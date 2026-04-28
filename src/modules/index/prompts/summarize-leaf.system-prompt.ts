import { SystemPrompt } from '@/prompts/system-prompt.js'

/**
 * Generates a one-sentence summary of a leaf file's contents from the titles
 * and summaries of the items grouped into that leaf. Used during insert and
 * after splits/merges so the parent can route subsequent items correctly.
 */
export class SummarizeLeafSystemPrompt extends SystemPrompt {
  constructor() {
    super(
      'You write very short topic summaries for a knowledge index. Your output is read by another agent who is ' +
        'deciding whether to descend into this file, so it must be concrete and discriminating.',
      [
        {
          name: 'summary_principles',
          content:
            'Rules:\n' +
            '- Output ONE sentence (≤ 25 words) covering the common theme of the items.\n' +
            '- Be specific about the topic. Do not say "various findings" or "a collection of insights".\n' +
            '- If the items are heterogeneous, name 2-3 of the most representative topics in a list form within one sentence.\n' +
            '- Also propose 3-5 short kebab-case keywords useful for navigation.',
        },
      ],
    )
    this.setTemperature(0)
  }
}
