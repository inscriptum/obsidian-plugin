/**
 * Mermaid syntax highlighting for the editor's backdrop rows.
 *
 * The grammar is the local mermaidGrammar (vendored regex-based highlight.js
 * definition — see mermaidGrammar.ts); it registers into the same
 * highlight.js core instance the code blocks use.
 *
 * Highlighting is per line: mermaid has no multi-line constructs (%%
 * comments and quoted strings are single-line), so splitting the source into
 * rows — which the backdrop does anyway for line numbers — cannot corrupt
 * tokens. Cost measured: ~0.06 ms per 10-line source.
 */
import hljs from "../code-block-hljs/utils/hljs";
import { mermaidGrammar } from "./mermaidGrammar";

let registered = false;

/** Highlights one line of mermaid source to hljs HTML (spans only). */
export function highlightMermaidLine(line: string): string {
  if (!registered) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- hljs core is untyped here (see code-block-hljs/utils/hljs)
    (hljs as unknown as { registerLanguage: (n: string, g: unknown) => void }).registerLanguage(
      "mermaid",
      mermaidGrammar,
    );
    registered = true;
  }
  if (line.trim() === "") return "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- see above
    return (hljs as unknown as { highlight: (c: string, o: { language: string }) => { value: string } }).highlight(
      line,
      { language: "mermaid" },
    ).value;
  } catch {
    // A grammar failure must never break editing — plain text renders instead.
    return "";
  }
}
