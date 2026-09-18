/**
 * Maps the editor's serialization onto plain, self-contained page HTML:
 *  - `<texto-extension-image>` (a vault-file reference) → `<figure><img>`
 *    with a relative `images/<file>` source;
 *  - `<texto-extension-attachment>` → dropped (an attachment is a vault
 *    binary — a published page cannot link into the vault);
 *  - `<pre><code>` (code blocks) → wrapped into `.hljs-codeblock` with the
 *    language label and a copy button, mirroring the editor's controls
 *    (see code-block-hljs/style.css and codeBlockSelectLang.element.tsx);
 *  - task checkboxes → `disabled` (a published page is read-only).
 *
 * The function is a pure DOM transformation; resolving a vault path to an
 * export file name is delegated to the `resolveTarget` callback so the
 * caller owns existence checks and file naming (dedupe happens there too).
 */

import { aliasToLanguage } from "../texto/extensions/code-block-hljs/utils/hljs";

/** Resolves an image node's `data.id` (vault path) to the file name it will
 *  have inside the export's `images/` folder, or null when the source file
 *  is unavailable and the figure must be dropped. */
export type ResolveImageTarget = (vaultPath: string) => string | null;

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
}

const IMAGE_TAG = "texto-extension-image";
const ATTACHMENT_TAG = "texto-extension-attachment";

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
    const name = aliasToLanguage.get(
      cls.slice(LANGUAGE_CLASS_PREFIX.length),
    );
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

function svgIcon(doc: Document, shapes: IconShape[]): SVGElement {
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
  { tag: "rect", attrs: { x: "9", y: "9", width: "12", height: "12", rx: "2" } },
  {
    tag: "path",
    attrs: { d: "M5 15h-1a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v1" },
  },
];
const CHECK_ICON: IconShape[] = [
  { tag: "path", attrs: { d: "M5 12l5 5l10 -10" } },
];

function iconSpan(doc: Document, cls: string, icon: IconShape[]): HTMLElement {
  const span = doc.createElement("span");
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

  const block = parsed.createElement("div");
  block.className = "hljs-codeblock";
  if (code.getAttribute("wrap") === "true") block.classList.add("is-wrapped");

  const controls = parsed.createElement("div");
  controls.className = "hljs-codeblock__controls";
  const lang = parsed.createElement("span");
  lang.className = "hljs-codeblock__lang";
  lang.textContent = languageLabel(code.getAttribute("class"));
  controls.appendChild(lang);

  const actions = parsed.createElement("div");
  actions.className = "hljs-codeblock__actions";
  const copyButton = parsed.createElement("button");
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

export function postProcessForExport(
  html: string,
  resolveTarget: ResolveImageTarget,
): PostProcessResult {
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

    const figure = parsed.createElement("figure");
    figure.setAttribute("data-align", el.dataset["align"] ?? "left");
    const style = figureWidthStyle(el.dataset["width"] ?? null);
    if (style !== "") figure.setAttribute("style", style);

    const img = parsed.createElement("img");
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

  for (const pre of Array.from(parsed.body.querySelectorAll("pre"))) {
    wrapCodeBlock(parsed, pre);
  }

  // A published page is read-only: nobody can tick a checkbox.
  for (const input of Array.from(
    parsed.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  )) {
    input.setAttribute("disabled", "");
  }

  return { html: parsed.body.innerHTML, images, missing, removedAttachments };
}
