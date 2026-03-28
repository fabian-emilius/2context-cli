import type { LLMMessage } from '@/constants/llm.js'
import { MessageBuilder } from '@/helpers/messages.js'

interface StepNode {
  instruction: string
}

interface DecisionNode {
  condition: string
  onTrue: ProcessPrompt
  onFalse: ProcessPrompt
}

export class ProcessPrompt {
  public static create(): ProcessPrompt {
    return new ProcessPrompt()
  }

  private stepNodes: StepNode[] = []
  private decisionNode: DecisionNode | undefined = undefined
  private readonly messageBuilder = new MessageBuilder()

  constructor() {}

  public isEmpty(): boolean {
    return this.stepNodes.length === 0 && !this.decisionNode
  }

  public step(instruction: string): ProcessPrompt {
    if (this.decisionNode) {
      throw new Error('Cannot add steps after a decision node')
    }

    this.stepNodes.push({
      instruction,
    })

    return this
  }

  public decision(condition: string, handler: (onTrue: ProcessPrompt, onFalse: ProcessPrompt) => void): ProcessPrompt {
    const trueBuilder = new ProcessPrompt()
    const falseBuilder = new ProcessPrompt()

    handler(trueBuilder, falseBuilder)

    this.decisionNode = {
      condition,
      onTrue: trueBuilder,
      onFalse: falseBuilder,
    }

    return this
  }

  public build(): string {
    if (this.stepNodes.length === 0) {
      return ''
    }

    return `<process>\n${this.renderNodes(1)}\n</process>`
  }

  private renderNodes(indent: number): string {
    const indentStr = '  '.repeat(indent)

    let result = ''
    for (const step of this.stepNodes) {
      result += `${indentStr}<step>${step.instruction}</step>\n`
    }

    if (this.decisionNode) {
      result += `${indentStr}<decision>\n`
      result += `${indentStr}  <condition>${this.decisionNode.condition}</condition>\n`
      result += `${indentStr}  <onTrue>\n${this.decisionNode.onTrue.renderNodes(indent + 1)}\n${indentStr}  </onTrue>\n`
      result += `${indentStr}  <onFalse>\n${this.decisionNode.onFalse.renderNodes(indent + 1)}\n${indentStr}  </onFalse>\n`
      result += `${indentStr}</decision>\n`
    }

    return result
  }

  public buildLLMMessage(): LLMMessage {
    return this.messageBuilder.buildUserMessage(this.build())
  }
}
