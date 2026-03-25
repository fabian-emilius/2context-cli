import type { LLMMessage } from '@/constants/llm.js'
import { LLMRole } from '@/constants/llm.js'

export function buildUserLLMMessage(content: string): LLMMessage {
  return {
    role: LLMRole.User,
    thoughts: [],
    content,
    files: [],
    functionCalls: [],
    functionResults: [],
  }
}

export function checkForStopToken(messages: LLMMessage[], stopToken: string): boolean {
  return messages.some((message) => message.content.includes(stopToken))
}
