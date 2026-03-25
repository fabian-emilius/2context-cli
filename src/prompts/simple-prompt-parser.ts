import type { LLMMessage } from '@/constants/llm.js'
import { BasePromptParser } from '@/prompts/base-prompt-parser.js'
import { SimplePromptBuilder } from '@/prompts/simple-prompt-builder.js'
import type { InferTextPromptOutputType, TextPromptOutputFormat } from '@/prompts/simple-prompt-factory.js'

type ParsedData = Record<string, string | string[]>

export class SimplePromptParser<
  OutputFormat extends TextPromptOutputFormat,
  ObjectFormat = InferTextPromptOutputType<OutputFormat>,
> extends BasePromptParser<ObjectFormat> {
  constructor(private readonly outputFormat: OutputFormat) {
    super()
  }

  public createBuilder() {
    return new SimplePromptBuilder<OutputFormat, ObjectFormat>(this.outputFormat)
  }

  public async parseResponse(response: { messages: LLMMessage[] }, completed = true): Promise<ObjectFormat> {
    return this.parseContent(this.extractContent(response), completed)
  }

  private parseContent(content: string, _completed: boolean): ObjectFormat {
    const parsedData: ParsedData = this.createEmptyData()

    const lines = content.split('\n')

    let currentKey = ''
    let currentValue: string | string[] = ''
    let isArray = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (line === '### END ###') {
        break
      }

      const match = line.match(/^### (.+) ###$/)

      if (match) {
        if (currentKey) {
          parsedData[currentKey] = Array.isArray(currentValue)
            ? currentValue.filter((text) => !!text)
            : currentValue.trim()
        }

        currentKey = match[1]
        isArray = this.isArrayType(currentKey)
        currentValue = isArray ? [] : ''
      } else if (isArray && currentKey) {
        ;(currentValue as string[]).push(line.trim())
      } else if (currentKey && !Array.isArray(currentValue)) {
        currentValue = `${currentValue}\n${line}`.trim()
      }
    }

    if (currentKey) {
      parsedData[currentKey] = Array.isArray(currentValue) ? currentValue.filter((text) => !!text) : currentValue.trim()
    }

    // The ParsedData shape matches the ObjectFormat when the output format is TextPromptOutputFormat
    return parsedData as ObjectFormat
  }

  private createEmptyData(): ParsedData {
    const data: ParsedData = {}

    for (const [key, prop] of Object.entries(this.outputFormat)) {
      if (prop.type === 'string') {
        data[key] = ''
      } else if (prop.type === 'array') {
        data[key] = []
      }
    }

    return data
  }

  private isArrayType(name: string) {
    for (const [key, prop] of Object.entries(this.outputFormat)) {
      if (key === name) {
        return prop.type === 'array'
      }
    }

    return false
  }
}
