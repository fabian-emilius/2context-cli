export enum AiProvider {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
  Google = 'google',
}

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  [AiProvider.Anthropic]: 'Anthropic (Claude)',
  [AiProvider.OpenAI]: 'OpenAI (GPT)',
  [AiProvider.Google]: 'Google (Gemini)',
}

export const AI_PROVIDER_ENV_KEYS: Record<AiProvider, string> = {
  [AiProvider.Anthropic]: 'ANTHROPIC_API_KEY',
  [AiProvider.OpenAI]: 'OPENAI_API_KEY',
  [AiProvider.Google]: 'GOOGLE_GENERATIVE_AI_API_KEY',
}

export const AI_PROVIDER_MODELS: Record<AiProvider, string[]> = {
  [AiProvider.Anthropic]: [
    'anthropic/claude-sonnet-4-20250514',
    'anthropic/claude-haiku-4-5',
    'anthropic/claude-opus-4-20250514',
  ],
  [AiProvider.OpenAI]: ['openai/gpt-4o', 'openai/gpt-4o-mini', 'openai/o3-mini'],
  [AiProvider.Google]: ['google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'google/gemini-2.0-flash'],
}

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  [AiProvider.Anthropic]: 'anthropic/claude-sonnet-4-20250514',
  [AiProvider.OpenAI]: 'openai/gpt-4o',
  [AiProvider.Google]: 'google/gemini-2.5-flash',
}
