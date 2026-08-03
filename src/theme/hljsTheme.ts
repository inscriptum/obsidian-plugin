import darkCss from 'highlight.js/styles/stackoverflow-dark.css?raw';
import lightCss from 'highlight.js/styles/stackoverflow-light.css?raw';
import { setStyle } from '@web-companions/h';

const STYLE_ID = 'highlight-code-css';

export function setHighlightTheme(isLight: boolean): void {
  setStyle(isLight ? lightCss : darkCss, document.head, STYLE_ID);
}
