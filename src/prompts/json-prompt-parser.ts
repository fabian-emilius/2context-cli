import { jsonrepair } from 'jsonrepair'

import type { LLMMessage } from '@/constants/llm.js'
import { BasePromptParser } from '@/prompts/base-prompt-parser.js'
import { JsonPromptBuilder } from '@/prompts/json-prompt-builder.js'
import type {
  InferJsonPromptOutputType,
  JsonPromptOutputFormat,
  JsonPromptOutputFormatType,
} from '@/prompts/json-prompt-factory.js'

export class JsonPromptParser<
  OutputFormat extends JsonPromptOutputFormat,
  ObjectFormat = InferJsonPromptOutputType<{ type: 'object'; properties: OutputFormat }>,
> extends BasePromptParser<ObjectFormat> {
  constructor(private readonly outputFormat: OutputFormat) {
    super()
  }

  public createBuilder(): JsonPromptBuilder<OutputFormat, ObjectFormat> {
    return new JsonPromptBuilder<OutputFormat, ObjectFormat>(this.outputFormat)
  }

  public async parseResponse(response: { messages: LLMMessage[] }, completed = true): Promise<ObjectFormat> {
    return this.parseContent(this.extractContent(response), completed)
  }

  private parseContent(content: string, completed: boolean): ObjectFormat {
    const startIndex = content.indexOf('{')
    const endIndex = content.lastIndexOf('}')

    const jsonContent = completed ? content.slice(startIndex, endIndex + 1) : content.slice(startIndex)

    const format: JsonPromptOutputFormatType = {
      type: 'object',
      properties: this.outputFormat,
    }

    if (!jsonContent) {
      return this.createEmptyJsonValue(format)
    }

    const parseJson = (json: string): any => {
      try {
        return JSON.parse(jsonrepair(json))
      } catch {
        return {}
      }
    }

    return this.fixJsonValue(parseJson(jsonContent), format)
  }

  private createEmptyJsonValue(format: JsonPromptOutputFormatType): any {
    if (format.type === 'object') {
      return Object.fromEntries(
        Object.entries(format.properties).map(([key, prop]) => [key, this.createEmptyJsonValue(prop)]),
      )
    } else if (format.type === 'array') {
      return []
    } else if (format.type === 'string') {
      return format.nullable ? null : ''
    } else if (format.type === 'number') {
      return format.nullable ? null : 0
    } else if (format.type === 'boolean') {
      return format.nullable ? null : false
    }

    throw new Error(`Invalid type: ${format.type}`)
  }

  private fixJsonValue(data: any, format: JsonPromptOutputFormatType): any {
    if (!this.checkType(data, format.type, false)) {
      return this.createEmptyJsonValue(format)
    }

    if (format.type === 'object') {
      return Object.fromEntries(
        Object.entries(format.properties).map(([key, prop]) => [key, this.fixJsonValue(data[key], prop)]),
      )
    } else if (format.type === 'array') {
      return data.map((element: any) => this.fixJsonValue(element, format.items))
    } else {
      return data
    }
  }

  private checkType(
    value: any,
    expectedType: 'object' | 'array' | 'string' | 'number' | 'boolean',
    nullable: boolean,
  ): boolean {
    if (nullable && value === null) {
      return true
    }

    if (expectedType === 'object') {
      return typeof value === 'object' && value !== null
    } else if (expectedType === 'array') {
      return Array.isArray(value)
    } else {
      return typeof value === expectedType
    }
  }
}
