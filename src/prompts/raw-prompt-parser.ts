import type { LLMMessage } from '@/constants/llm.js'
import { BasePromptParser } from '@/prompts/base-prompt-parser.js'
import { RawPromptBuilder } from '@/prompts/raw-prompt-builder.js'

export class RawPromptParser extends BasePromptParser<string> {
  constructor() {
    super()
  }

  public createBuilder() {
    return new RawPromptBuilder()
  }

  public async parseResponse(response: { messages: LLMMessage[] }, completed = true): Promise<string> {
    return this.parseContent(this.extractContent(response), completed)
  }

  private parseContent(content: string, _completed: boolean): string {
    return content.trim()
  }
}
