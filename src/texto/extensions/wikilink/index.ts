export { WikiLink } from "./wikilink";
export type { WikiFile, WikiHooks, WikiLinkOptions } from "./wikilink";
export { WikiLinkMark } from "./wikiMark";
export {
  wikiSuggestPlugin,
  wikiSuggestKey,
  extractWikiQuery,
  filterFiles,
  scoreFile,
  acceptWikiSuggestion,
  MAX_SUGGESTIONS,
} from "./wikilinkSuggest";
export type { WikiQuery } from "./wikilinkSuggest";
export { selectionInWikiContext } from "./wikilink";
