import { BasePromptBuilder } from '@/prompts/base-prompt-builder.js'
import { RawPromptParser } from '@/prompts/raw-prompt-parser.js'

export class RawPromptBuilder extends BasePromptBuilder<string> {
  constructor() {
    super()
  }

  public createParser() {
    return new RawPromptParser()
  }

  protected hasOutput() {
    return false
  }

  protected generateOutputGuidelines() {
    return []
  }

  protected generateOutputTypeDefinitions() {
    return ''
  }

  protected generateOutputExample() {
    return ''
  }
}
