import { SystemPrompt } from '@/prompts/system-prompt.js'

/**
 * Used to route a single new knowledge item to the right child of a branch
 * during top-down insert. The caller shows the LLM the branch's child
 * summaries (each one already an LLM-generated 1-sentence overview) plus the
 * incoming item's title and summary, and asks it to either descend into one
 * of the children or create a new sibling under this branch.
 */
export class RouteItemSystemPrompt extends SystemPrompt {
  constructor() {
    super(
      'You are a knowledge librarian routing a new piece of knowledge into a self-balancing index. ' +
        'At each branch, decide which existing child it best belongs in, or whether a new sibling should be created.',
      [
        {
          name: 'routing_principles',
          content:
            'How to choose:\n' +
            '- Read the branch path so you know what category we are in.\n' +
            '- Compare the new item to each child summary — pick the one whose theme genuinely matches.\n' +
            "- Only return `createNewSibling: true` when none of the existing children covers the topic; do not invent siblings to reduce a child's size.\n" +
            '- A weak match is still better than a brand-new sibling unless the gap is obvious.\n' +
            '- If you create a new sibling, propose a short kebab-case `newSiblingName` (2-4 words max) that names the topic.',
        },
      ],
      ['Prefer descending into an existing child whenever the topic plausibly fits.'],
    )

    this.setTemperature(0)
  }
}
