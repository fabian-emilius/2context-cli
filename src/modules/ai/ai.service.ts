import { Agent } from '@mastra/core/agent'
import type { MastraModelConfig } from '@mastra/core/llm'
import { Injectable, Logger } from '@nestjs/common'
import type { z } from 'zod'

import type { GenerateTextOptions, GenerateTextResult, StreamTextOptions } from '@/modules/ai/ai.types.js'
import type { ConfigService } from '@/modules/config/config.service.js'

const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1000

@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService')

  constructor(private readonly configService: ConfigService) {}

  private async createAgent(systemPrompt: string, agentId: string = 'context-agent'): Promise<Agent> {
    await this.configService.injectEnvKeys()
    const config = this.configService.ensureConfigured()

    return new Agent({
      id: agentId,
      name: agentId,
      instructions: systemPrompt,
      model: config.model as MastraModelConfig,
    })
  }

  /**
   * Generate text with the configured AI model.
   * Includes retry logic with exponential backoff for transient failures.
   */
  public async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    return this.withRetry(async () => {
      const agent = await this.createAgent(options.systemPrompt || 'You are a helpful assistant.')

      const response = await agent.generate(options.prompt, {
        modelSettings: {
          temperature: options.temperature ?? 0,
          ...(options.maxTokens ? { maxOutputTokens: options.maxTokens } : {}),
        },
      })

      return {
        text: response.text,
        usage: response.usage
          ? {
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
              totalTokens: response.usage.totalTokens,
            }
          : undefined,
      }
    }, 'generateText')
  }

  /**
   * Stream text from the configured AI model with chunk callbacks.
   */
  public async streamText(options: StreamTextOptions): Promise<GenerateTextResult> {
    return this.withRetry(async () => {
      const agent = await this.createAgent(options.systemPrompt || 'You are a helpful assistant.')

      const stream = await agent.stream(options.prompt, {
        modelSettings: {
          temperature: options.temperature ?? 0,
          ...(options.maxTokens ? { maxOutputTokens: options.maxTokens } : {}),
        },
      })

      let fullText = ''

      for await (const chunk of stream.textStream) {
        fullText += chunk
        options.onChunk?.(chunk)
      }

      return { text: fullText }
    }, 'streamText')
  }

  /**
   * Generate a structured response validated against a Zod schema.
   * Uses the AI model's structured output capability.
   */
  public async generateStructured<T>(options: GenerateTextOptions, schema: z.ZodType<T>): Promise<T> {
    return this.withRetry(async () => {
      const agent = await this.createAgent(options.systemPrompt || 'You are a helpful assistant.')

      const response = await agent.generate(options.prompt, {
        modelSettings: {
          temperature: options.temperature ?? 0,
        },
        structuredOutput: {
          schema,
        },
      })

      // Mastra types the object field based on the schema output type
      return response.object as T
    }, 'generateStructured')
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
