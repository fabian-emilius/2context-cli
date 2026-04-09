import { TextPrompt } from '@/prompts/text-prompt.js'

export interface ISystemPromptSection {
  name: string
  content: string
  description?: string
}

export interface SystemPromptResult {
  prompt: string
  temperature?: number
}

export class SystemPrompt {
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

  public build(): SystemPromptResult {
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

    if (this.footer.length > 0) {
      textPrompt.text(this.footer.map((item) => item.trim()).join('\n'))
    }

    if (this.outputInstructions) {
      textPrompt.emptyLine()
      textPrompt.text(this.outputInstructions)
      textPrompt.emptyLine()
    }

    return { prompt: textPrompt.build(), temperature: this.temperature }
  }
}
