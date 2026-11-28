import { moment } from "obsidian";

/** Match the notepad's folded-row word count: count tokens in text nodes. */
export function countPageWords(node: unknown): number {
  if (node == null || typeof node !== "object") return 0;
  const rec = node as { text?: unknown; content?: unknown };
  const own = typeof rec.text === "string"
    ? rec.text.split(/\s+/).filter(Boolean).length
    : 0;
  return own + (Array.isArray(rec.content)
    ? rec.content.reduce<number>((sum, child) => sum + countPageWords(child), 0)
    : 0);
}

/** Obsidian's moment uses the same active locale as the notepad UI. */
export function formatPageDate(epochMs: number, format: string): string {
  return (moment as unknown as {
    (t: number): { format(f: string): string };
  })(epochMs).format(format);
}

export function formatPageWordCount(words: number): string {
  return words === 0 ? "Empty" : words === 1 ? "1 word" : `${words} words`;
}
