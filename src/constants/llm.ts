export enum LLMRole {
  User = 'user',
  Assistant = 'assistant',
}

export type LLMFunctionDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: {
    title: string
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
}

export type LLMSystemMessage = {
  prompt: string
  functions: LLMFunctionDefinition[]
  temperature?: number
}

export type LLMFunctionCall = {
  id: string
  name: string
  args: Record<string, unknown>
}

export type LLMFunctionResult = {
  id: string
  name: string
  result: string | undefined
  error: string | undefined
}

export type LLMFile =
  | { type: 'url'; url: string; mimeType: string }
  | { type: 'base64'; base64: string; mimeType: string }

export type LLMMessage = {
  role: LLMRole
  thoughts: unknown[]
  content: string
  files: LLMFile[]
  functionCalls: LLMFunctionCall[]
  functionResults: LLMFunctionResult[]
}
