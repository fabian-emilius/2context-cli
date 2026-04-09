/**
 * Environment variable resolution for all CLI configuration.
 *
 * Supported variables:
 *
 *   CI / TWOCONTEXT_CI          – Enable CI mode (plain output, no spinners, no prompts)
 *   TWOCONTEXT_SILENT           – Suppress all output except errors
 *   NO_COLOR / TWOCONTEXT_NO_COLOR – Disable colors (also implied by CI)
 *
 *   TWOCONTEXT_PROVIDER         – AI provider: anthropic | openai | google
 *   TWOCONTEXT_MODEL            – Model identifier (e.g. anthropic/claude-sonnet-4-20250514)
 *   ANTHROPIC_API_KEY           – Anthropic API key
 *   OPENAI_API_KEY              – OpenAI API key
 *   GOOGLE_GENERATIVE_AI_API_KEY – Google AI API key
 *
 *   TWOCONTEXT_BRANCH           – Default branch to analyze
 *   TWOCONTEXT_VERBOSE          – Include full diffs in analysis
 *   TWOCONTEXT_FORCE            – Force re-analysis (ignore previous state)
 */

export interface EnvConfig {
  /** Running in a CI environment (no TTY, CI=1, or TWOCONTEXT_CI=1). */
  ci: boolean
  /** Suppress all output except errors. */
  silent: boolean
  /** Disable ANSI colors (NO_COLOR standard or TWOCONTEXT_NO_COLOR). */
  noColor: boolean
  /** Explicit AI provider override. */
  provider: string | undefined
  /** Explicit model override. */
  model: string | undefined
  /** Default branch to analyze. */
  branch: string | undefined
  /** Include full diffs. */
  verbose: boolean
  /** Force re-analysis. */
  force: boolean
}

export class EnvResolver {
  private static isTruthy(value: string | undefined): boolean {
    if (!value) return false
    return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes'
  }

  resolve(): EnvConfig {
    const ci =
      EnvResolver.isTruthy(process.env.CI) || EnvResolver.isTruthy(process.env.TWOCONTEXT_CI) || !process.stdout.isTTY

    return {
      ci,
      silent: EnvResolver.isTruthy(process.env.TWOCONTEXT_SILENT),
      noColor:
        ci || EnvResolver.isTruthy(process.env.NO_COLOR) || EnvResolver.isTruthy(process.env.TWOCONTEXT_NO_COLOR),
      provider: process.env.TWOCONTEXT_PROVIDER,
      model: process.env.TWOCONTEXT_MODEL,
      branch: process.env.TWOCONTEXT_BRANCH,
      verbose: EnvResolver.isTruthy(process.env.TWOCONTEXT_VERBOSE),
      force: EnvResolver.isTruthy(process.env.TWOCONTEXT_FORCE),
    }
  }
}
