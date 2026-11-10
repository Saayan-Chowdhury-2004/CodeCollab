/**
 * Normalizes user-generated text fields (display names, titles, descriptions, comments, summaries).
 * Trims leading/trailing whitespace and strips non-printable control characters
 * while preserving standard whitespace (\n, \r, \t).
 *
 * In CodeCollab's JSON API architecture:
 * - React automatically escapes text rendered in JSX.
 * - Monaco Editor renders code as plaintext in virtual DOM without executing HTML/JS.
 * - ts_headline outputs are safely parsed into React elements without innerHTML.
 */
export function normalizePlainText(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

export const sanitizePlainText = normalizePlainText;
