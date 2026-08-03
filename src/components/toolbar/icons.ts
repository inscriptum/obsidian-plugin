/**
 * Tabler outline icons (MIT), inline SVG — same as in the Figma mockup
 * (design/src/lib/icons.ts). Rendered via lit-html svg``,
 * stroke 1.75 @ 16px — as in the mockup.
 */
import { svg } from 'lit-html';
import type { SVGTemplateResult } from 'lit-html';

export type IconFn = (size?: number, stroke?: number) => SVGTemplateResult;

function wrap(size: number, stroke: number, paths: SVGTemplateResult): SVGTemplateResult {
  return svg`<svg xmlns="http://www.w3.org/2000/svg"
    width="${size}" height="${size}" viewBox="0 0 24 24"
    fill="none" stroke="currentColor"
    stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"
  >${paths}</svg>`;
}

const i =
  (paths: SVGTemplateResult): IconFn =>
  (size = 16, stroke = 1.75) =>
    wrap(size, stroke, paths);

export const toolbarIcon = {
  paragraph: i(
    svg`<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/>`,
  ),
  h1: i(
    svg`<path d="M19 18v-8l-2 2"/><path d="M4 6v12"/><path d="M12 6v12"/><path d="M11 18h2"/><path d="M3 18h2"/><path d="M4 12l8 0"/><path d="M3 6h2"/><path d="M11 6h2"/>`,
  ),
  h2: i(
    svg`<path d="M4 6v12"/><path d="M12 6v12"/><path d="M11 18h2"/><path d="M3 18h2"/><path d="M4 12l8 0"/><path d="M3 6h2"/><path d="M11 6h2"/><path d="M17 12a2 2 0 1 1 4 0c0 .591 -.417 1.318 -.816 1.858l-3.184 4.143h4"/>`,
  ),
  h3: i(
    svg`<path d="M4 6v12"/><path d="M12 6v12"/><path d="M11 18h2"/><path d="M3 18h2"/><path d="M4 12l8 0"/><path d="M3 6h2"/><path d="M11 6h2"/><path d="M17 12a2 2 0 1 1 3.998 -.164l-.002 .164a2 2 0 1 1 -3.998 .164l.002 -.164"/>`,
  ),
  blockquote: i(
    svg`<path d="M6 15h15"/><path d="M21 19h-15"/><path d="M15 11h6"/><path d="M21 7h-6"/><path d="M9 9h1a1 1 0 1 1 -1 1v-2.5a2 2 0 0 1 2 -2"/><path d="M3 9h1a1 1 0 1 1 -1 1v-2.5a2 2 0 0 1 2 -2"/>`,
  ),
  taskList: i(
    svg`<path d="M3.5 5.5l1.5 1.5l2.5 -2.5"/><path d="M3.5 11.5l1.5 1.5l2.5 -2.5"/><path d="M3.5 17.5l1.5 1.5l2.5 -2.5"/><path d="M11 6l9 0"/><path d="M11 12l9 0"/><path d="M11 18l9 0"/>`,
  ),
  bulletList: i(
    svg`<path d="M9 6l11 0"/><path d="M9 12l11 0"/><path d="M9 18l11 0"/><path d="M5 6l0 .01"/><path d="M5 12l0 .01"/><path d="M5 18l0 .01"/>`,
  ),
  orderedList: i(
    svg`<path d="M11 6h9"/><path d="M11 12h9"/><path d="M12 18h8"/><path d="M4 16a2 2 0 1 1 4 0c0 .591 -.5 1 -1 1.5l-3 2.5h4"/><path d="M6 10v-6l-2 2"/>`,
  ),
  code: i(
    svg`<path d="M7 8l-4 4l4 4"/><path d="M17 8l4 4l-4 4"/><path d="M14 4l-4 16"/>`,
  ),
  image: i(
    svg`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l6-6 2 2 4-4 6 5"/><circle cx="8.5" cy="9.5" r="1.5"/>`,
  ),
  paperclip: i(
    svg`<path d="M15 7l-6.5 6.5a1.5 1.5 0 0 0 3 3l6.5 -6.5a3 3 0 0 0 -6 -6l-6.5 6.5a4.5 4.5 0 0 0 9 9l6.5 -6.5"/>`,
  ),
  table: i(
    svg`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M10 10v9"/>`,
  ),
};
