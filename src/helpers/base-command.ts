import { Logger } from '@nestjs/common'
import { CommandRunner } from 'nest-commander'

export abstract class BaseCommand extends CommandRunner {
  protected readonly logger = new Logger(this.constructor.name)

  public async run(passedParam: string[], options?: Record<string, unknown>): Promise<void> {
    try {
      await this.execute(passedParam, options)
      process.exit(0)
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.logger.error(err.message, err.stack)
      process.exit(1)
    }
  }

  protected abstract execute(passedParam: string[], options?: Record<string, unknown>): Promise<void>
}
