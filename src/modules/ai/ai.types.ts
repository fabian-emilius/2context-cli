import type { FullOutput, MastraModelOutput } from '@mastra/core/stream'

/** Re-export Mastra types for convenience. */
export type { FullOutput, MastraModelOutput }

export interface StreamTextOptions {
  prompt: string
  systemPrompt?: string
  temperature?: number
  onChunk?: (chunk: string) => void
}
