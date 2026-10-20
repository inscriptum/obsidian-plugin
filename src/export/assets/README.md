# Export stylesheet

`note.css` is a generated, self-contained stylesheet written next to
`index.html` by the "Export as website" feature. It embeds the page fonts
(Inter, JetBrains Mono) as base64 data URIs, so an export folder needs no
`fonts/` directory and renders identically from `file://` or any static host.

Composition:

1. Generated-file header with the stylelint gate note (why the deployed
   part's intentional browser-feature usages are exempt).
2. `@font-face` rules with the fonts inlined as data URIs.
3. The deployed inscriptum stylesheet (`https://inscriptum.js.org/css/note.css`)
   with duplicate property declarations removed (keep-last — cascade
   equivalent) and legacy IE star-hacks dropped; this satisfies the
   project's `npm run lint:css` gate for the generated file.
4. The hand-maintained `Export additions` section (float clearing, image
   layouts, the code block chrome, the export-only table rules) — preserved
   verbatim from the previous build.

## Regenerating

```sh
node scripts/generate-note-css.mjs                 # fetch the deployed CSS
node scripts/generate-note-css.mjs --from old.css  # offline: use a local copy
```

The script reuses the embedded `@font-face` rules and the `Export additions`
section from the current file. When the source design (blog) changes,
re-fetch; when the fonts change, re-derive the `@font-face` block manually:
extract the `@font-face` rules from any exported note in
`blog/src/public/note/*.html`, inline the four font files from
`blog/src/public/fonts/` as data URIs, and replace part 2 in `note.css`
before regenerating.
