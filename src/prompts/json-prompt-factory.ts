import { BasePromptFactory } from '@/prompts/base-prompt-factory.js'
import { JsonPromptBuilder } from '@/prompts/json-prompt-builder.js'
import { JsonPromptParser } from '@/prompts/json-prompt-parser.js'

export type JsonPromptOutputFormatType =
  | {
      type: 'object'
      properties: Record<string, JsonPromptOutputFormatType>
    }
  | {
      type: 'array'
      items: JsonPromptOutputFormatType
    }
  | {
      type: 'string' | 'number' | 'boolean'
      nullable?: boolean
    }

export type JsonPromptOutputFormat = Record<string, JsonPromptOutputFormatType>

export type InferJsonPromptOutputType<T extends JsonPromptOutputFormatType> = T extends {
  type: 'object'
  properties: infer P extends Record<string, JsonPromptOutputFormatType>
}
  ? {
      [K in keyof P]: InferJsonPromptOutputType<P[K]>
    }
  : T extends {
        type: 'array'
        items: infer I extends JsonPromptOutputFormatType
      }
    ? InferJsonPromptOutputType<I>[]
    : T extends {
          type: 'string'
        }
      ? T extends { nullable: true }
        ? string | null
        : string
      : T extends {
            type: 'number'
          }
        ? T extends { nullable: true }
          ? number | null
          : number
        : T extends {
              type: 'boolean'
            }
          ? T extends { nullable: true }
            ? boolean | null
            : boolean
          : never

export class JsonPromptFactory<
  OutputFormat extends JsonPromptOutputFormat,
  ObjectFormat = InferJsonPromptOutputType<{ type: 'object'; properties: OutputFormat }>,
> extends BasePromptFactory<ObjectFormat> {
  constructor(private readonly outputFormat: OutputFormat) {
    super()
  }

  public createPromptBuilder() {
    return new JsonPromptBuilder<OutputFormat, ObjectFormat>(this.outputFormat)
  }

  public createPromptParser() {
    return new JsonPromptParser<OutputFormat, ObjectFormat>(this.outputFormat)
  }
}
