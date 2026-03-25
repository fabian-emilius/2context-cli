import type { LLMFunctionDefinition, LLMSystemMessage } from '@/constants/llm.js'
import { TextPrompt } from '@/prompts/text-prompt.js'

export interface ISystemPromptSection {
  name: string
  content: string
  description?: string
}

export class SystemPrompt {
  private functions: LLMFunctionDefinition[] = []
  private temperature: number | undefined = undefined
  private outputInstructions: string = ''

  constructor(
    private persona: string,
    private sections: ISystemPromptSection[] = [],
    private footer: string[] = [],
  ) {}

  public setTemperature(temperature: number | undefined) {
    this.temperature = temperature
  }

  public setOutputInstructions(instructions: string) {
    this.outputInstructions = instructions
  }

  public addFooterItem(item: string) {
    this.footer.push(item)
  }

  public updateSection(section: ISystemPromptSection) {
    const index = this.sections.findIndex((row) => section.name === row.name)

    if (index >= 0) {
      this.sections[index] = section
    } else {
      this.sections.push(section)
    }
  }

  public updateSections(sections: ISystemPromptSection[]) {
    sections.forEach((section) => this.updateSection(section))
  }

  public updateFunctionDefinition(fn: LLMFunctionDefinition) {
    const index = this.functions.findIndex((row) => row.name === fn.name)

    if (index >= 0) {
      this.functions[index] = fn
    } else {
      this.functions.push(fn)
    }
  }

  public updateFunctionDefinitions(fns: LLMFunctionDefinition[]) {
    fns.forEach((fn) => this.updateFunctionDefinition(fn))
  }

  public build(): LLMSystemMessage {
    const textPrompt = TextPrompt.create()

    textPrompt.text(this.persona.trim())
    textPrompt.emptyLine()

    for (const section of this.sections) {
      if (!section.content) {
        continue
      }

      textPrompt.section(section.name.trim(), section.content.trim(), {
        description: section.description?.trim(),
      })
      textPrompt.emptyLine()
    }

    if (this.functions.length > 0) {
      const tools = TextPrompt.create()

      for (const fn of this.functions) {
        tools.section('tool', fn.description, { name: fn.name })
      }

      tools.section(
        'IMPORTANT',
        'When calling a tool / function, use exact tool/field names and valid JSON arguments matching the schema.\n' +
          'Ensure all string values in function call arguments are properly JSON-escaped.',
      )

      textPrompt.section('available_tools', tools.build())
      textPrompt.emptyLine()
    }

    if (this.footer.length > 0) {
      textPrompt.text(this.footer.map((item) => item.trim()).join('\n'))
    }

    if (this.outputInstructions) {
      textPrompt.emptyLine()
      textPrompt.text(this.outputInstructions)
      textPrompt.emptyLine()
    }

    return { prompt: textPrompt.build(), functions: this.functions, temperature: this.temperature }
  }
}
