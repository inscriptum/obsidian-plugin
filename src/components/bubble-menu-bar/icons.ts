/**
 * Bubble menu icons — same paths as in the prototype
 * docs/design/Bubble-Menu-Prototype/bubble-menu-prototype.html:
 * Tabler outline (MIT) for bold/italic/strike/code/link/blocks,
 * Lucide (MIT) for highlighter and eraser.
 * Outlined, stroke 1.8 @ 16px, currentColor — see specification.
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
  (size = 16, stroke = 1.8) =>
    wrap(size, stroke, paths);

export const bbIcon = {
  bold: i(
    svg`<path d="M7 5h6a3.5 3.5 0 0 1 0 7h-6z"/><path d="M13 12h1a3.5 3.5 0 0 1 0 7h-7v-7"/>`,
  ),
  italic: i(
    svg`<line x1="11" y1="5" x2="17" y2="5"/><line x1="7" y1="19" x2="13" y2="19"/><line x1="14" y1="5" x2="10" y2="19"/>`,
  ),
  underline: i(
    svg`<path d="M7 5v5a5 5 0 0 0 10 0V5"/><path d="M5 19h14"/>`,
  ),
  strike: i(
    svg`<path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M5 12l14 0" /><path d="M16 6.5a4 2 0 0 0 -4 -1.5h-1a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-1.5a4 2 0 0 1 -4 -1.5" />`,
  ),
  code: i(
    svg`<path d="M7 8l-4 4l4 4"/><path d="M17 8l4 4l-4 4"/><path d="M14 4l-4 16"/>`,
  ),
  mark: i(
    svg`<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>`,
  ),
  link: i(
    svg`<path d="M10 14a3.5 3.5 0 0 0 5 0l4 -4a3.5 3.5 0 0 0 -5 -5l-1.5 1.5"/><path d="M14 10a3.5 3.5 0 0 0 -5 0l-4 4a3.5 3.5 0 0 0 5 5l1.5 -1.5"/>`,
  ),
  clear: i(
    svg`<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>`,
  ),
  paragraph: i(
    svg`<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>`,
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
  list: i(
    svg`<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/>`,
  ),
  taskList: i(
    svg`<path d="M3.5 5.5l1.5 1.5l2.5 -2.5"/><path d="M3.5 11.5l1.5 1.5l2.5 -2.5"/><path d="M3.5 17.5l1.5 1.5l2.5 -2.5"/><path d="M11 6l9 0"/><path d="M11 12l9 0"/><path d="M11 18l9 0"/>`,
  ),
  check: i(
    svg`<path d="M5 12l5 5l10 -10"/>`,
  ),
  /* ── Table panel (Tabler outline, same paths as in the prototype) ── */
  rowAbove: i(
    svg`<path d="M4 18v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1z"/><path d="M12 9v-4"/><path d="M9 6l3 -3l3 3"/>`,
  ),
  rowBelow: i(
    svg`<path d="M4 18v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1z"/><path d="M12 9v4"/><path d="M9 16l3 3l3 -3"/>`,
  ),
  colLeft: i(
    svg`<path d="M14 4h-4a1 1 0 0 0 -1 1v14a1 1 0 0 0 1 1h4a1 1 0 0 0 1 -1v-14a1 1 0 0 0 -1 -1z"/><path d="M5 12v-4"/><path d="M2 10l3 -3l3 3"/>`,
  ),
  colRight: i(
    svg`<path d="M14 4h-4a1 1 0 0 0 -1 1v14a1 1 0 0 0 1 1h4a1 1 0 0 0 1 -1v-14a1 1 0 0 0 -1 -1z"/><path d="M19 12v-4"/><path d="M16 10l3 -3l3 3"/>`,
  ),
  merge: i(
    svg`<path d="M4 6h16v12h-16z"/><path d="M12 6v12"/><path d="M12 12h8"/>`,
  ),
  split: i(
    svg`<path d="M4 6h16v12h-16z"/><path d="M12 6v12"/><path d="M4 12h16"/>`,
  ),
  delRow: i(
    svg`<path d="M4 18v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1z"/><path d="M9 12h6"/>`,
  ),
  delCol: i(
    svg`<path d="M4 6v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1 -1v-14a1 1 0 0 0 -1 -1h-14a1 1 0 0 0 -1 1z"/><path d="M12 9v6"/>`,
  ),
  header: i(
    svg`<path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M3 10h18"/>`,
  ),
  delTable: i(
    svg`<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3h6v3"/>`,
  ),
};
