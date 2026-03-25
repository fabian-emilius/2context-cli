import type { LLMMessage } from '@/constants/llm.js'
import { buildUserLLMMessage } from '@/helpers/messages.js'
import { countTextTokens, limitTextTokens } from '@/helpers/tokens.js'

export class TextPrompt {
  public static create(maxElementTokens?: number): TextPrompt {
    return new TextPrompt(maxElementTokens)
  }

  private items: string[] = []

  constructor(private readonly maxElementTokens?: number) {
    if (maxElementTokens && maxElementTokens <= 0) {
      throw new Error('maxTokens must be greater than 0')
    }
  }

  public isEmpty(): boolean {
    return this.items.length === 0
  }

  public text(text: string | undefined): TextPrompt {
    if (typeof text !== 'string') {
      return this
    }

    if (this.maxElementTokens) {
      this.items.push(limitTextTokens(text, this.maxElementTokens))
    } else {
      this.items.push(text)
    }

    return this
  }

  public emptyLine(lineCount = 1): TextPrompt {
    for (let i = 0; i < lineCount; i++) {
      this.items.push('')
    }

    return this
  }

  public list(items: string[]): TextPrompt {
    if (this.maxElementTokens) {
      const limit = this.maxElementTokens

      this.items.push(items.map((item) => `- ${limitTextTokens(item, limit)}`).join('\n'))
    } else {
      this.items.push(items.map((item) => `- ${item}`).join('\n'))
    }

    return this
  }

  public section(
    name: string,
    content: string | undefined,
    attributes: Record<string, string | undefined> = {},
  ): TextPrompt {
    let params = ''
    for (const [key, value] of Object.entries(attributes)) {
      if (!value) {
        continue
      }

      params += ` ${key}="${value}"`
    }

    if (!params && !content) {
      return this
    }

    const wrapContent = (content: string) => {
      if (!content.trim()) {
        return `<${name}${params} />`
      }

      if (content && content.includes('\n')) {
        return `<${name}${params}>\n${content}\n</${name}>`
      } else {
        return `<${name}${params}>${content}</${name}>`
      }
    }

    if (this.maxElementTokens) {
      this.items.push(wrapContent(limitTextTokens(content || '', this.maxElementTokens)))
    } else {
      this.items.push(wrapContent(content || ''))
    }

    return this
  }

  public build(maxTokens?: number): string {
    const result = this.items.join('\n')

    if (!maxTokens || result.length <= maxTokens) {
      return result
    }

    let outputTokens = 0

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]
      const itemTokens = countTextTokens(item)

      if (maxTokens && outputTokens + itemTokens > maxTokens) {
        return this.items.slice(0, i).join('\n')
      }

      outputTokens += itemTokens
    }

    return result
  }

  public buildLLMMessage(): LLMMessage {
    return buildUserLLMMessage(this.build())
  }
}
