/**
 * Mermaid grammar for highlight.js — vendored from lowlight-mermaid v0.0.0
 * (github.com/react18-tools/lowlight-mermaid, MPL-2.0), de-minified and
 * adapted. highlight.js v11 registerLanguage expects a FACTORY function
 * `(hljs) => grammar` — the hljs argument provides the COMMENT helper.
 * Kept local on purpose — the upstream package is an early v0.0.0 and the
 * grammar is a frozen ~1.4 KB data object.
 */
export const mermaidGrammar = (hljs: {
  COMMENT: (begin: RegExp, end: RegExp) => unknown;
}): unknown => ({
  name: "Mermaid",
  aliases: ["mermaid"],
  case_insensitive: true,
  contains: [
    /* Directives and frontmatter MUST precede the comment rule: both start
       with `%%`/`---`, and hljs picks the first rule matching at a position —
       a later comment rule would swallow `%%{...}%%` and `---` fences. */
    {
      className: "meta",
      begin: /%%\{/,
      end: /\}%%/,
      contains: [
        { className: "attr", begin: /[A-Za-z][A-Za-z0-9_-]*(?=\s*:)/ },
        { className: "string", begin: /:\s*/, end: /(?=(,\s*[A-Za-z]|$))/, excludeBegin: true },
      ],
    },
    {
      className: "meta",
      begin: /^---\s*$/,
      end: /^---\s*$/,
      contains: [
        { className: "attr", begin: /^\s*[A-Za-z][A-Za-z0-9_-]*:/, end: /:/, excludeEnd: true },
        { className: "string", begin: /:\s*/, end: /$/, excludeBegin: true },
      ],
    },
    hljs.COMMENT(/%%/, /$/),
    {
      className: "keyword",
      begin:
        /\b(?:flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|pie|gantt|requirement|sankey|timeline|quadrant)(?:\s+(?:LR|TB|RL|BT))?\b/,
    },
    {
      className: "operator",
      begin: /(?:-->|---|-\.-|==>|<-+>|o--o|x--x|\|>|<\||<-->|==|--\||\|--|->>|-->>|<\|--|\*--|:>|o\{--|\}o--)/,
    },
    {
      className: "meta",
      begin: /\b[A-Za-z0-9_]+\s*-[->]+[A-Za-z0-9_]+\s*:/,
      end: /$/,
      contains: [{ className: "string", begin: /:\s*/, end: /$/, excludeBegin: true }],
    },
    {
      className: "string",
      variants: [
        { begin: /\[[^\]]+\]/ },
        { begin: /\([^)]+\)/ },
        { begin: /\(\([^)]+\)\)/ },
        { begin: /\{[^}]+\}/ },
        { begin: />[^<]+</ },
        { begin: /\[\[[^\]]+\]\]/ },
      ],
    },
    { className: "string", begin: /note\s+(?:left|right|top|bottom)\s+of\s+[A-Za-z0-9_]+/i },
    /* numbers before title: the title rule's character class would otherwise
       match bare digit runs and style them as identifiers */
    { className: "number", begin: /\b\d+([:.]\d+)?\b/ },
    { className: "title", begin: /\b[A-Za-z_][A-Za-z0-9_]*\b/ },
    { className: "string", begin: /".*?"/ },
    { className: "punctuation", begin: /[:;#{}[\]()]/ },
  ],
});
