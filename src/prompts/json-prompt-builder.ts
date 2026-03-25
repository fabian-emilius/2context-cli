import { BasePromptBuilder } from '@/prompts/base-prompt-builder.js'
import type {
  InferJsonPromptOutputType,
  JsonPromptOutputFormat,
  JsonPromptOutputFormatType,
} from '@/prompts/json-prompt-factory.js'
import { JsonPromptParser } from '@/prompts/json-prompt-parser.js'

export class JsonPromptBuilder<
  OutputFormat extends JsonPromptOutputFormat,
  ObjectFormat = InferJsonPromptOutputType<{ type: 'object'; properties: OutputFormat }>,
> extends BasePromptBuilder<ObjectFormat> {
  constructor(private readonly outputFormat: OutputFormat) {
    super()
  }

  public createParser(): JsonPromptParser<OutputFormat, ObjectFormat> {
    return new JsonPromptParser<OutputFormat, ObjectFormat>(this.outputFormat)
  }

  protected hasOutput() {
    return Object.keys(this.outputFormat).length > 0
  }

  protected generateOutputGuidelines() {
    return ['When returning multiple lines in a string, seperate them with a newline character (`\\n`).']
  }

  protected generateOutputTypeDefinitions(): string {
    return this.generateTypeDefinition(
      {
        type: 'object',
        properties: this.outputFormat,
      },
      0,
    )
  }

  protected generateOutputExample(): string {
    return JSON.stringify(
      this.generateExampleObject({
        type: 'object',
        properties: this.outputFormat,
      }),
      null,
      2,
    )
  }

  private generateTypeDefinition(data: JsonPromptOutputFormatType, depth: number): string {
    const indent = '  '.repeat(depth)

    if (data.type === 'object') {
      const propertyStrings = Object.entries(data.properties).map(([key, prop]) => {
        return `${indent}  "${key}": ${this.generateTypeDefinition(prop, depth + 1)}`
      })

      return `{\n${propertyStrings.join('\n')}\n${indent}}`
    } else if (data.type === 'array') {
      return `Array<${this.generateTypeDefinition(data.items, depth)}>`
    } else if (data.type === 'string') {
      return 'string' + (data.nullable ? ' | null' : '')
    } else if (data.type === 'number') {
      return 'number' + (data.nullable ? ' | null' : '')
    } else if (data.type === 'boolean') {
      return 'boolean' + (data.nullable ? ' | null' : '')
    }

    throw new Error(`Unsupported type: ${data.type}`)
  }

  private generateExampleObject(data: JsonPromptOutputFormatType, name?: string): any {
    if (data.type === 'object') {
      return Object.fromEntries(
        Object.entries(data.properties).map(([key, prop]) => [
          key,
          this.generateExampleObject(prop, name ? `${name} ${key}` : key),
        ]),
      )
    } else if (data.type === 'array') {
      return [
        this.generateExampleObject(data.items, name ? `${name} 1` : undefined),
        this.generateExampleObject(data.items, name ? `${name} 2` : undefined),
      ]
    } else if (data.type === 'string') {
      return name ? `example ${name}` : 'example'
    } else if (data.type === 'number') {
      return 42
    } else if (data.type === 'boolean') {
      return true
    }

    throw new Error(`Unsupported type: ${data.type}`)
  }
}
