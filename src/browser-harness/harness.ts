// Browser harness entry for the drag & drop tests (built with vite,
// see scripts/build-harness.mjs). Provides the Obsidian globals and the
// `obsidian` module shim (Platform only) that src/texto needs at runtime.
import type { JSONContent } from "../texto/core/@types";
import { Editor } from "../texto/core/Editor";
import { getExtensions } from "../texto/getExtensions";
import { headingFoldingKey } from "../texto/extensions/heading/folding";
import { taskFoldingKey } from "../texto/extensions/task-item-folding/taskFoldingPlugin";
import { NotepadView } from "../NotepadView";
import { installIconSprite } from "../components/icons/iconSprite";
import { UmNotepad } from "../storage/um/umNotepad";
import type { UmContainerData, UmNoteDescriptor } from "../storage/um/umTypes";
import type { WorkspaceLeaf } from "obsidian";
import {
  UM_FORMAT,
  UM_SCHEMA_PLAIN,
  UM_SCHEMA_TITLE,
  UM_SCHEMA_VERSION,
  UM_TYPE,
  UM_VERSION,
} from "../storage/um/umTypes";

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
// Obsidian semantics: createDiv/createSpan take the CLASS as a bare string
// (or a DomElementInfo object) — a string is never the text content.
// createEl(tag, string) is the text form; createEl(tag, {...}) the info one.
g.createDiv = (attrs?: DomAttrs | string) => {
  const div = document.createElement("div");
  if (typeof attrs === "string") div.className = attrs;
  else applyAttrs(div, attrs);
  return div;
};
g.createSpan = (attrs?: DomAttrs | string) => {
  const span = document.createElement("span");
  if (typeof attrs === "string") span.className = attrs;
  else applyAttrs(span, attrs);
  return span;
};
g.createEl = (tag: string, attrs?: DomAttrs | string) =>
  applyAttrs(document.createElement(tag), attrs);
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
defineHelper("setCssProps", (el, [props]) => {
  // Empty value resets the property (Obsidian semantics) — the NotepadView
  // fold-morph pin and NoteView's keyboard offset rely on that.
  const style = (el as HTMLElement).style;
  for (const [name, value] of Object.entries(props as Record<string, string>)) {
    if (value == null || value === "") style.removeProperty(name);
    else style.setProperty(name, value);
  }
});
defineHelper("empty", (el) => {
  while (el.firstChild) el.removeChild(el.firstChild);
});
defineHelper("createDiv", (el, [cls]) => {
  const div = document.createElement("div");
  // Obsidian semantics: createDiv("name") sets the CLASS, createDiv({...})
  // applies the info object (a bare string is never the text here).
  if (typeof cls === "string") div.className = cls;
  else applyAttrs(div, cls as DomAttrs | undefined);
  el.appendChild(div);
  return div;
});
defineHelper("createSpan", (el, [cls]) => {
  const span = document.createElement("span");
  if (typeof cls === "string") span.className = cls;
  else applyAttrs(span, cls as DomAttrs | undefined);
  el.appendChild(span);
  return span;
});
defineHelper("createEl", (el, [tag, attrs]) => {
  const out = document.createElement(String(tag));
  applyAttrs(out, attrs as DomAttrs | string | undefined);
  el.appendChild(out);
  return out;
});
defineHelper("setText", (el, [text]) => {
  el.textContent = toStr(text);
  return el;
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

// ── Notepad E2E API (window.__e2eNotepad) ───────────────────────────────
// Mounts the real NotepadView (.um notepad) against a fake leaf/app so the
// page-drag geometry (drop line vs. section boxes) runs on real layout.
// Only construct+render is exercised: onOpen's vault wiring (file watchers,
// nav drawer) is deliberately not set up, and the autosave timers land in
// the fake adapter of the obsidian shim (scripts/build-harness.mjs).

export interface NotepadPageSpec {
  /** Stable note id (visible in the DOM order only). */
  id: string;
  /** Plain paragraphs appended to the page body. */
  paragraphs: number;
  /** Page title; defaults to the id. */
  title?: string;
  /** Raw page body; overrides `paragraphs` (used to mount tables etc.). */
  doc?: JSONContent[];
  /** Mount the page expanded (default true — drag geometry needs editors). */
  expanded?: boolean;
}

/** The private fields mountNotepad needs to populate in place of onOpen. */
interface NotepadViewInternals {
  app: unknown;
  file: unknown;
  notepad: UmNotepad | null;
  toolbarHost: HTMLElement | null;
  scrollerEl: HTMLElement | null;
  sectionsEl: HTMLElement | null;
  sections: Map<string, { editor: Editor | null }>;
  render(): void;
}

function noteParagraphs(prefix: string, count: number): JSONContent[] {
  const out: JSONContent[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      type: "paragraph",
      content: [{ type: "text", text: `${prefix} paragraph ${i + 1}` }],
    });
  }
  return out;
}

function mountNotepad(
  pages: NotepadPageSpec[],
  opts?: { titleExpanded?: boolean; titleDoc?: JSONContent[] },
): string {
  const notes = new Map<string, JSONContent>();
  const descriptors: UmNoteDescriptor[] = [
    {
      id: "title-page",
      path: "notes/title-page.json",
      order: 0,
      title: "Notepad title",
      schema: UM_SCHEMA_TITLE,
      schemaVersion: UM_SCHEMA_VERSION,
      expanded: opts?.titleExpanded ?? true,
    },
  ];
  notes.set("title-page", {
    type: "noteDoc",
    content:
      opts?.titleDoc ?? [
        {
          type: "noteTitle",
          content: [{ type: "text", text: "Notepad title" }],
        },
        { type: "noteSummary" },
        { type: "paragraph" },
      ],
  });
  pages.forEach((page, i) => {
    descriptors.push({
      id: page.id,
      path: `notes/${page.id}.json`,
      order: i + 1,
      title: page.title ?? page.id,
      schema: UM_SCHEMA_PLAIN,
      schemaVersion: UM_SCHEMA_VERSION,
      // Open every page so the drag geometry runs against real editors.
      expanded: page.expanded ?? true,
    });
    notes.set(page.id, {
      type: "noteDoc",
      content:
        page.doc ?? noteParagraphs(page.title ?? page.id, page.paragraphs),
    });
  });

  const data: UmContainerData = {
    manifest: {
      format: UM_FORMAT,
      version: UM_VERSION,
      type: UM_TYPE,
      notes: descriptors,
    },
    notes,
    assets: new Map(),
    unknownEntries: new Map(),
  };

  const app = {
    vault: {
      on: () => () => {},
      adapter: {
        async read() {
          return "";
        },
        async readBinary() {
          return new Uint8Array();
        },
        async write() {},
        async writeBinary() {},
        async exists() {
          return false;
        },
        async stat() {
          return null;
        },
        async mkdir() {},
        async rename() {},
        async remove() {},
        getFullPath(p: string) {
          return p;
        },
      },
    },
    workspace: {
      on: () => () => {},
      getActiveViewOfType: () => null,
    },
    loadLocalStorage(key: string) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    saveLocalStorage(key: string, value: unknown) {
      try {
        if (value == null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // storage unavailable — folds just do not persist
      }
    },
  };

  // The real app injects the shared <svg> icon sprite from main.ts; the
  // toolbar/bubble-menu buttons reference it via <use> and render empty
  // without it.
  installIconSprite();
  const view = new NotepadView({} as unknown as WorkspaceLeaf);
  const v = view as unknown as NotepadViewInternals;
  // Obsidian gives a view's contentEl the .view-content class; the harness
  // must mirror it for the .view-content.notepad-view-container rules. The
  // bounding height comes from the harness page's CSS — without it the
  // scroller would grow with the document and never scroll.
  view.contentEl.addClass("view-content");
  view.contentEl.addClass("notepad-view-container");
  v.app = app;
  v.file = {
    path: "e2e/harness.um",
    name: "harness.um",
    basename: "harness",
    parent: null,
    // renderCollapsedTitle falls back to the container mtime for pages
    // without a modifiedAt stamp (um-page-updated-at) — TFile always has it.
    stat: { mtime: 1790000000000, ctime: 1790000000000, size: 1 },
  };
  // Mirror onOpen's DOM skeleton; the nav drawer (buildNavSidebar) stays
  // unbuilt — rebuildNavList null-guards on the missing navListEl.
  v.toolbarHost = view.contentEl.createDiv("notepad-toolbar-host");
  v.scrollerEl = view.contentEl.createDiv("notepad-scroller");
  v.sectionsEl = v.scrollerEl.createDiv("notepad-sections");
  v.notepad = new UmNotepad(data);
  v.render();
  mountedNotepad = v;
  appContainer().replaceChildren(view.contentEl);
  return "notepad";
}

let mountedNotepad: NotepadViewInternals | null = null;
g.__e2eNotepad = {
  mount: mountNotepad,
  /** Live editors of all mounted sections (sections-map order). */
  editors(): Editor[] {
    const out: Editor[] = [];
    mountedNotepad?.sections.forEach((handle) => {
      if (handle.editor != null && !handle.editor.isDestroyed) {
        out.push(handle.editor);
      }
    });
    return out;
  },
};
