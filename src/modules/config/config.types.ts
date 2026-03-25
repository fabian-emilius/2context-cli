import type { AiProvider } from '@/constants/ai.js'

export interface TwoContextConfig {
  provider: AiProvider
  model: string
  keys: Record<string, string>
}
