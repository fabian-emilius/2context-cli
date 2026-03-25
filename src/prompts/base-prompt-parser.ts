import type { LLMMessage } from '@/constants/llm.js'
import { LLMRole } from '@/constants/llm.js'
import type { BasePromptBuilder } from '@/prompts/base-prompt-builder.js'

export abstract class BasePromptParser<T> {
  public abstract createBuilder(): BasePromptBuilder<T>
  public abstract parseResponse(response: { messages: LLMMessage[] }, completed: boolean): Promise<T>

  protected extractContent(response: { messages: LLMMessage[] }) {
    const filteredMessages = response.messages.filter(
      (message) => message.role === LLMRole.Assistant && message.content,
    )

    return filteredMessages[filteredMessages.length - 1]?.content || ''
  }
}
