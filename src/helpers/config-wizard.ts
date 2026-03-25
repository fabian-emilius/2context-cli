import {
  AI_PROVIDER_ENV_KEYS,
  AI_PROVIDER_LABELS,
  AI_PROVIDER_MODELS,
  AiProvider,
  DEFAULT_MODELS,
} from '@/constants/ai.js'
import { askConsoleObject, askConsoleSecret } from '@/helpers/console-tools.js'
import type { ConfigService } from '@/modules/config/config.service.js'
import type { TwoContextConfig } from '@/modules/config/config.types.js'
import type { TerminalUI } from '@/ui/terminal-ui.js'

/**
 * Resolve configuration with the following priority:
 *
 *   1. Environment variables  (TWOCONTEXT_PROVIDER, ANTHROPIC_API_KEY, …)
 *   2. Config file            (~/.2context/keys.json)
 *   3. Interactive wizard      (only in non-CI mode)
 *
 * In CI mode, throws with clear instructions if env vars are missing.
 */
export async function ensureConfiguredInteractive(
  configService: ConfigService,
  ui: TerminalUI,
): Promise<TwoContextConfig> {
  // 1. Environment variables take priority
  const envConfig = configService.resolveFromEnv()
  if (envConfig) {
    configService.cacheAndInject(envConfig)
    return envConfig
  }

  // 2. Config file
  const existing = await configService.loadConfig()
  if (existing) {
    await configService.injectEnvKeys()
    return existing
  }

  // 3. CI mode without configuration → fail with instructions
  if (ui.isCI) {
    throw new Error(
      'Configuration required in CI mode. Set environment variables:\n' +
        '  TWOCONTEXT_PROVIDER=anthropic|openai|google\n' +
        '  ANTHROPIC_API_KEY=sk-...  (or OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY)\n' +
        '  TWOCONTEXT_MODEL=...      (optional, defaults to provider default)',
    )
  }

  // 4. Interactive wizard — pause Ink so readline can use the terminal
  ui.pause()

  console.log('\n  2context — First-time setup\n')

  // Step 1: Select AI provider
  const providers = Object.values(AiProvider)
  const provider = await askConsoleObject<AiProvider>('Select AI provider', providers, (p) => AI_PROVIDER_LABELS[p])

  // Step 2: Enter API key
  const envKey = AI_PROVIDER_ENV_KEYS[provider]
  const apiKey = await askConsoleSecret(`${envKey}`)

  if (!apiKey) {
    throw new Error('API key is required.')
  }

  // Step 3: Select model
  const models = AI_PROVIDER_MODELS[provider]
  const defaultModel = DEFAULT_MODELS[provider]
  console.log(`\n  Default model: ${defaultModel}`)

  const model = await askConsoleObject<string>('Select model', models, (m) =>
    m === defaultModel ? `${m} (default)` : m,
  )

  // Step 4: Save
  const config: TwoContextConfig = {
    provider,
    model,
    keys: { [envKey]: apiKey },
  }

  await configService.saveConfig(config)
  await configService.injectEnvKeys()

  console.log('\n  Configuration saved to ~/.2context/keys.json\n')

  // Resume Ink rendering
  ui.resume()

  return config
}
