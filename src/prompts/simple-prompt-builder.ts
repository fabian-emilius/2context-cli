import { BasePromptBuilder } from '@/prompts/base-prompt-builder.js'
import type { InferTextPromptOutputType, TextPromptOutputFormat } from '@/prompts/simple-prompt-factory.js'
import { SimplePromptParser } from '@/prompts/simple-prompt-parser.js'

export class SimplePromptBuilder<
  OutputFormat extends TextPromptOutputFormat,
  ObjectFormat = InferTextPromptOutputType<OutputFormat>,
> extends BasePromptBuilder<ObjectFormat> {
  constructor(private outputFormat: OutputFormat) {
    super()
  }

  public createParser() {
    return new SimplePromptParser<OutputFormat, ObjectFormat>(this.outputFormat)
  }

  protected hasOutput() {
    return Object.keys(this.outputFormat).length > 0
  }

  protected generateOutputGuidelines() {
    return ['When returning an empty array, return an empty string.']
  }

  protected generateOutputTypeDefinitions() {
    return Object.entries(this.outputFormat)
      .map(([key, prop]) => `${key}: ${prop.type === 'string' ? 'TEXT' : 'ARRAY'}`)
      .join('\n')
  }

  protected generateOutputExample() {
    return (
      Object.entries(this.outputFormat)
        .map(([key, prop]) => {
          if (prop.type === 'string') {
            return `### ${key} ###\nExample text output for ${key}\n`
          } else if (prop.type === 'array') {
            return `### ${key} ###\nExample item 1 for ${key}\nExample item 2 for ${key}\n`
          }

          throw new Error('Invalid output format')
        })
        .join('\n') + '\n### END ###'
    )
  }
}
