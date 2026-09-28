// Browser harness entry for the drag & drop tests (built with vite,
// see scripts/build-harness.mjs). Provides the Obsidian globals and the
// `obsidian` module shim (Platform only) that src/texto needs at runtime.
import type { JSONContent } from "../texto/core/@types";
import { Editor } from "../texto/core/Editor";
import { getExtensions } from "../texto/getExtensions";
import { headingFoldingKey } from "../texto/extensions/heading/folding";
import { taskFoldingKey } from "../texto/extensions/task-item-folding/taskFoldingPlugin";

// ── Obsidian globals (see src/__mocks__ and vitest.setup.ts) ──
type DomAttrs = {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
};

function applyAttrs(el: HTMLElement, attrs?: DomAttrs | string): HTMLElement {
  if (typeof attrs === "string") {
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

// The globals must exist BEFORE the editor bundle evaluates (module
// top-level code in NodeView etc. reads them), so this is deliberately a
// pre-import side effect of the harness entry — that is its whole purpose.
const g = window as unknown as Record<string, unknown>;
g.createEl = (tag: string, attrs?: DomAttrs | string) =>
  applyAttrs(document.createElement(tag), attrs);
g.createDiv = (attrs?: DomAttrs | string) =>
  applyAttrs(document.createElement("div"), attrs);
g.createSpan = (attrs?: DomAttrs | string) =>
  applyAttrs(document.createElement("span"), attrs);
g.createFragment = () => document.createDocumentFragment();
// NOTE: do NOT assign window.requestAnimationFrame — `g` IS window, and
// overwriting the native function would recurse forever (bundle code calls
// the bare `requestAnimationFrame` global). The native one already IS the
// global the bundle needs.

// Obsidian Element helpers (see obsidian.d.ts — used by node views, e.g.
// core/NodeView addNodeView: element.addClass). Minimal DOM equivalents,
// bound onto Element.prototype like the runtime patch does.
type ElementHelperThis = Element;
type HelperArgs = unknown[];
const defineHelper = (
  name: string,
  fn: (el: ElementHelperThis, args: HelperArgs) => unknown,
): void => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto[name] = function helper(this: ElementHelperThis, ...args: HelperArgs) {
    return fn(this, args);
  };
};
const toStr = (value: unknown): string =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean"
    ? String(value)
    : value == null
      ? ""
      : JSON.stringify(value);
defineHelper("addClass", (el, [classes]) => {
  // Obsidian's addClass accepts a string (ONE class) or an array.
  const list = Array.isArray(classes) ? classes : [classes as string];
  for (const cls of list) el.classList.add(cls);
});
defineHelper("addClasses", (el, [classes]) => {
  for (const list of classes as string[][]) el.classList.add(...list);
});
defineHelper("removeClass", (el, [classes]) => {
  const list = Array.isArray(classes) ? classes : [classes as string];
  for (const cls of list) el.classList.remove(cls);
});
defineHelper("removeClasses", (el, [classes]) => {
  for (const list of classes as string[][]) el.classList.remove(...list);
});
defineHelper("toggleClass", (el, [classes, value]) => {
  const list = Array.isArray(classes) ? classes : [classes as string];
  for (const cls of list) el.classList.toggle(cls, Boolean(value));
});
defineHelper("hasClass", (el, [cls]) => el.classList.contains(cls as string));
defineHelper("setAttr", (el, [name, value]) => {
  if (value == null) el.removeAttribute(name as string);
  else el.setAttribute(name as string, toStr(value));
});
defineHelper("setAttrs", (el, [obj]) => {
  for (const [name, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value == null) el.removeAttribute(name);
    else el.setAttribute(name, toStr(value));
  }
});
defineHelper("getAttr", (el, [name]) => el.getAttribute(name as string));
defineHelper("empty", (el) => {
  while (el.firstChild) el.removeChild(el.firstChild);
});
{
  const proto = Element.prototype as unknown as Record<
    string,
    { get(): unknown; configurable: boolean }
  >;
  Object.defineProperty(proto, "doc", {
    get(this: Element) {
      return this.ownerDocument;
    },
    configurable: true,
  });
  Object.defineProperty(proto, "win", {
    get(this: Element) {
      return this.ownerDocument.defaultView;
    },
    configurable: true,
  });
  Object.defineProperty(proto, "offsetParent", {
    get(this: Element) {
      return this.parentElement;
    },
    configurable: true,
  });
}

export * from "../texto/getExtensions";
export { Editor, headingFoldingKey, taskFoldingKey };

// ── Programmatic E2E API (window.__e2e) ─────────────────────────────────
// Installed at import time and driven by the Playwright suite through the
// committed page tests/e2e/harness/index.html. The manual MCP page
// (.harness/index.html) keeps its own window.__harness — a different
// global, so the two never interfere.

interface E2EApi {
  /** Mount a fresh editor with the given doc JSON (replaces the previous one). */
  mount: (doc: unknown) => string;
  /** The editor mounted last (null before the first mount). */
  readonly editor: Editor | null;
  /** Doc JSON of the current editor. */
  docJson: () => JSONContent | null;
  /** Start positions of the top-level blocks. */
  positions: () => number[];
  /** Folded heading positions (plugin state). */
  headingFolds: () => number[];
  /** Folded task-item positions (plugin state). */
  taskFolds: () => number[];
  /** The last error reported through the editor's onError hook. */
  lastError: () => unknown;
}

let currentEditor: Editor | null = null;
let lastError: unknown = null;

function appContainer(): HTMLElement {
  const existing = document.getElementById("app");
  if (existing != null) {
    return existing;
  }
  const app = document.createElement("div");
  app.id = "app";
  document.body.appendChild(app);
  return app;
}

function mountEditor(doc: unknown): string {
  if (currentEditor != null) {
    currentEditor.destroy();
    currentEditor = null;
  }
  lastError = null;

  const app = appContainer();
  app.replaceChildren();
  const note = document.createElement("div");
  note.className = "note";
  const article = document.createElement("article");
  article.className = "texto-editor";
  note.appendChild(article);
  app.appendChild(note);

  currentEditor = new Editor({
    element: article,
    content: doc as JSONContent,
    extensions: getExtensions({}, {}),
    editable: true,
    onError: (err) => {
      lastError = err;
      window.dispatchEvent(new ErrorEvent("error", { error: err }));
    },
  });
  return "editor";
}

const e2eApi: E2EApi = {
  mount: mountEditor,
  get editor() {
    return currentEditor;
  },
  docJson: () =>
    (currentEditor?.state.doc.toJSON() ?? null) as JSONContent | null,
  positions: () => {
    const out: number[] = [];
    currentEditor?.state.doc.forEach((_, pos) => out.push(pos));
    return out;
  },
  headingFolds: () =>
    currentEditor == null
      ? []
      : Array.from(
          headingFoldingKey.getState(currentEditor.view.state)?.folded ?? [],
        ),
  taskFolds: () =>
    currentEditor == null
      ? []
      : Array.from(
          taskFoldingKey.getState(currentEditor.view.state)?.folded ?? [],
        ),
  lastError: () => lastError,
};

g.__e2e = e2eApi;
