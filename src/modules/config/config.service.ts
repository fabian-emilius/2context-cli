import os from 'node:os'
import path from 'node:path'

import { Injectable, Logger } from '@nestjs/common'

import { AiProvider } from '@/constants/ai.js'
import { AI_PROVIDER_ENV_KEYS, DEFAULT_MODELS } from '@/constants/ai.js'
import { chmodOwnerOnly, pathExists, readFileOrNull, writeFileWithDir } from '@/helpers/fs.js'
import type { TwoContextConfig } from '@/modules/config/config.types.js'

@Injectable()
export class ConfigService {
  private readonly logger = new Logger('ConfigService')
  private readonly configDir: string
  private readonly configPath: string

  /** In-memory cache so callers that need sync access (ensureConfigured) work after the first load. */
  private cachedConfig: TwoContextConfig | null | undefined = undefined

  constructor() {
    this.configDir = path.join(os.homedir(), '.2context')
    this.configPath = path.join(this.configDir, 'keys.json')
  }

  /**
   * Check whether a configuration file exists.
   */
  public async isConfigured(): Promise<boolean> {
    return pathExists(this.configPath)
  }

  /**
   * Attempt to build a complete configuration purely from environment variables.
   *
   * Resolution order:
   *   1. If TWOCONTEXT_PROVIDER is set, use that provider and look for its API key.
   *   2. Otherwise auto-detect from whichever API key env var is present
   *      (checks anthropic → openai → google).
   *
   * Returns null when no sufficient env vars are available.
   */
  public resolveFromEnv(): TwoContextConfig | null {
    const requestedProvider = process.env.TWOCONTEXT_PROVIDER

    // Explicit provider requested
    if (requestedProvider) {
      const provider = Object.values(AiProvider).find((p) => p === requestedProvider)
      if (!provider) return null

      const envKey = AI_PROVIDER_ENV_KEYS[provider]
      const apiKey = process.env[envKey]
      if (!apiKey) return null

      return {
        provider,
        model: process.env.TWOCONTEXT_MODEL || DEFAULT_MODELS[provider],
        keys: { [envKey]: apiKey },
      }
    }

    // Auto-detect from available API keys
    for (const provider of Object.values(AiProvider)) {
      const envKey = AI_PROVIDER_ENV_KEYS[provider]
      const apiKey = process.env[envKey]
      if (apiKey) {
        return {
          provider,
          model: process.env.TWOCONTEXT_MODEL || DEFAULT_MODELS[provider],
          keys: { [envKey]: apiKey },
        }
      }
    }

    return null
  }

  /**
   * Load the stored configuration, or null if none exists.
   */
  public async loadConfig(): Promise<TwoContextConfig | null> {
    const raw = await readFileOrNull(this.configPath)
    if (!raw) {
      this.cachedConfig = null
      return null
    }

    try {
      const config = JSON.parse(raw) as TwoContextConfig
      this.cachedConfig = config
      return config
    } catch {
      this.logger.warn(`Failed to parse config at ${this.configPath}`)
      this.cachedConfig = null
      return null
    }
  }

  /**
   * Cache a config object in memory and inject its keys into process.env.
   * Does NOT persist to disk — use for env-resolved or ephemeral configs.
   */
  public cacheAndInject(config: TwoContextConfig): void {
    this.cachedConfig = config
    for (const [envKey, value] of Object.entries(config.keys)) {
      if (value && !process.env[envKey]) {
        process.env[envKey] = value
      }
    }
  }

  /**
   * Persist the given configuration to disk with restricted file permissions.
   */
  public async saveConfig(config: TwoContextConfig): Promise<void> {
    await writeFileWithDir(this.configPath, JSON.stringify(config, null, 2))
    await chmodOwnerOnly(this.configPath)

    this.cachedConfig = config
    this.logger.log('Configuration saved')
  }

  /**
   * Get the API key for a specific provider from the stored configuration.
   */
  public async getApiKey(provider: AiProvider): Promise<string | null> {
    const config = await this.loadConfig()
    if (!config) return null

    const envKey = AI_PROVIDER_ENV_KEYS[provider]
    return config.keys[envKey] || null
  }

  /**
   * Get the user's preferred model, or null if not configured.
   */
  public async getPreferredModel(): Promise<string | null> {
    const config = await this.loadConfig()
    return config?.model || null
  }

  /**
   * Get the user's preferred provider, or null if not configured.
   */
  public async getPreferredProvider(): Promise<AiProvider | null> {
    const config = await this.loadConfig()
    return config?.provider || null
  }

  /**
   * Inject configured API keys into process.env so Mastra / AI SDK providers pick them up.
   */
  public async injectEnvKeys(): Promise<void> {
    const config = await this.loadConfig()
    if (!config) return

    for (const [envKey, value] of Object.entries(config.keys)) {
      if (value && !process.env[envKey]) {
        process.env[envKey] = value
      }
    }
  }

  /**
   * Ensure the CLI is configured, throwing if not.
   * Prefers the in-memory cache when available so this can be called
   * after an earlier `loadConfig()` / `saveConfig()` without hitting disk again.
   *
   * For interactive setup use the config-wizard helper from a command instead.
   */
  public ensureConfigured(): TwoContextConfig {
    if (this.cachedConfig) return this.cachedConfig

    throw new Error('Not configured. Run "2context init" first to set up your API provider and keys.')
  }

  /**
   * Get the default model for a given provider.
   */
  public getDefaultModel(provider: AiProvider): string {
    return DEFAULT_MODELS[provider]
  }
}
