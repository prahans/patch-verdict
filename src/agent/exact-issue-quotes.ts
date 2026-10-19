/**
 * Copy-ready issue excerpts for the regression writer. These are verbatim
 * substrings of the canonical issue input, never AI paraphrases.
 *
 * The list only helps the model choose a quote; final grounding still checks
 * exact substring inclusion against the full canonical issue text.
 */
export function exactIssueQuoteOptions(issue: string): string[] {
  const maxQuotes = 20;
  const maxQuoteLength = 500;
  const quotes = new Set<string>();
  for (const rawLine of issue.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length < 8 || /^#{1,6}\s/.test(line) || /^🤖/.test(line))
      continue;
    // Retain the prefix literally: even a truncated long line is a real span.
    const quote = line.slice(0, maxQuoteLength);
    if (quote.trim().length >= 8) quotes.add(quote);
    if (quotes.size >= maxQuotes) break;
  }
  // Some issues are a single short paragraph or contain only markdown headers.
  if (!quotes.size && issue.trim().length >= 8) {
    const first = issue.trim().slice(0, maxQuoteLength);
    if (issue.includes(first)) quotes.add(first);
  }
  return [...quotes];
}
