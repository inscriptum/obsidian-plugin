# Export stylesheet

`note.css` is a generated, self-contained stylesheet written next to
`index.html` by the "Export as website" feature. It embeds the page fonts
(Inter, JetBrains Mono) as base64 data URIs, so an export folder needs no
`fonts/` directory and renders identically from `file://` or any static host.

Composition:

1. `@font-face` rules (copied from the inscriptum notepad's injected style,
   URLs replaced with data URIs).
2. The deployed inscriptum article stylesheet (`/css/note.css`) — normalize,
   typography variables, `article`-scoped content styles, night-owl code
   highlight theme, task list / table / figure styles.

To regenerate (e.g. after the source design changes):

1. Download the current deployed stylesheet:
   `curl -o /tmp/note.css https://inscriptum.js.org/css/note.css`
2. Re-run the generator snippet from the repository history
   (scripts/…): it extracts the `@font-face` rules from any exported note in
   `blog/src/public/note/*.html`, inlines the four font files from
   `blog/src/public/fonts/` as data URIs and concatenates the deployed CSS.
3. Re-apply the hand-maintained `Export additions` section at the bottom of
   the file (float clearing, image layouts and the code block chrome) — the
   generator only produces parts 1–2.
