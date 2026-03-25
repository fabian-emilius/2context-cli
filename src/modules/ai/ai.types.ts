export interface GenerateTextOptions {
  prompt: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}

export interface GenerateTextResult {
  text: string
  usage?: {
    inputTokens: number | undefined
    outputTokens: number | undefined
    totalTokens: number | undefined
  }
}

export interface StreamTextOptions extends GenerateTextOptions {
  onChunk?: (chunk: string) => void
}
