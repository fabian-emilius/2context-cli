export class TextPrompt {
  public static create(): TextPrompt {
    return new TextPrompt()
  }

  private items: string[] = []

  public isEmpty(): boolean {
    return this.items.length === 0
  }

  public text(text: string | undefined): TextPrompt {
    if (typeof text !== 'string') {
      return this
    }

    this.items.push(text)
    return this
  }

  public emptyLine(lineCount = 1): TextPrompt {
    for (let i = 0; i < lineCount; i++) {
      this.items.push('')
    }

    return this
  }

  public list(items: string[]): TextPrompt {
    this.items.push(items.map((item) => `- ${item}`).join('\n'))
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

    const wrapContent = (c: string) => {
      if (!c.trim()) {
        return `<${name}${params} />`
      }

      if (c.includes('\n')) {
        return `<${name}${params}>\n${c}\n</${name}>`
      } else {
        return `<${name}${params}>${c}</${name}>`
      }
    }

    this.items.push(wrapContent(content || ''))
    return this
  }

  public build(): string {
    return this.items.join('\n')
  }
}
