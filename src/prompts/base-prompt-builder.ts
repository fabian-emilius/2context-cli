import type { BasePromptParser } from '@/prompts/base-prompt-parser.js'

export abstract class BasePromptBuilder<T> {
  protected task = ''
  protected data = ''
  protected files = ''

  public abstract createParser(): BasePromptParser<T>

  public setTask(message: string | string[]) {
    if (Array.isArray(message)) {
      this.task = ''

      for (let i = 0; i < message.length; i++) {
        this.task += `${i + 1}. ${message[i]}\n\n`
      }
    } else {
      this.task = message
    }
  }

  public addFile(name: string, content: string) {
    this.files += `<file name="${name}">\n${content}\n</file>\n`
  }

  public addData(name: string, text: string) {
    this.data += `### ${name} ###\n${text}\n\n`
  }

  public buildTextMessage() {
    let prompt = ''

    if (this.task) {
      prompt += `### TASK ###\n${this.task}\n\n`
    }

    if (this.data) {
      prompt += `### DATA ###\n${this.data}\n`
    }

    if (this.files) {
      prompt += `### FILES ###\n${this.files}\n`
    }

    if (this.hasOutput()) {
      prompt += this.buildOutputFormatInstructions()
    }

    return prompt
  }

  public buildOutputFormatInstructions() {
    let prompt =
      'IMPORTANT: Only return the requested data in the specified output format. ' +
      'Use the output example as reference how to return the data. \n'
    prompt += `### OUTPUT TYPE DEFINITION ###\n${this.generateOutputTypeDefinitions()}\n\n`
    prompt += `### OUTPUT GUIDELINES ###\n${this.generateOutputGuidelines().join('\n')}\n\n`
    prompt += `### OUTPUT EXAMPLE ###\n${this.generateOutputExample()}\n`

    return prompt
  }

  protected abstract hasOutput(): boolean
  protected abstract generateOutputGuidelines(): string[]
  protected abstract generateOutputTypeDefinitions(): string
  protected abstract generateOutputExample(): string
}
