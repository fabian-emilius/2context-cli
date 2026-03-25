import type { BasePromptBuilder } from '@/prompts/base-prompt-builder.js'
import type { BasePromptParser } from '@/prompts/base-prompt-parser.js'

export abstract class BasePromptFactory<T> {
  public abstract createPromptBuilder(): BasePromptBuilder<T>
  public abstract createPromptParser(): BasePromptParser<T>
}
