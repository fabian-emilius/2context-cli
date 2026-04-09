import { Agent } from '@mastra/core/agent'
import type { MastraModelConfig } from '@mastra/core/llm'
import type { FullOutput, MastraModelOutput } from '@mastra/core/stream'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { z } from 'zod'

import type { StreamTextOptions } from '@/modules/ai/ai.types.js'
import { ConfigService } from '@/modules/config/config.service.js'

const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1000

@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService')

  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

  /**
   * Create a Mastra Agent configured with the user's model and API keys.
   */
  private async createAgent(systemPrompt: string): Promise<Agent> {
    await this.configService.injectEnvKeys()
    const config = this.configService.ensureConfigured()

    return new Agent({
      id: 'context-agent',
      name: 'context-agent',
      instructions: systemPrompt,
      model: config.model as MastraModelConfig,
    })
  }

  /**
   * Generate text with the configured AI model.
   * Returns the full Mastra FullOutput including text, usage, steps, etc.
   */
  public async generate(prompt: string, systemPrompt: string, temperature = 0): Promise<FullOutput> {
    return this.withRetry(async () => {
      const agent = await this.createAgent(systemPrompt)

      return agent.generate(prompt, {
        modelSettings: { temperature },
      })
    }, 'generate')
  }

  /**
   * Generate a structured response validated against a Zod schema.
   * Returns the full Mastra FullOutput with the typed `object` field.
   */
  public async generateStructured<T>(
    prompt: string,
    systemPrompt: string,
    schema: z.ZodType<T>,
    temperature = 0,
  ): Promise<FullOutput<T>> {
    return this.withRetry(async () => {
      const agent = await this.createAgent(systemPrompt)

      return agent.generate(prompt, {
        modelSettings: { temperature },
        structuredOutput: { schema },
      }) as Promise<FullOutput<T>>
    }, 'generateStructured')
  }

  /**
   * Stream text from the configured AI model with chunk callbacks.
   * Returns the Mastra MastraModelOutput for further consumption.
   */
  public async stream(options: StreamTextOptions): Promise<MastraModelOutput> {
    return this.withRetry(async () => {
      const agent = await this.createAgent(options.systemPrompt || 'You are a helpful assistant.')

      const stream = await agent.stream(options.prompt, {
        modelSettings: { temperature: options.temperature ?? 0 },
      })

      if (options.onChunk) {
        // Consume the stream and call onChunk for each chunk
        for await (const chunk of stream.textStream) {
          options.onChunk(chunk)
        }
      }

      return stream
    }, 'stream')
  }

  /**
   * Retry an AI operation with exponential backoff.
   */
  private async withRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (attempt < MAX_RETRIES - 1) {
          const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
          this.logger.warn(
            `${operationName} failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${backoffMs}ms: ${lastError.message}`,
          )
          await this.sleep(backoffMs)
        }
      }
    }

    this.logger.error(`${operationName} failed after ${MAX_RETRIES} attempts`)
    throw lastError
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
