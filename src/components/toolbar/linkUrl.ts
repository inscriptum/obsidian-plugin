/**
 * Normalizes the URL typed into the toolbar link layer.
 * Empty input yields "" (nothing to apply); a bare domain ("example.com")
 * would become a useless relative href, so it defaults to https —
 * real schemes (http:, mailto:, obsidian://, tel:) are kept as-is.
 */
export function normalizeLinkUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return "";
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) ? url : `https://${url}`;
}
