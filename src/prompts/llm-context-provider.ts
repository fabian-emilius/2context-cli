import type { LLMFunctionDefinition } from '@/constants/llm.js'
import type { ISystemPromptSection } from '@/prompts/system-prompt.js'

export type LLMFunction =
  | {
      auto: true
      definition: LLMFunctionDefinition
      loadingText?: string
      getLoadingText?: (args: Record<string, unknown>) => Promise<string>
      executeFunction: (args: Record<string, unknown>) => Promise<string>
    }
  | {
      auto: false
      definition: LLMFunctionDefinition
      loadingText?: string
    }

export abstract class LlmContextProvider {
  public abstract readonly name: string

  public abstract getSystemPromptSections(): Promise<ISystemPromptSection[]>
  public abstract getFunctions(): Promise<LLMFunction[]>

  public async clearCache(): Promise<void> {}
}
