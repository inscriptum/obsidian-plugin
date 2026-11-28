/**
 * The exported page shell — a full standalone HTML document.
 *
 * Ported from the inscriptum blog's publish template
 * (blog/src/components/draft/draft.service.ts, publishDraft): same body
 * structure (`article > section+`) and meta set so an exported page can be
 * dropped into that blog unchanged. Differences: the stylesheet is a local
 * relative `note.css` with fonts embedded (no inline style, no site
 * absolute paths). Small standalone scripts add navigation and controls.
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
  /** Escaped labels for full-notepad exports; absent for notes and single pages. */
  foldLabels?: string[];
  /** Collapsed-row metadata, aligned with sections and already escaped. */
  foldMetadata?: { date: string; timestamp: string; words: string; order: number; empty: boolean }[];
}

/** Details start open in the HTML so every page remains readable without JS. */
const PAGE_FOLD_SCRIPT = `(function () {
  var pages = Array.prototype.slice.call(document.querySelectorAll(".export-page"));
  var controls = document.querySelector(".page-fold-controls");
  if (!pages.length || !controls) return;
  var key = "inscriptum-page-folds:" + location.pathname;
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch (e) {}
  var requested = new URLSearchParams(location.search).get("pages");
  function persist(changedPage, nextOpen) {
    var state = {};
    pages.forEach(function (page) { state[page.parentElement.id] = page === changedPage ? nextOpen : page.open; });
    try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) {}
  }
  pages.forEach(function (page) {
    var id = page.parentElement.id;
    page.open = requested === "open" ? true : requested === "closed" ? false : saved[id] === true;
  });
  function reveal(hash) {
    var id;
    try { id = decodeURIComponent(hash.slice(1)); } catch (e) { return; }
    var section = document.getElementById(id);
    if (!section) return;
    var page = section.querySelector(".export-page");
    if (!page) return;
    page.open = true;
    persist();
    section.scrollIntoView();
  }
  if (location.hash) reveal(location.hash);
  controls.hidden = false;
  controls.addEventListener("click", function (event) {
    var button = event.target && event.target.closest ? event.target.closest("[data-pages]") : null;
    var action = button && button.getAttribute("data-pages");
    if (action !== "open" && action !== "closed") return;
    pages.forEach(function (page) { page.open = action === "open"; });
    persist();
  });
  pages.forEach(function (page) {
    // Native toggle events are queued; a reload immediately after a click
    // can happen before they fire. Save synchronously with the action.
    page.querySelector("summary").addEventListener("click", function () {
      persist(page, !page.open);
    });
    page.addEventListener("toggle", function () { persist(); });
  });
  window.addEventListener("hashchange", function () { reveal(location.hash); });
  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href^="#"]') : null;
    if (link) reveal(link.getAttribute("href"));
  });
})();`;

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
    if (event.key !== "Escape") return;
    if (!drawer.classList.contains("is-open")) return;
    close();
    // the focused contents link just disappeared — keep the focus cue
    // on a visible control
    toggle.focus();
  });
})();`;

/**
 * The figure lightbox for the published page (images and mermaid diagrams
 * share the same `<figure><img>` markup, see postprocess.ts): a delegated
 * click opens a fullscreen overlay with the enlarged object; the closing
 * model mirrors the editor's lightbox — Esc, the corner ✕, or a click on the
 * dark background outside the object (the object itself never closes). The
 * capture-phase Esc handler stops propagation while the overlay is open, so
 * the contents drawer below does not close with it. Keyboard parity: every
 * figure is a focusable opener (Tab + Enter/Space), opening moves the focus
 * to the ✕ and Tab stays inside the viewer, closing restores the focus to
 * the figure it came from. Zero dependencies, works from file://.
 */
const LIGHTBOX_SCRIPT = `(function () {
  var overlay = null;
  var opener = null;
  function close() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    if (opener) {
      opener.focus();
      opener = null;
    }
  }
  function open(fig) {
    var img = fig.querySelector("img");
    if (!img) return;
    close();
    opener = fig;
    overlay = document.createElement("div");
    overlay.className = "site-lightbox";
    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "site-lightbox__close";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.textContent = "\\u00d7";
    closeButton.addEventListener("click", close);
    overlay.appendChild(closeButton);
    var enlarged = document.createElement("img");
    enlarged.src = img.getAttribute("src");
    enlarged.alt = img.getAttribute("alt") || "";
    overlay.appendChild(enlarged);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    // the ✕ is the only focusable thing in the viewer — keep Tab on it
    overlay.addEventListener("keydown", function (event) {
      if (event.key === "Tab") {
        event.preventDefault();
        closeButton.focus();
      }
    });
    document.body.appendChild(overlay);
    closeButton.focus();
  }
  // figures become focusable openers (Tab + Enter/Space), like buttons
  var figures = document.querySelectorAll("article figure");
  for (var i = 0; i < figures.length; i += 1) {
    if (!figures[i].querySelector("img")) continue;
    figures[i].setAttribute("tabindex", "0");
    figures[i].setAttribute("role", "button");
    figures[i].setAttribute("aria-label", "Open picture in viewer");
  }
  function figureFrom(target) {
    if (!target || !target.closest) return null;
    var fig = target.closest("article figure");
    return fig && fig.querySelector("img") ? fig : null;
  }
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || !overlay) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }, true);
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (overlay) return;
    var fig = figureFrom(event.target);
    if (!fig) return;
    event.preventDefault();
    open(fig);
  });
  document.addEventListener("click", function (event) {
    var fig = figureFrom(event.target);
    if (!fig) return;
    event.preventDefault();
    open(fig);
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
      if (meta.foldLabels) {
        if (id === "page-1") return `      <section${attr} class="export-cover">\n        ${html}\n      </section>`;
        return `      <section${attr} class="export-fold-section">\n        <details class="export-page" open><summary><svg class="export-page__chevron" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"></polyline></svg><span class="export-page__label${meta.foldMetadata?.[index]?.empty ? " is-empty" : ""}">${meta.foldLabels[index]}</span><span class="export-page__leader" aria-hidden="true"></span><span class="export-page__meta" title="${meta.foldMetadata?.[index]?.timestamp ?? ""}">${meta.foldMetadata?.[index]?.date ?? ""} · ${meta.foldMetadata?.[index]?.words ?? ""}<span class="export-page__order">${meta.foldMetadata?.[index]?.order ?? ""}</span></span></summary><div class="export-page__content">${html}</div></details>\n      </section>`;
      }
      return `      <section${attr}>\n        ${html}\n      </section>`;
    })
    .join("\n");
  const toc = meta.toc?.length
    ? `
    <nav class="toc-drawer" id="toc-drawer" aria-label="Contents">
      <button class="toc-toggle" type="button" aria-label="Contents" aria-controls="toc-drawer" aria-expanded="false" title="Contents">
        <svg class="icon-menu" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="18" x2="20" y2="18"></line></svg>
        <svg class="icon-close" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="17" y1="7" x2="7" y2="17"></line><line x1="7" y1="7" x2="17" y2="17"></line></svg>
      </button>
      ${meta.foldLabels ? `<div class="page-fold-controls" hidden><button type="button" data-pages="open" aria-label="Expand all pages" title="Expand all pages"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg></button><button type="button" data-pages="closed" aria-label="Collapse all pages" title="Collapse all pages"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/></svg></button></div>` : ""}
      <ul class="toc-list">
${meta.toc
  .map(
    (entry) =>
      `        <li><a class="toc-item${entry.empty ? " is-empty" : ""}${entry.num == null || entry.num === "" ? " is-cover" : ""}" href="${entry.href}" title="${entry.label}"><span class="toc-numb">${entry.num ?? ""}</span><span class="toc-header">${entry.label}</span></a></li>`,
  )
  .join("\n")}
      </ul>
    </nav>`
    : "";
  const tocScript = meta.toc?.length
    ? `
    <script>${TOC_SCRIPT}</script>`
    : "";
  // Pages without figures skip the lightbox script entirely. The check is a
  // heuristic on the serialized markup (postprocess always emits lowercase
  // "<figure>"; a false positive only ships a harmless no-op script).
  const lightboxScript = meta.sections.some((html) => html.includes("<figure"))
    ? `
    <script>${LIGHTBOX_SCRIPT}</script>`
    : "";
  const foldScript = meta.foldLabels ? `\n    <script>${PAGE_FOLD_SCRIPT}</script>` : "";

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
    <script>${COPY_SCRIPT}</script>${lightboxScript}${tocScript}${foldScript}
  </body>
</html>
`;
}
