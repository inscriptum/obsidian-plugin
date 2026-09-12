// Browser harness entry for the drag & drop tests (built with vite,
// see scripts/browser-harness.mts). Provides the Obsidian globals and the
// `obsidian` module shim (Platform only) that src/texto needs at runtime.
import { getExtensions } from '../texto/getExtensions';
import { Editor } from '../texto/core/Editor';
import { headingFoldingKey } from '../texto/extensions/heading/folding';
import { taskFoldingKey } from '../texto/extensions/task-item-folding/taskFoldingPlugin';

// ── Obsidian globals (see src/__mocks__ and vitest.setup.ts) ──
type DomAttrs = {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
};

function applyAttrs(el: HTMLElement, attrs?: DomAttrs | string): HTMLElement {
  if (typeof attrs === 'string') {
    el.textContent = attrs;
    return el;
  }
  if (attrs?.cls) el.className = attrs.cls;
  if (attrs?.text != null) el.textContent = attrs.text;
  if (attrs?.attr) {
    for (const [k, v] of Object.entries(attrs.attr)) el.setAttribute(k, v);
  }
  return el;
}

const g = globalThis as unknown as Record<string, unknown>;
g.createEl = (tag: string, attrs?: DomAttrs | string) =>
  applyAttrs(document.createElement(tag), attrs);
g.createDiv = (attrs?: DomAttrs | string) =>
  applyAttrs(document.createElement('div'), attrs);
g.createSpan = (attrs?: DomAttrs | string) =>
  applyAttrs(document.createElement('span'), attrs);
g.createFragment = () => document.createDocumentFragment();
g.requestAnimationFrame = (cb: FrameRequestCallback) =>
  window.requestAnimationFrame(cb);

// cross-window instanceof (see obsidian.d.ts — used via the DOM lib types)
Object.defineProperty(Object.prototype, 'instanceOf', {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: function instanceOf<T>(type: { new (): T }): boolean {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return this instanceof type;
  },
  writable: true,
  configurable: true,
  enumerable: false,
});

export * from '../texto/getExtensions';
export { Editor, headingFoldingKey, taskFoldingKey };
