/**
 * Shared inline-SVG sprite, injected ONCE into <body> at plugin init
 * (see installIconSprite(), called from main.ts).
 *
 * Every toolbar/bubble icon then renders a tiny <svg><use> that references a
 * <symbol> defined here — so the path data lives in exactly one place and is
 * not duplicated per button / per render.
 *
 * This works because litView renders components into the LIGHT DOM (its
 * container is the element itself, not a shadow root — see
 * @web-companions/gfc/lib/EG.js: `this.container = this`), so <use> can
 * resolve the symbols defined on document.body.
 *
 * Icon IDs:
 *   base  → #inscriptum-ico-<name>
 *   toolbar  → #inscriptum-tlb-<name>
 *   bubble   → #inscriptum-bb-<name>
 */

const SPRITE_ID = "inscriptum-icon-sprite";

const ICON_PATHS: Record<string, string> = {
  file: `<path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2" />`,
  fileUnknown: `<path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2" /><path d="M12 17v.01" /><path d="M12 14a1.5 1.5 0 1 0 -1.14 -2.474" />`,
};

/** Raw Tabler-outline path markup (MIT), 24×24 viewBox, as in the Figma/HTML mocks. */
const TOOLBAR_ICON_PATHS = {
  paragraph: `<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/>`,
  h1: `<path d="M19 18v-8l-2 2"/><path d="M4 6v12"/><path d="M12 6v12"/><path d="M11 18h2"/><path d="M3 18h2"/><path d="M4 12l8 0"/><path d="M3 6h2"/><path d="M11 6h2"/>`,
  h2: `<path d="M4 6v12"/><path d="M12 6v12"/><path d="M11 18h2"/><path d="M3 18h2"/><path d="M4 12l8 0"/><path d="M3 6h2"/><path d="M11 6h2"/><path d="M17 12a2 2 0 1 1 4 0c0 .591 -.417 1.318 -.816 1.858l-3.184 4.143h4"/>`,
  h3: `<path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M19 14a2 2 0 1 0 -2 -2" /><path d="M17 16a2 2 0 1 0 2 -2" /><path d="M4 6v12" /><path d="M12 6v12" /><path d="M11 18h2" /><path d="M3 18h2" /><path d="M4 12h8" /><path d="M3 6h2" /><path d="M11 6h2" />`,
  blockquote: `<path d="M6 15h15"/><path d="M21 19h-15"/><path d="M15 11h6"/><path d="M21 7h-6"/><path d="M9 9h1a1 1 0 1 1 -1 1v-2.5a2 2 0 0 1 2 -2"/><path d="M3 9h1a1 1 0 1 1 -1 1v-2.5a2 2 0 0 1 2 -2"/>`,
  taskList: `<path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M13 5h8" /><path d="M13 9h5" /><path d="M13 15h8" /><path d="M13 19h5" /><path d="M3 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" /><path d="M3 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" />`,
  bulletList: `<path d="M9 6l11 0"/><path d="M9 12l11 0"/><path d="M9 18l11 0"/><path d="M5 6l0 .01"/><path d="M5 12l0 .01"/><path d="M5 18l0 .01"/>`,
  orderedList: `<path d="M11 6h9"/><path d="M11 12h9"/><path d="M12 18h8"/><path d="M4 16a2 2 0 1 1 4 0c0 .591 -.5 1 -1 1.5l-3 2.5h4"/><path d="M6 10v-6l-2 2"/>`,
  code: `<path d="M7 8l-4 4l4 4"/><path d="M17 8l4 4l-4 4"/><path d="M14 4l-4 16"/>`,
  image: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l6-6 2 2 4-4 6 5"/><circle cx="8.5" cy="9.5" r="1.5"/>`,
  paperclip: `<path d="M15 7l-6.5 6.5a1.5 1.5 0 0 0 3 3l6.5 -6.5a3 3 0 0 0 -6 -6l-6.5 6.5a4.5 4.5 0 0 0 9 9l6.5 -6.5"/>`,
  table: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M10 10v9"/>`,
  link: `<path d="M10 14a3.5 3.5 0 0 0 5 0l4 -4a3.5 3.5 0 0 0 -5 -5l-1.5 1.5"/><path d="M14 10a3.5 3.5 0 0 0 -5 0l-4 4a3.5 3.5 0 0 0 5 5l1.5 -1.5"/>`,
  check: `<path d="M5 12l5 5l10 -10"/>`,
  trash: `<path d="M4 7l16 0"/><path d="M10 11l0 6"/><path d="M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3h6v3"/>`,
  copy: `<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15h-1a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v1"/>`,
  wrap: `<path d="M3 6h18"/><path d="M3 12h14a3 3 0 1 1 0 6h-4"/><path d="m15 16l-2 2l2 2"/><path d="M3 18h6"/>`,
  keyboardHide: `<path d="M6 9l6 6l6 -6"/>`,
} as const;

/** Bubble-menu icons — paths from the Bubble-Menu-Prototype, Tabler outline
 *  (MIT) for bold/italic/strike/code/link/blocks, Lucide (MIT) for highlighter
 *  and eraser. Outlined, stroke 1.8 @ 24px, currentColor. */
const BUBBLE_ICON_PATHS: Record<string, string> = {
  bold: `<path d="M7 5h6a3.5 3.5 0 0 1 0 7h-6z"/><path d="M13 12h1a3.5 3.5 0 0 1 0 7h-7v-7"/>`,
  italic: `<line x1="11" y1="5" x2="17" y2="5"/><line x1="7" y1="19" x2="13" y2="19"/><line x1="14" y1="5" x2="10" y2="19"/>`,
  underline: `<path d="M7 5v5a5 5 0 0 0 10 0V5"/><path d="M5 19h14"/>`,
  strike: `<path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M5 12l14 0" /><path d="M16 6.5a4 2 0 0 0 -4 -1.5h-1a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-1.5a4 2 0 0 1 -4 -1.5" />`,
  code: `<path d="M7 8l-4 4l4 4"/><path d="M17 8l4 4l-4 4"/><path d="M14 4l-4 16"/>`,
  mark: `<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>`,
  link: `<path d="M10 14a3.5 3.5 0 0 0 5 0l4 -4a3.5 3.5 0 0 0 -5 -5l-1.5 1.5"/><path d="M14 10a3.5 3.5 0 0 0 -5 0l-4 4a3.5 3.5 0 0 0 5 5l1.5 -1.5"/>`,
  clear: `<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>`,
  paragraph: `<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>`,
  h1: TOOLBAR_ICON_PATHS.h1,
  h2: TOOLBAR_ICON_PATHS.h2,
  h3: TOOLBAR_ICON_PATHS.h3,
  blockquote: TOOLBAR_ICON_PATHS.blockquote,
  list: TOOLBAR_ICON_PATHS.bulletList,
  taskList: TOOLBAR_ICON_PATHS.taskList,
  check: `<path d="M5 12l5 5l10 -10"/>`,
  rowAbove: `<path d="M4 18v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1z"/><path d="M12 9v-4"/><path d="M9 6l3 -3l3 3"/>`,
  rowBelow: `<path d="M4 18v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1z"/><path d="M12 9v4"/><path d="M9 16l3 3l3 -3"/>`,
  colLeft: `<path d="M14 4h-4a1 1 0 0 0 -1 1v14a1 1 0 0 0 1 1h4a1 1 0 0 0 1 -1v-14a1 1 0 0 0 -1 -1z"/><path d="M5 12v-4"/><path d="M2 10l3 -3l3 3"/>`,
  colRight: `<path d="M14 4h-4a1 1 0 0 0 -1 1v14a1 1 0 0 0 1 1h4a1 1 0 0 0 1 -1v-14a1 1 0 0 0 -1 -1z"/><path d="M19 12v-4"/><path d="M16 10l3 -3l3 3"/>`,
  merge: `<path d="M4 6h16v12h-16z"/><path d="M12 6v12"/><path d="M12 12h8"/>`,
  split: `<path d="M4 6h16v12h-16z"/><path d="M12 6v12"/><path d="M4 12h16"/>`,
  delRow: `<path d="M4 18v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1z"/><path d="M9 12h6"/>`,
  delCol: `<path d="M4 6v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1 -1v-14a1 1 0 0 0 -1 -1h-14a1 1 0 0 0 -1 1z"/><path d="M12 9v6"/>`,
  header: `<path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M3 10h18"/>`,
  delTable: `<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3h6v3"/>`,
  file: `<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/>`,
  replace: `<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>`,
  trash: `<path d="M4 7l16 0"/><path d="M10 11l0 6"/><path d="M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3h6v3"/>`,
  imgLeft: `<rect x="3" y="5" width="9" height="7" rx="1"/><path d="M15 6.5h6"/><path d="M15 10.5h6"/><path d="M3 17h18"/>`,
  imgCenter: `<rect x="8" y="5" width="8" height="7" rx="1"/><path d="M3 8.5h2.5"/><path d="M18.5 8.5h2.5"/><path d="M3 17h18"/>`,
  imgRight: `<rect x="12" y="5" width="9" height="7" rx="1"/><path d="M3 6.5h6"/><path d="M3 10.5h6"/><path d="M3 17h18"/>`,
  imgFull: `<rect x="3" y="6" width="18" height="9" rx="1"/><path d="M3 19h18"/><path d="M7 10.5h10"/><path d="M9 8.5l-2 2 2 2"/><path d="M15 8.5l2 2-2 2"/>`,
  imgWrapLeft: `<rect x="3" y="4" width="9" height="7" rx="1"/><path d="M15 5.5h6"/><path d="M15 8h6"/><path d="M15 10.5h4"/><path d="M3 15h18"/><path d="M3 19h12"/>`,
  imgWrapRight: `<rect x="12" y="4" width="9" height="7" rx="1"/><path d="M3 5.5h6"/><path d="M3 8h6"/><path d="M5 10.5h4"/><path d="M3 15h18"/><path d="M9 19h12"/>`,
};

export type ToolbarIconName = keyof typeof TOOLBAR_ICON_PATHS;
export type BubbleIconName = keyof typeof BUBBLE_ICON_PATHS;

export const TOOLBAR_ICON_NAMES = Object.keys(
  TOOLBAR_ICON_PATHS,
) as ToolbarIconName[];

export const BUBBLE_ICON_NAMES: BubbleIconName[] =
  Object.keys(BUBBLE_ICON_PATHS);

function symbols(
  paths: Record<string, string>,
  idPrefix: string,
  stroke: number,
): string {
  return Object.entries(paths)
    .map(
      ([name, d]) =>
        `  <symbol id="${idPrefix}-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${d}</symbol>`,
    )
    .join("\n");
}

const spriteSvg = `
<svg id="${SPRITE_ID}" xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">
${symbols(ICON_PATHS, "inscriptum-ico", 1)}
${symbols(TOOLBAR_ICON_PATHS, "inscriptum-tlb", 1.75)}
${symbols(BUBBLE_ICON_PATHS, "inscriptum-bb", 1.8)}
</svg>`;

let installed = false;

/** Inject the shared icon sprite into <body>. Idempotent — safe to call on every load. */
export function installIconSprite(): void {
  if (installed || document.getElementById(SPRITE_ID)) {
    return;
  }
  const spriteEl = new window.DOMParser().parseFromString(
    spriteSvg,
    "image/svg+xml",
  ).documentElement as unknown as SVGElement;
  document.body.insertBefore(spriteEl, document.body.firstChild);
  installed = true;
}
