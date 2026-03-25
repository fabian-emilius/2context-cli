import { Injectable } from '@nestjs/common'
import { type Instance, render } from 'ink'
import { createElement } from 'react'

import { App, type OutputLine } from './components.js'
import { type EnvConfig, resolveEnvConfig } from './env.js'

// ── Public types ───────────────────────────────────────────────────────────────

export interface SpinnerHandle {
  /** Update the spinner message while it is active. */
  update(message: string): void
  /** Stop with a success message. */
  succeed(message?: string): void
  /** Stop with an error message. */
  fail(message?: string): void
  /** Stop silently (no status line). */
  stop(): void
}

export interface TreeItem {
  label: string
  children?: TreeItem[]
}

// ── TerminalUI ─────────────────────────────────────────────────────────────────

/**
 * Comprehensive terminal output manager with CI-aware rendering.
 *
 * Interactive mode — uses Ink (React) for animated spinners and styled output.
 * CI mode          — uses plain `process.stdout.write` with structured prefixes.
 *
 * Inject via NestJS DI or instantiate directly:
 *
 * ```ts
 * const ui = new TerminalUI()
 * ui.header('My CLI', 'v1.0.0')
 * const s = ui.spinner('Working...')
 * await doWork()
 * s.succeed('Done!')
 * ui.cleanup()
 * ```
 */
@Injectable()
export class TerminalUI {
  /** Resolved environment configuration. */
  readonly env: EnvConfig

  /** True when running in a non-interactive environment (CI, piped, no TTY). */
  readonly isCI: boolean

  /** True when the terminal supports interactive rendering. */
  readonly isInteractive: boolean

  // ── Internal state ─────────────────────────────────────────────────────────

  private lines: OutputLine[] = []
  private spinnerState: { message: string } | null = null
  private inkInstance: Instance | null = null
  private lineCounter = 0
  private initialized = false

  constructor() {
    this.env = resolveEnvConfig()
    this.isCI = this.env.ci
    this.isInteractive = !this.isCI
  }

  // ── Text output ────────────────────────────────────────────────────────────

  /** Print an application header with optional subtitle. */
  header(title: string, subtitle?: string): void {
    this.addLine('header', title, subtitle ? { subtitle } : undefined)
  }

  /** Print a plain message. */
  log(message: string): void {
    this.addLine('log', message)
  }

  /** Print an informational message (ℹ prefix in interactive, [INFO] in CI). */
  info(message: string): void {
    this.addLine('info', message)
  }

  /** Print a success message (✔ prefix in interactive, [OK] in CI). */
  success(message: string): void {
    this.addLine('success', message)
  }

  /** Print a warning message (⚠ prefix in interactive, [WARN] in CI). */
  warning(message: string): void {
    this.addLine('warning', message)
  }

  /** Print an error message (✖ prefix in interactive, [ERROR] in CI). */
  error(message: string): void {
    this.addLine('error', message)
  }

  /** Print a dimmed/secondary message. */
  dim(message: string): void {
    this.addLine('dim', message)
  }

  /** Print a blank line. */
  blank(): void {
    this.addLine('blank', '')
  }

  // ── Structured output ──────────────────────────────────────────────────────

  /** Print aligned key → value pairs. */
  keyValue(pairs: [string, string][]): void {
    this.addLine('kv', '', { pairs })
  }

  /** Print a bulleted list. */
  list(items: string[], options?: { indent?: number; bullet?: string }): void {
    this.addLine('list', '', { items, ...options })
  }

  /** Print a tree structure. */
  tree(items: TreeItem[]): void {
    this.addLine('tree', '', { items })
  }

  /** Print a visual divider, optionally with a label. */
  divider(label?: string): void {
    this.addLine('divider', label || '')
  }

  /** Print a step indicator like [3/10] Extracting insights... */
  step(current: number, total: number, message: string): void {
    this.addLine('step', message, { current, total })
  }

  // ── Progress / spinners ────────────────────────────────────────────────────

  /**
   * Show an animated spinner (interactive) or a status line (CI).
   * Returns a handle to update, succeed, fail, or stop the spinner.
   */
  spinner(message: string): SpinnerHandle {
    if (this.isCI) {
      this.ciWrite(message)
      return this.createCISpinnerHandle(message)
    }

    this.ensureInk()
    this.spinnerState = { message }
    this.rerender()

    return this.createInkSpinnerHandle()
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Pause Ink rendering to allow direct terminal access (e.g. readline prompts).
   * Call `resume()` to restart rendering.
   */
  pause(): void {
    if (this.inkInstance) {
      this.spinnerState = null
      this.inkInstance.unmount()
      this.inkInstance = null
      // Lines already rendered stay on-screen; reset tracked list for next mount.
      this.lines = []
    }
  }

  /** Resume Ink rendering after a `pause()`. */
  resume(): void {
    if (this.isInteractive && !this.inkInstance) {
      this.inkInstance = render(createElement(App, { lines: this.lines, spinner: this.spinnerState }))
    }
  }

  /** Unmount Ink and release terminal resources. Call before process.exit(). */
  cleanup(): void {
    if (this.inkInstance) {
      this.spinnerState = null
      this.rerender()
      this.inkInstance.unmount()
      this.inkInstance = null
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private addLine(type: OutputLine['type'], text: string, data?: Record<string, unknown>): void {
    if (this.env.silent && type !== 'error') return

    const line: OutputLine = { id: ++this.lineCounter, type, text, data }
    this.lines.push(line)

    if (this.isCI) {
      this.renderCILine(line)
    } else {
      this.ensureInk()
      this.rerender()
    }
  }

  private ensureInk(): void {
    if (!this.initialized && this.isInteractive) {
      this.initialized = true
      this.inkInstance = render(createElement(App, { lines: this.lines, spinner: this.spinnerState }))
    }
  }

  private rerender(): void {
    if (this.inkInstance) {
      this.inkInstance.rerender(createElement(App, { lines: this.lines, spinner: this.spinnerState }))
    }
  }

  // ── CI rendering ───────────────────────────────────────────────────────────

  private ciWrite(message: string): void {
    if (!this.env.silent) {
      process.stdout.write(`${message}\n`)
    }
  }

  private ciWriteErr(message: string): void {
    process.stderr.write(`${message}\n`)
  }

  private renderCILine(line: OutputLine): void {
    switch (line.type) {
      case 'header':
        this.ciWrite(`=== ${line.text} ===`)
        if (line.data?.subtitle) this.ciWrite(`    ${line.data.subtitle}`)
        break

      case 'success':
        this.ciWrite(`[OK] ${line.text}`)
        break

      case 'error':
        this.ciWriteErr(`[ERROR] ${line.text}`)
        break

      case 'warning':
        this.ciWrite(`[WARN] ${line.text}`)
        break

      case 'info':
        this.ciWrite(`[INFO] ${line.text}`)
        break

      case 'dim':
        this.ciWrite(`      ${line.text}`)
        break

      case 'divider':
        this.ciWrite(line.text ? `--- ${line.text} ---` : '---')
        break

      case 'kv': {
        const pairs = line.data?.pairs as [string, string][] | undefined
        if (pairs) {
          for (const [key, value] of pairs) {
            this.ciWrite(`  ${key}: ${value}`)
          }
        }
        break
      }

      case 'list': {
        const items = line.data?.items as string[] | undefined
        if (items) {
          for (const item of items) {
            this.ciWrite(`  - ${item}`)
          }
        }
        break
      }

      case 'tree':
        this.renderCITree(line.data?.items as TreeItem[] | undefined, 0)
        break

      case 'step': {
        const { current, total } = line.data as { current: number; total: number }
        this.ciWrite(`[${current}/${total}] ${line.text}`)
        break
      }

      case 'blank':
        this.ciWrite('')
        break

      default:
        this.ciWrite(line.text)
    }
  }

  private renderCITree(items: TreeItem[] | undefined, depth: number): void {
    if (!items) return
    for (const item of items) {
      this.ciWrite(`${'  '.repeat(depth + 1)}${item.label}`)
      if (item.children) this.renderCITree(item.children, depth + 1)
    }
  }

  // ── Spinner handles ────────────────────────────────────────────────────────

  private createCISpinnerHandle(initialMessage: string): SpinnerHandle {
    return {
      update: (msg: string) => this.ciWrite(msg),
      succeed: (msg?: string) => this.ciWrite(`[OK] ${msg || initialMessage}`),
      fail: (msg?: string) => this.ciWriteErr(`[FAIL] ${msg || initialMessage}`),
      stop: () => {},
    }
  }

  private createInkSpinnerHandle(): SpinnerHandle {
    return {
      update: (msg: string) => {
        this.spinnerState = { message: msg }
        this.rerender()
      },
      succeed: (msg?: string) => {
        this.spinnerState = null
        if (msg) this.addLine('success', msg)
        else this.rerender()
      },
      fail: (msg?: string) => {
        this.spinnerState = null
        if (msg) this.addLine('error', msg)
        else this.rerender()
      },
      stop: () => {
        this.spinnerState = null
        this.rerender()
      },
    }
  }
}
