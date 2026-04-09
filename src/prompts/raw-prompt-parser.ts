import { BasePromptParser } from '@/prompts/base-prompt-parser.js'
import { RawPromptBuilder } from '@/prompts/raw-prompt-builder.js'

export class RawPromptParser extends BasePromptParser<string> {
  constructor() {
    super()
  }

  public createBuilder() {
    return new RawPromptBuilder()
  }

  public async parseResponse(content: string, _completed = true): Promise<string> {
    return content.trim()
  }
}
