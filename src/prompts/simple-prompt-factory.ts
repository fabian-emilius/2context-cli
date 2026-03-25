import { BasePromptFactory } from '@/prompts/base-prompt-factory.js'
import { SimplePromptBuilder } from '@/prompts/simple-prompt-builder.js'
import { SimplePromptParser } from '@/prompts/simple-prompt-parser.js'

export type TextPromptOutputFormat = Record<string, { type: 'string' } | { type: 'array'; items: { type: 'string' } }>

export type InferTextPromptOutputType<T extends TextPromptOutputFormat> = {
  [K in keyof T]: T[K] extends { type: 'string' }
    ? string
    : T[K] extends { type: 'array'; items: { type: 'string' } }
      ? string[]
      : never
}

export class SimplePromptFactory<
  OutputFormat extends TextPromptOutputFormat,
  ObjectFormat = InferTextPromptOutputType<OutputFormat>,
> extends BasePromptFactory<ObjectFormat> {
  constructor(private readonly outputFormat: OutputFormat) {
    super()
  }

  public createPromptBuilder() {
    return new SimplePromptBuilder<OutputFormat, ObjectFormat>(this.outputFormat)
  }

  public createPromptParser() {
    return new SimplePromptParser<OutputFormat, ObjectFormat>(this.outputFormat)
  }
}
