/**
 * The exported page shell — a full standalone HTML document.
 *
 * Ported from the inscriptum blog's publish template
 * (blog/src/components/draft/draft.service.ts, publishDraft): same body
 * structure (`article > section`) and meta set so an exported page can be
 * dropped into that blog unchanged. Differences: the stylesheet is a local
 * relative `note.css` with fonts embedded (no inline style, no site
 * absolute paths) and there is no page script.
 */

export interface ExportPageMeta {
  title: string;
  /** Already attribute-escaped (see escapeDescription). */
  description: string;
  /** Relative src for og:image / twitter:image, or null. */
  previewImageSrc: string | null;
  /** ISO timestamps (file birthtime / mtime). */
  created: string;
  modified: string;
  /** Serialized article content, wrapped in its `<section>`. */
  contentHtml: string;
}

/**
 * The copy-code handler for the code block chrome (see postprocess.ts):
 * one delegated listener swaps the copy icon for a check mark and writes
 * the block's text to the clipboard, with an execCommand fallback for
 * non-secure contexts (file://).
 */
const COPY_SCRIPT = `(function () {
  var COPIED_MS = 1500;
  function copyText(text, done) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
    } else {
      fallback(text, done);
    }
  }
  function fallback(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) {}
    ta.remove();
  }
  document.addEventListener("click", function (event) {
    var btn = event.target && event.target.closest
      ? event.target.closest(".hljs-codeblock__btn--copy") : null;
    if (!btn) return;
    var block = btn.closest(".hljs-codeblock");
    var code = block ? block.querySelector("pre code") : null;
    if (!code) return;
    copyText(code.innerText, function () {
      btn.classList.add("is-copied");
      window.setTimeout(function () { btn.classList.remove("is-copied"); }, COPIED_MS);
    });
  });
})();`;

export function buildPageHtml(meta: ExportPageMeta): string {
  const ogImage = meta.previewImageSrc
    ? `\n        <meta property="og:image" content="${meta.previewImageSrc}">
        <meta name="twitter:image" content="${meta.previewImageSrc}">`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${meta.title}</title>
    <meta name="description" content="${meta.description}">
    <meta property="og:type" content="article">
    <meta property="og:title" content="${meta.title}">
    <meta property="og:description" content="${meta.description}">${ogImage}
    <meta property="article:published_time" content="${meta.created}">
    <meta property="article:modified_time" content="${meta.modified}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${meta.title}">
    <meta name="twitter:description" content="${meta.description}">
    <link href="note.css" rel="stylesheet">
  </head>
  <body>
    <article>
      <section>
        ${meta.contentHtml}
      </section>
    </article>
    <script>${COPY_SCRIPT}</script>
  </body>
</html>
`;
}
