/**
 * Maps the editor's serialization onto plain, self-contained page HTML:
 *  - `<texto-extension-image>` (a vault-file reference) → `<figure><img>`
 *    with a relative `images/<file>` source;
 *  - `<texto-extension-attachment>` → dropped (an attachment is a vault
 *    binary — a published page cannot link into the vault);
 *  - `<texto-extension-mermaid>` → `<figure class="mermaid-figure"><img>` —
 *    the diagram is compiled to a standalone SVG via the `renderDiagram`
 *    callback, returned in `diagrams` as a file to write into `images/`,
 *    and referenced relatively; dropped when the compile fails or no
 *    callback is given;
 *  - `<pre><code>` (code blocks) → wrapped into `.hljs-codeblock` with the
 *    language label and a copy button, mirroring the editor's controls
 *    (see code-block-hljs/style.css and codeBlockSelectLang.element.tsx);
 *  - task checkboxes → `disabled` (a published page is read-only).
 *
 * The function is a pure (async) DOM transformation; resolving a vault path
 * to an export file name is delegated to the `resolveTarget` callback so the
 * caller owns existence checks and file naming (dedupe happens there too).
 */

import { aliasToLanguage } from "../texto/extensions/code-block-hljs/utils/hljs";
import { parseSvgElement } from "../texto/extensions/mermaid/mermaidApi";

/** Resolves an image node's `data.id` (vault path) to the file name it will
 *  have inside the export's `images/` folder, or null when the source file
 *  is unavailable and the figure must be dropped. */
export type ResolveImageTarget = (vaultPath: string) => string | null;

/** Compiles mermaid source to a standalone SVG string, or null when the
 *  source is invalid / rendering failed (the figure is then dropped). */
export type RenderDiagram = (code: string) => Promise<string | null>;

/** A rendered diagram: the SVG file to write into the export's `images/`
 *  folder and the relative file name the `<img>` points at. */
export interface ExportDiagramFile {
  name: string;
  svg: string;
}

export interface PostProcessResult {
  html: string;
  /** Vault paths referenced by the resulting HTML (deduplicated, order of
   *  first appearance). */
  images: string[];
  /** Vault paths referenced by the note but missing from the vault; their
   *  figures were dropped. */
  missing: string[];
  /** How many attachment blocks were removed. */
  removedAttachments: number;
  /** How many mermaid diagrams were dropped (render failed or unavailable). */
  droppedDiagrams: number;
  /** SVG files produced from mermaid nodes — the caller writes them into
   *  `images/` under their names (see ExportDiagramFile). */
  diagrams: ExportDiagramFile[];
}

const IMAGE_TAG = "texto-extension-image";
const ATTACHMENT_TAG = "texto-extension-attachment";
const MERMAID_TAG = "texto-extension-mermaid";

const LANGUAGE_CLASS_PREFIX = "language-";

/**
 * Inline figure styles for an explicit user width (the plugin applies the
 * width to the image host via `element.style.width`, overriding the layout
 * default). Layout itself (align / float) is carried by `data-align` and
 * styled in the export stylesheet — see the "Export additions" section of
 * assets/note.css, a port of texto/image style.css.
 */
function figureWidthStyle(width: string | null): string {
  return width != null && width !== "" ? `width: ${width};` : "";
}

/**
 * The language shown on the code block: the editor persists hljs alias
 * classes (`language-js language-javascript`, …) on the code element —
 * resolve the first known alias to its display name ("JavaScript"),
 * falling back to "auto" like the editor's picker.
 */
function languageLabel(codeClass: string | null): string {
  for (const cls of (codeClass ?? "").split(/\s+/)) {
    if (!cls.startsWith(LANGUAGE_CLASS_PREFIX)) continue;
    const name = aliasToLanguage.get(cls.slice(LANGUAGE_CLASS_PREFIX.length));
    if (name != null) return name;
  }
  return "auto";
}

/** Standalone icons (same shapes as the editor's `inscriptum-tlb-*` sprite
 *  symbols — the exported page ships no sprite, so they are inlined). Built
 *  via createElementNS; the serialized markup matches the icon literals used
 *  by the editor sprite. */
const SVG_NS = "http://www.w3.org/2000/svg";

type IconShape = { tag: string; attrs: Record<string, string> };

/** Export post-processing builds DOM inside a detached DOMParser document,
 *  where Obsidian's `createEl` helpers are not available. The narrow type
 *  expresses that (a full `Document` is assignable to it); element creation
 *  goes through `createElIn`. */
type DetachedDoc = Pick<Document, "createElement" | "createElementNS">;

function createElIn<K extends keyof HTMLElementTagNameMap>(
  doc: DetachedDoc,
  tag: K,
): HTMLElementTagNameMap[K] {
  return doc.createElement(tag);
}

function svgIcon(doc: DetachedDoc, shapes: IconShape[]): SVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const { tag, attrs } of shapes) {
    const shape = doc.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) {
      shape.setAttribute(name, value);
    }
    svg.appendChild(shape);
  }
  return svg;
}

const COPY_ICON: IconShape[] = [
  {
    tag: "rect",
    attrs: { x: "9", y: "9", width: "12", height: "12", rx: "2" },
  },
  {
    tag: "path",
    attrs: {
      d: "M5 15h-1a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v1",
    },
  },
];
const CHECK_ICON: IconShape[] = [
  { tag: "path", attrs: { d: "M5 12l5 5l10 -10" } },
];

function iconSpan(doc: DetachedDoc, cls: string, icon: IconShape[]): HTMLElement {
  const span = createElIn(doc, "span");
  span.className = cls;
  span.appendChild(svgIcon(doc, icon));
  return span;
}

/** Wraps a serialized `<pre><code>` into the editor's code block chrome:
 *  language label docked top-left, copy button docked top-right. The copy
 *  behavior itself is wired by the inline script emitted by the page
 *  template. */
function wrapCodeBlock(parsed: Document, pre: Element): void {
  const code = pre.querySelector("code");
  if (code == null) return;

  const block = createElIn(parsed, "div");
  block.className = "hljs-codeblock";
  if (code.getAttribute("wrap") === "true") block.classList.add("is-wrapped");

  const controls = createElIn(parsed, "div");
  controls.className = "hljs-codeblock__controls";
  const lang = createElIn(parsed, "span");
  lang.className = "hljs-codeblock__lang";
  lang.textContent = languageLabel(code.getAttribute("class"));
  controls.appendChild(lang);

  const actions = createElIn(parsed, "div");
  actions.className = "hljs-codeblock__actions";
  const copyButton = createElIn(parsed, "button");
  copyButton.setAttribute("type", "button");
  copyButton.className = "hljs-codeblock__btn hljs-codeblock__btn--copy";
  copyButton.title = "Copy code";
  copyButton.setAttribute("aria-label", "Copy code");
  copyButton.appendChild(
    iconSpan(
      parsed,
      "hljs-codeblock__btn-ico hljs-codeblock__btn-ico--copy",
      COPY_ICON,
    ),
  );
  copyButton.appendChild(
    iconSpan(
      parsed,
      "hljs-codeblock__btn-ico hljs-codeblock__btn-ico--check",
      CHECK_ICON,
    ),
  );
  actions.appendChild(copyButton);

  pre.replaceWith(block);
  block.appendChild(pre);
  block.appendChild(controls);
  block.appendChild(actions);
}

export async function postProcessForExport(
  html: string,
  resolveTarget: ResolveImageTarget,
  renderDiagram?: RenderDiagram,
  /** File name for the Nth rendered diagram (1-based seq within this
   *  call). Callers exporting several documents into one images/ folder
   *  thread a shared counter through it; the default names them
   *  diagram-1.svg, diagram-2.svg, … */
  nameDiagram: (seq: number) => string = (seq) => `diagram-${seq}.svg`,
): Promise<PostProcessResult> {
  const parsed = new DOMParser().parseFromString(html, "text/html");

  const images: string[] = [];
  const missing: string[] = [];

  for (const el of Array.from(
    parsed.body.querySelectorAll<HTMLElement>(IMAGE_TAG),
  )) {
    const vaultPath = el.dataset["id"];
    if (vaultPath == null || vaultPath === "") {
      el.remove();
      continue;
    }

    const fileName = resolveTarget(vaultPath);
    if (fileName == null) {
      if (!missing.includes(vaultPath)) missing.push(vaultPath);
      el.remove();
      continue;
    }
    if (!images.includes(vaultPath)) images.push(vaultPath);

    const figure = createElIn(parsed, "figure");
    figure.setAttribute("data-align", el.dataset["align"] ?? "left");
    const style = figureWidthStyle(el.dataset["width"] ?? null);
    if (style !== "") figure.setAttribute("style", style);

    const img = createElIn(parsed, "img");
    img.setAttribute("src", `images/${fileName}`);
    const alt = el.dataset["filename"];
    if (alt) img.setAttribute("alt", alt);
    figure.appendChild(img);

    el.replaceWith(figure);
  }

  let removedAttachments = 0;
  for (const el of Array.from(
    parsed.body.querySelectorAll<HTMLElement>(ATTACHMENT_TAG),
  )) {
    el.remove();
    removedAttachments += 1;
  }

  let droppedDiagrams = 0;
  let diagramSeq = 0;
  const diagrams: ExportDiagramFile[] = [];
  for (const el of Array.from(
    parsed.body.querySelectorAll<HTMLElement>(MERMAID_TAG),
  )) {
    const code = el.dataset["code"] ?? "";
    const svgRoot =
      renderDiagram != null && code !== ""
        ? await renderDiagram(code)
            .then((svg) => (svg == null ? null : parseSvgElement(svg)))
            .catch(() => null)
        : null;
    if (svgRoot == null) {
      el.remove();
      droppedDiagrams += 1;
      continue;
    }
    // Mermaid renders width="100%" with only a max-width cap (its
    // useMaxWidth mode): the editor's host element constrains that, but a
    // file-referencing <img> gets no intrinsic size from a percentage and
    // stretches the diagram over the whole column. Pin the natural size
    // from the viewBox so the file behaves like any image.
    const [, , viewBoxW, viewBoxH] = (svgRoot.getAttribute("viewBox") ?? "")
      .split(/[\s,]+/)
      .map(Number);
    if (
      Number.isFinite(viewBoxW) &&
      viewBoxW > 0 &&
      Number.isFinite(viewBoxH) &&
      viewBoxH > 0
    ) {
      svgRoot.setAttribute("width", String(viewBoxW));
      svgRoot.setAttribute("height", String(viewBoxH));
    }
    // The diagram ships as an SVG file next to the page images, not as
    // inline markup: the page stays lean and the figure behaves like any
    // other image (caching, natural sizing via the SVG's own dimensions).
    diagramSeq += 1;
    const name = nameDiagram(diagramSeq);
    diagrams.push({
      name,
      svg: new XMLSerializer().serializeToString(svgRoot),
    });

    const figure = createElIn(parsed, "figure");
    figure.className = "mermaid-figure";
    const align = el.dataset["align"];
    if (align && align !== "left") figure.setAttribute("data-align", align);
    const img = createElIn(parsed, "img");
    img.setAttribute("src", `images/${name}`);
    img.setAttribute("alt", "Diagram");
    figure.appendChild(img);
    el.replaceWith(figure);
  }

  for (const pre of Array.from(parsed.body.querySelectorAll("pre"))) {
    wrapCodeBlock(parsed, pre);
  }

  replaceWikiLinks(parsed);
  stripWikiPaths(parsed);

  // A published page is read-only: nobody can tick a checkbox.
  for (const input of Array.from(
    parsed.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  )) {
    input.setAttribute("disabled", "");
  }

  return {
    html: parsed.body.innerHTML,
    images,
    missing,
    removedAttachments,
    droppedDiagrams,
    diagrams,
  };
}


/** `[[target|label]]` / `[[target]]` in plain text — the inline wikilink
 *  syntax (see texto/extensions/wikilink). On the site the link renders as
 *  the highlighted label and is NOT clickable (owner decision, issue
 *  wikilinks ОВ-2); code blocks keep the raw syntax. */
const WIKI_TEXT_RE = /\[\[([^\][|]+?)(?:\|([^\][|]*))?\]\]/g;

/** Committed wikilinks (the wikiLink mark) render as
 *  `<span class="texto-wikilink" data-wiki-path="…">` — the vault path must
 *  not leak into the public HTML, so the attribute is dropped; the label
 *  keeps the highlighted, non-clickable rendering (ОВ-2). */
function stripWikiPaths(parsed: Document): void {
  for (const el of Array.from(
    parsed.body.querySelectorAll<HTMLElement>(".texto-wikilink"),
  )) {
    el.removeAttribute("data-wiki-path");
  }
  // The edit-time icon is a mark-view element and never passes through
  // renderHTML — removed here defensively should serialization change.
  for (const el of Array.from(
    parsed.body.querySelectorAll<HTMLElement>(".texto-wikilink-icon"),
  )) {
    el.remove();
  }
}

function replaceWikiLinks(parsed: Document): void {
  const walker = parsed.createTreeWalker(parsed.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current != null) {
    const parent = (current as Text).parentElement;
    const inCode = parent?.closest("pre, code") != null;
    if (!inCode && (current as Text).data.includes("[[")) {
      textNodes.push(current as Text);
    }
    current = walker.nextNode();
  }
  for (const node of textNodes) {
    const text = node.data;
    // Insert the replacement parts directly (no DocumentFragment: the
    // detached parser document has no Obsidian create helper for one).
    const parent = node.parentElement;
    if (parent == null) return;
    const insertBefore = (n: Node): Node => parent.insertBefore(n, node);
    let cursor = 0;
    WIKI_TEXT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKI_TEXT_RE.exec(text)) !== null) {
      if (match.index > cursor) {
        insertBefore(parsed.createTextNode(text.slice(cursor, match.index)));
      }
      const span = createElIn(parsed, "span");
      span.className = "texto-wikilink";
      // A label exists («[[target|label]]») — render it; otherwise the
      // target itself is the visible text.
      // match[1] always participates in the match.
      const label = match[2] != null && match[2] !== "" ? match[2] : match[1];
      span.textContent = label;
      insertBefore(span);
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) {
      insertBefore(parsed.createTextNode(text.slice(cursor)));
    }
    node.remove();
  }
}
