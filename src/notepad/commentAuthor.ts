/** Display name signed into new comments (v1 is single-user). The plugin
 *  injects a settings-backed provider at load (the setWriteLogEnabled
 *  pattern); the fallback keeps tests and any non-plugin host at "You". An
 *  empty/whitespace setting value also falls back. The name is stored per
 *  comment in the container's comments.jsonl at creation time. */

const FALLBACK = "You";

let provider: (() => string) | null = null;

export function setCommentAuthorProvider(get: () => string): void {
  provider = get;
}

export function clearCommentAuthorProvider(): void {
  provider = null;
}

export function commentAuthor(): string {
  const name = provider?.().trim();
  return name ? name : FALLBACK;
}
