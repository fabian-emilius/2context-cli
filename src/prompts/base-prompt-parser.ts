import type { BasePromptBuilder } from '@/prompts/base-prompt-builder.js'

export abstract class BasePromptParser<T> {
  public abstract createBuilder(): BasePromptBuilder<T>
  public abstract parseResponse(content: string, completed: boolean): Promise<T>
}
