import type { LLMMessage } from '@/constants/llm.js'
import { LLMRole } from '@/constants/llm.js'

export class MessageBuilder {
  buildUserMessage(content: string): LLMMessage {
    return {
      role: LLMRole.User,
      thoughts: [],
      content,
      files: [],
      functionCalls: [],
      functionResults: [],
    }
  }

  checkForStopToken(messages: LLMMessage[], stopToken: string): boolean {
    return messages.some((message) => message.content.includes(stopToken))
  }
}
