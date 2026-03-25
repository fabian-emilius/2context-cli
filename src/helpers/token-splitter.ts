export class TokenSplitter {
  estimateTokenCount(text: string, limit?: number): number {
    return this.walk(text, 0, text.length, limit).tokens
  }

  /**
   * Split text into chunks of approximately `maxTokens` each.
   * Splits at logical boundaries (whitespace, punctuation, newlines).
   */
  splitByTokens(
    text: string,
    maxTokens: number,
    startOffset = 0,
    endOffset = text.length,
  ): Array<{ part: string; tokens: number }> {
    const chunks: Array<{ part: string; tokens: number }> = []
    let i = startOffset

    while (i < endOffset) {
      const result = this.walk(text, i, endOffset, maxTokens)

      if (result.end <= i) {
        // Safety: always advance at least 1 char
        result.end = i + 1
        result.tokens = 1
      }

      // Try to snap to a clean boundary if we didn't consume everything
      const snapped = result.end < endOffset ? this.snapToBreak(text, i, result.end) : result.end

      const part = text.slice(i, snapped)
      if (part.length > 0) {
        // Re-count if we snapped backwards significantly
        const tokens = snapped !== result.end ? this.walk(text, i, snapped).tokens : result.tokens
        chunks.push({ part, tokens })
      }

      i = snapped
    }

    return chunks
  }

  /**
   * Core single-pass scanner. Returns estimated tokens and the char offset
   * where it stopped (either end of range or when limit was hit).
   */
  private walk(text: string, start: number, end: number, limit?: number): { tokens: number; end: number } {
    let tokens = 0
    let i = start
    const hasLimit = limit !== undefined

    while (i < end) {
      if (hasLimit && tokens >= limit!) return { tokens, end: i }

      const code = text.charCodeAt(i)

      // --- Whitespace ---
      if (code <= 32) {
        if (code === 10) {
          tokens++
          i++
          let indent = 0
          while (i < end) {
            const c = text.charCodeAt(i)
            if (c === 32 || c === 9) {
              indent++
              i++
            } else break
          }
          if (indent > 0) tokens += Math.ceil(indent / 4)
          continue
        }
        if (code === 13) {
          i++
          continue
        }
        i++
        continue
      }

      // --- Digits ---
      if (code >= 48 && code <= 57) {
        let digitLen = 0
        while (i < end) {
          const c = text.charCodeAt(i)
          if ((c >= 48 && c <= 57) || c === 46) {
            digitLen++
            i++
          } else break
        }
        tokens += Math.ceil(digitLen / 2)
        continue
      }

      // --- Letters / identifiers ---
      if (isLetter(code) || code === 95) {
        tokens += this.consumeWord(text, i, end)
        while (i < end) {
          const c = text.charCodeAt(i)
          if (isLetter(c) || (c >= 48 && c <= 57) || c === 95) i++
          else break
        }
        continue
      }

      // --- Punctuation / symbols ---
      tokens++
      i++
    }

    return { tokens, end: i }
  }

  /**
   * Try to snap a split position back to a clean break point.
   * Prefers: newline > whitespace > punctuation. Gives up if
   * no good break is found within ~10% of the position.
   */
  private snapToBreak(text: string, chunkStart: number, pos: number): number {
    const lookback = Math.max(32, Math.floor((pos - chunkStart) * 0.1))
    const earliest = Math.max(chunkStart + 1, pos - lookback)

    // Prefer newline
    for (let j = pos; j >= earliest; j--) {
      if (text.charCodeAt(j) === 10) return j + 1
    }

    // Then whitespace
    for (let j = pos; j >= earliest; j--) {
      const c = text.charCodeAt(j)
      if (c === 32 || c === 9) return j + 1
    }

    // Then any punctuation
    for (let j = pos; j >= earliest; j--) {
      const c = text.charCodeAt(j)
      if (!isLetter(c) && !(c >= 48 && c <= 57) && c !== 95) return j + 1
    }

    // No good break — split at the estimated position
    return pos
  }

  private consumeWord(text: string, start: number, textLen: number): number {
    let tokens = 0
    let subwordLen = 0
    let prevWasLower = false
    let i = start

    while (i < textLen) {
      const code = text.charCodeAt(i)

      if (code === 95 || code === 36) {
        if (subwordLen > 0) tokens += subwordTokens(subwordLen)
        subwordLen = 0
        prevWasLower = false
        i++
        continue
      }

      if (!isLetter(code) && !(code >= 48 && code <= 57)) break

      const isUpper = code >= 65 && code <= 90

      if (prevWasLower && isUpper) {
        tokens += subwordTokens(subwordLen)
        subwordLen = 0
      }

      subwordLen++
      prevWasLower = isLetter(code) && !isUpper

      if (subwordLen >= 6) {
        tokens += subwordTokens(subwordLen)
        subwordLen = 0
        prevWasLower = false
      }

      i++
    }

    if (subwordLen > 0) tokens += subwordTokens(subwordLen)
    return Math.max(1, tokens)
  }
}

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function subwordTokens(len: number): number {
  return len <= 5 ? 1 : 2
}
