/**
 * Minimal implementations of Obsidian's global DOM helpers for jsdom tests.
 * Only used by vitest — the real helpers exist at runtime inside Obsidian.
 */

type DomAttrs = {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
  append?: HTMLElement | HTMLElement[];
};

function applyAttrs(el: HTMLElement, attrs?: DomAttrs | string): HTMLElement {
  if (typeof attrs === 'string') {
    el.textContent = attrs;
    return el;
  }
  if (!attrs) {
    return el;
  }
  if (attrs.cls) {
    el.className = attrs.cls;
  }
  if (attrs.text != null) {
    el.textContent = attrs.text;
  }
  if (attrs.attr) {
    for (const [key, value] of Object.entries(attrs.attr)) {
      el.setAttribute(key, value);
    }
  }
  if (attrs.append) {
    const children = Array.isArray(attrs.append) ? attrs.append : [attrs.append];
    for (const child of children) {
      el.append(child);
    }
  }
  return el;
}

const g = globalThis as Record<string, unknown>;

g.createEl = (tag: string, attrs?: DomAttrs | string) => applyAttrs(document.createElement(tag), attrs);
g.createDiv = (attrs?: DomAttrs | string) => applyAttrs(document.createElement('div'), attrs);
g.createSpan = (attrs?: DomAttrs | string) => applyAttrs(document.createElement('span'), attrs);
g.createSvg = (tag: string, attrs?: DomAttrs | string) =>
  applyAttrs(document.createElementNS('http://www.w3.org/2000/svg', tag), attrs);
g.createFragment = () => document.createDocumentFragment();
