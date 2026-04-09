/**
 * Convert a free-form string into a URL-safe slug.
 * Lowercased, non-alphanumerics collapsed to dashes, trimmed, max 60 chars.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60)
}
