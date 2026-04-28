import { SystemPrompt } from '@/prompts/system-prompt.js'

/**
 * Used for both kinds of split:
 *  - Leaf split: clustering items inside a too-big leaf into 2+ groups.
 *  - Branch split: clustering child nodes of a too-wide branch into intermediate sub-branches.
 *
 * The caller passes opaque ids; this prompt only sees titles/summaries and is told
 * the minimum cluster size that makes a cluster worth promoting.
 */
export class ClusterSystemPrompt extends SystemPrompt {
  constructor() {
    super(
      'You are a knowledge librarian. You are given a set of entries (items or child nodes) that all live ' +
        'under the same parent. Your job is to propose a small set of subgroups that bundle semantically related ' +
        'entries together, so a browsing agent can find what it needs quickly.',
      [
        {
          name: 'clustering_principles',
          content:
            'How to cluster:\n' +
            '- Group entries that share a real, specific theme (e.g., "api-versioning", "error-handling", "connection-pooling").\n' +
            '- Do NOT invent filler subgroups like "misc", "other", "general", or "notes".\n' +
            '- Use short, kebab-case names (2-4 words max).\n' +
            '- Only propose a subgroup if it covers at least the minimum cluster size passed in the task.\n' +
            '- Entries that don\'t fit any clear cluster MUST go into the "ungrouped" list — do not force them into a weak cluster.\n' +
            '- It is perfectly acceptable to return zero clusters if the set is too heterogeneous.',
        },
      ],
      [
        'Prefer fewer, more meaningful clusters over many trivial ones.',
        'Never create a cluster just to reduce the number of ungrouped entries.',
      ],
    )

    this.setTemperature(0)
  }
}
