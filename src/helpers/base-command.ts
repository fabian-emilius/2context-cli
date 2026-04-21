import { Logger } from '@nestjs/common'
import { CommandRunner } from 'nest-commander'

export abstract class BaseCommand extends CommandRunner {
  protected readonly logger = new Logger(this.constructor.name)

  public async run(passedParam: string[], options?: Record<string, unknown>): Promise<void> {
    try {
      await this.execute(passedParam, options)
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.logger.error(err.message, err.stack)
      if (this.persistFatal) {
        try {
          await this.persistFatal(err)
        } catch {
          // Never let the error persister itself fail the run.
        }
      }
      process.exitCode = 1
    }
  }

  protected abstract execute(passedParam: string[], options?: Record<string, unknown>): Promise<void>

  /**
   * Optional hook: subclasses can implement this to persist the fatal error to
   * disk (e.g. .2context/errors.log) via an injected ErrorLoggerService.
   */
  protected persistFatal?(error: Error): Promise<void>
}
