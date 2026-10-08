/**
 * Mermaid syntax highlighting for the editor's backdrop rows.
 *
 * The grammar is the local mermaidGrammar (vendored regex-based highlight.js
 * definition — see mermaidGrammar.ts); it registers into the same
 * highlight.js core instance the code blocks use.
 *
 * Highlighting is per line EXCEPT the frontmatter block (`---` fenced at the
 * top of the source): frontmatter lines are highlighted with the grammar's
 * own key/value rules, which are line-local, so no cross-line state is lost.
 *
 * Cost measured: ~0.06 ms per 10-line source.
 */
import hljs from "../code-block-hljs/utils/hljs";
import { mermaidGrammar } from "./mermaidGrammar";

let registered = false;

function ensureRegistered(): void {
  if (registered) return;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- hljs core is untyped here (see code-block-hljs/utils/hljs)
  (hljs as unknown as { registerLanguage: (n: string, g: unknown) => void }).registerLanguage(
    "mermaid",
    mermaidGrammar,
  );
  registered = true;
}

/** HTML-escapes a line — the fallback when the grammar itself fails, so the
 *  backdrop keeps showing the source (aligned with the caret) instead of a
 *  blank line. */
function escapeHtml(line: string): string {
  return line
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** True while the source's leading frontmatter fence is open. */
function inFrontmatter(lines: string[], index: number): boolean {
  if (lines[0]?.trim() !== "---") return false;
  for (let i = 1; i < index; i += 1) {
    if (lines[i]?.trim() === "---") return false;
  }
  return index > 0;
}

/** Highlights one line of mermaid source to hljs HTML (spans only). */
function highlightLine(line: string, language: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- see utils/hljs
    return (hljs as unknown as { highlight: (c: string, o: { language: string }) => { value: string } }).highlight(
      line,
      { language },
    ).value;
  } catch {
    // A grammar failure must never blank a row — the escaped source keeps the
    // caret overlay aligned with the backdrop.
    return escapeHtml(line);
  }
}

/**
 * Highlights mermaid lines for the backdrop rows: one html string per input
 * line (empty string renders an empty row). The frontmatter fence switches
 * those lines to the "yaml"-style key/value highlighting; everything else is
 * highlighted with the mermaid grammar.
 */
export function highlightMermaidLines(lines: string[]): string[] {
  ensureRegistered();
  return lines.map((line, index) => {
    if (line.trim() === "") return "";
    if (line.trim() === "---") {
      // the fence itself: a meta line in both grammars
      return highlightLine("---", "yaml");
    }
    if (inFrontmatter(lines, index)) {
      return highlightLine(line, "yaml");
    }
    return highlightLine(line, "mermaid");
  });
}
