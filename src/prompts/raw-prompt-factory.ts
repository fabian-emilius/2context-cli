import { BasePromptFactory } from '@/prompts/base-prompt-factory.js'
import { RawPromptBuilder } from '@/prompts/raw-prompt-builder.js'
import { RawPromptParser } from '@/prompts/raw-prompt-parser.js'

export class RawPromptFactory extends BasePromptFactory<string> {
  constructor() {
    super()
  }

  public createPromptBuilder() {
    return new RawPromptBuilder()
  }

  public createPromptParser() {
    return new RawPromptParser()
  }
}
