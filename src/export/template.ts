/**
 * The exported page shell — a full standalone HTML document.
 *
 * Ported from the inscriptum blog's publish template
 * (blog/src/components/draft/draft.service.ts, publishDraft): same body
 * structure (`article > section+`) and meta set so an exported page can be
 * dropped into that blog unchanged. Differences: the stylesheet is a local
 * relative `note.css` with fonts embedded (no inline style, no site
 * absolute paths) and there is no page script.
 */

/** One contents entry: in-page anchor href (`#…`) and the page label. */
export interface ExportTocEntry {
  href: string;
  /** Already HTML-escaped (see escapeDescription). */
  label: string;
  /** Page number in the left gutter (the cover carries none). */
  num?: string;
  /** Untitled page — the label renders muted-italic, like the editor's
   *  "Untitled" rows. */
  empty?: boolean;
}

export interface ExportPageMeta {
  title: string;
  /** Already attribute-escaped (see escapeDescription). */
  description: string;
  /** Relative src for og:image / twitter:image, or null. */
  previewImageSrc: string | null;
  /** ISO timestamps (file birthtime / mtime). */
  created: string;
  modified: string;
  /** Serialized article content, one `<section>` per entry — a flat note
   *  has a single section, a notepad one per page in manifest order. */
  sections: string[];
  /** Anchor ids for the sections, same order — stable deep links
   *  (`#page-1`, …). */
  sectionIds?: string[];
  /** Contents entries rendered as the ☰ navigation drawer (the notepad's
   *  page navigator). Absent/empty → no drawer, like the .note export. */
  toc?: ExportTocEntry[];
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

/**
 * Toggle + close logic for the contents drawer (see postprocess.ts's copy
 * button for the delegated-listener style): ☰ flips `is-open`, a click on
 * any anchor inside the drawer closes it (the jump happened), Esc closes.
 */
const TOC_SCRIPT = `(function () {
  var toggle = document.querySelector(".toc-toggle");
  var drawer = document.querySelector(".toc-drawer");
  if (!toggle || !drawer) return;
  function close() {
    drawer.classList.remove("is-open");
    toggle.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  }
  toggle.addEventListener("click", function () {
    var open = drawer.classList.toggle("is-open");
    toggle.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  drawer.addEventListener("click", function (event) {
    var link = event.target && event.target.closest
      ? event.target.closest('a[href^="#"]') : null;
    if (link) close();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") close();
  });
})();`;

export function buildPageHtml(meta: ExportPageMeta): string {
  const ogImage = meta.previewImageSrc
    ? `\n        <meta property="og:image" content="${meta.previewImageSrc}">
        <meta name="twitter:image" content="${meta.previewImageSrc}">`
    : "";
  const sections = meta.sections
    .map((html, index) => {
      const id = meta.sectionIds?.[index];
      const attr = id != null ? ` id="${id}"` : "";
      return `      <section${attr}>\n        ${html}\n      </section>`;
    })
    .join("\n");
  const toc = meta.toc?.length
    ? `
    <button class="toc-toggle" type="button" aria-label="Contents" aria-controls="toc-drawer" aria-expanded="false" title="Contents">
      <svg class="icon-menu" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="18" x2="20" y2="18"></line></svg>
      <svg class="icon-close" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>
    <nav class="toc-drawer" id="toc-drawer" aria-label="Contents">
      <ul class="toc-list">
${meta.toc
  .map(
    (entry) =>
      `        <li><a class="toc-item${entry.empty ? " is-empty" : ""}" href="${entry.href}" title="${entry.label}"><span class="toc-numb">${entry.num ?? ""}</span><span class="toc-header">${entry.label}</span></a></li>`,
  )
  .join("\n")}
      </ul>
    </nav>`
    : "";
  const tocScript = meta.toc?.length
    ? `
    <script>${TOC_SCRIPT}</script>`
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
  <body>${toc}
    <article>
${sections}
    </article>
    <script>${COPY_SCRIPT}</script>${tocScript}
  </body>
</html>
`;
}
