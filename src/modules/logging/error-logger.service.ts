import fs from 'node:fs/promises'
import path from 'node:path'

import { Injectable, Logger } from '@nestjs/common'

export type LogLevel = 'warn' | 'error'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  component: string
  message: string
  stack?: string
}

const STATE_DIR = '.2context'
const LOG_FILE = 'errors.log'

/**
 * Central, persistent error/warning logger.
 *
 * Writes human-readable records to `.2context/errors.log` (one entry per line,
 * with optional indented stack traces for fatal errors). Buffers entries until
 * the repository root is known via `setRepoRoot()`, then flushes to disk.
 *
 * Concurrent writes from Promise.allSettled callers are serialized via an
 * internal promise chain so appends never interleave.
 */
@Injectable()
export class ErrorLoggerService {
  private readonly fallbackLogger = new Logger('ErrorLoggerService')
  private entries: LogEntry[] = []
  private logFilePath: string | null = null
  private bufferedBeforeRoot: LogEntry[] = []
  private writeQueue: Promise<void> = Promise.resolve()

  /**
   * Attach the file sink to `<repoRoot>/.2context/errors.log` and flush any
   * entries that were buffered before the repo root was known.
   */
  public setRepoRoot(repoRoot: string): void {
    const resolvedDir = path.join(repoRoot, STATE_DIR)
    this.logFilePath = path.join(resolvedDir, LOG_FILE)

    this.enqueueWrite(async () => {
      await fs.mkdir(resolvedDir, { recursive: true })
      if (this.bufferedBeforeRoot.length > 0) {
        const text = this.bufferedBeforeRoot.map((entry) => this.format(entry)).join('')
        await fs.appendFile(this.logFilePath!, text, 'utf-8')
        this.bufferedBeforeRoot = []
      }
    })
  }

  /** Log a non-fatal warning (recoverable condition, retry, fallback). */
  public warn(component: string, message: string, error?: unknown): Promise<void> {
    return this.record('warn', component, message, error, false)
  }

  /** Log a fatal error (includes stack trace in the log file). */
  public error(component: string, message: string, error?: unknown): Promise<void> {
    return this.record('error', component, message, error, true)
  }

  /** Number of entries recorded in this run, optionally filtered by level. */
  public count(level?: LogLevel): number {
    if (!level) return this.entries.length
    return this.entries.filter((entry) => entry.level === level).length
  }

  /** Relative path for display in end-of-run summaries. */
  public getLogFileRelativePath(): string {
    return path.join(STATE_DIR, LOG_FILE)
  }

  /** Clear the in-memory run counters (called at the start of each command run). */
  public resetRunCounters(): void {
    this.entries = []
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async record(
    level: LogLevel,
    component: string,
    message: string,
    error: unknown,
    includeStack: boolean,
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message: this.combineMessage(message, error),
    }

    if (includeStack) {
      const stack = this.extractStack(error)
      if (stack) entry.stack = stack
    }

    this.entries.push(entry)

    if (!this.logFilePath) {
      this.bufferedBeforeRoot.push(entry)
      return
    }

    await this.enqueueWrite(async () => {
      await fs.appendFile(this.logFilePath!, this.format(entry), 'utf-8')
    })
  }

  private enqueueWrite(task: () => Promise<void>): Promise<void> {
    this.writeQueue = this.writeQueue.then(task).catch((err) => {
      // Never let the error logger itself crash the run — fall back to stderr.
      this.fallbackLogger.warn(`Failed to write to errors.log: ${err instanceof Error ? err.message : String(err)}`)
    })
    return this.writeQueue
  }

  private combineMessage(message: string, error: unknown): string {
    if (error === undefined || error === null) return message
    const errMessage = error instanceof Error ? error.message : String(error)
    if (!errMessage) return message
    return `${message}: ${errMessage}`
  }

  private extractStack(error: unknown): string | undefined {
    if (error instanceof Error && error.stack) return error.stack
    return undefined
  }

  private format(entry: LogEntry): string {
    const header = `${entry.timestamp} [${entry.level.toUpperCase()}] ${entry.component}: ${entry.message}\n`
    if (!entry.stack) return header
    const indented = entry.stack
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n')
    return `${header}${indented}\n`
  }
}
