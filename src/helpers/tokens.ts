import { TokenSplitter } from '@/helpers/token-splitter.js'

const splitter = new TokenSplitter()

export function countTextTokens(text: string): number {
  return splitter.estimateTokenCount(text)
}

export function splitTextIntoDistinctTokenChunks(
  text: string,
  maxTokens: number,
): Array<{ part: string; tokens: number }> {
  const totalTokens = splitter.estimateTokenCount(text)
  if (totalTokens <= maxTokens) {
    return [{ part: text, tokens: totalTokens }]
  }

  return splitter.splitByTokens(text, maxTokens)
}

export function limitTextTokens(text: string, maxTokens: number): string {
  const totalTokens = splitter.estimateTokenCount(text)
  if (totalTokens <= maxTokens) {
    return text
  }

  const chunks = splitter.splitByTokens(text, maxTokens)
  return chunks.length > 0 ? chunks[0].part : ''
}
