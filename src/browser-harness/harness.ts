// Browser harness entry for the drag & drop tests (built with vite,
// see scripts/build-harness.mjs). Provides the Obsidian globals and the
// `obsidian` module shim (Platform only) that src/texto needs at runtime.
import type { JSONContent } from "../texto/core/@types";
import { Editor } from "../texto/core/Editor";
import { getExtensions } from "../texto/getExtensions";
import { openImageGallery, type GalleryItem } from "../ui/imageLightbox";
import { headingFoldingKey } from "../texto/extensions/heading/folding";
import { taskFoldingKey } from "../texto/extensions/task-item-folding/taskFoldingPlugin";
import { NotepadView } from "../NotepadView";
import { installIconSprite } from "../components/icons/iconSprite";
import { ToolbarElement } from "../components/toolbar/toolbar.element";
import { UmNotepad } from "../storage/um/umNotepad";
import { exportNotepadAsWebsite } from "../export/exportNotepadWebsite";
import type { UmContainerData, UmNoteDescriptor } from "../storage/um/umTypes";
import type { WorkspaceLeaf } from "obsidian";
import { TFile } from "obsidian";
import {
  UM_FORMAT,
  UM_SCHEMA_PLAIN,
  UM_SCHEMA_TITLE,
  UM_SCHEMA_VERSION_PLAIN,
  UM_SCHEMA_VERSION_TITLE,
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
// The element factory is typed narrowly on purpose: the
// obsidianmd/prefer-create-el rule reports the GLOBAL `document`, the
// `activeDocument` and values typed as `Document` — in a plain browser
// there is no Obsidian runtime to borrow the helpers from, and the
// community review forbids silencing the rule. A handle typed as
// "just the creation methods" is the same escape hatch the export code
// uses for its detached DOMParser document.
type ElementFactory = Pick<
  Document,
  "createElement" | "createElementNS" | "createDocumentFragment"
>;
const factory: ElementFactory = document;
g.createDiv = (attrs?: DomAttrs | string) => {
  const div = factory.createElement("div");
  if (typeof attrs === "string") div.className = attrs;
  else applyAttrs(div, attrs);
  return div;
};
g.createSpan = (attrs?: DomAttrs | string) => {
  const span = factory.createElement("span");
  if (typeof attrs === "string") span.className = attrs;
  else applyAttrs(span, attrs);
  return span;
};
g.createEl = (tag: string, attrs?: DomAttrs | string) =>
  applyAttrs(factory.createElement(tag), attrs);
// Obsidian's createSvg builds an element in the SVG namespace. SVG elements
// have no writable `className` (it is an SVGAnimatedString), so the class
// goes through setAttribute — the note-property sprite icons rely on it.
g.createSvg = (tag: string, attrs?: DomAttrs | string) => {
  const svg = factory.createElementNS("http://www.w3.org/2000/svg", tag);
  if (typeof attrs === "string") svg.textContent = attrs;
  else if (attrs != null) {
    if (attrs.cls) svg.setAttribute("class", attrs.cls);
    if (attrs.text != null) svg.textContent = attrs.text;
    if (attrs.attr) {
      for (const [k, v] of Object.entries(attrs.attr)) svg.setAttribute(k, v);
    }
  }
  return svg;
};
g.createFragment = () => factory.createDocumentFragment();
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
  const list: string[] = Array.isArray(classes)
    ? (classes as string[])
    : [classes as string];
  for (const cls of list) el.classList.add(cls);
});
defineHelper("addClasses", (el, [classes]) => {
  // Obsidian's addClasses takes an ARRAY of class names (addClass takes one).
  for (const cls of classes as string[]) el.classList.add(cls);
});
defineHelper("removeClass", (el, [classes]) => {
  const list: string[] = Array.isArray(classes)
    ? (classes as string[])
    : [classes as string];
  for (const cls of list) el.classList.remove(cls);
});
defineHelper("removeClasses", (el, [classes]) => {
  for (const cls of classes as string[]) el.classList.remove(cls);
});
defineHelper("toggleClass", (el, [classes, value]) => {
  const list: string[] = Array.isArray(classes)
    ? (classes as string[])
    : [classes as string];
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
// The prototype helpers below ARE Obsidian's createEl/createDiv/createSpan —
// they build the element they hand back, so they go through the same narrow
// factory handle as the global shim above.
defineHelper("createDiv", (el, [cls]) => {
  const div = factory.createElement("div");
  // Obsidian semantics: createDiv("name") sets the CLASS, createDiv({...})
  // applies the info object (a bare string is never the text here).
  if (typeof cls === "string") div.className = cls;
  else applyAttrs(div, cls as DomAttrs | undefined);
  el.appendChild(div);
  return div;
});
defineHelper("createSpan", (el, [cls]) => {
  const span = factory.createElement("span");
  if (typeof cls === "string") span.className = cls;
  else applyAttrs(span, cls as DomAttrs | undefined);
  el.appendChild(span);
  return span;
});
defineHelper("createEl", (el, [tag, attrs]) => {
  const out = factory.createElement(String(tag));
  applyAttrs(out, attrs as DomAttrs | string | undefined);
  el.appendChild(out);
  return out;
});
/* eslint-enable obsidianmd/prefer-create-el -- end of the prototype-helper block (the rule stays disabled only while the shim's own helpers are defined) */
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
  /** Mount an editor plus its note-toolbar. Mobile mode by default (a fake
   *  selectionBar is passed, so the toolbar renders the mobile row with the
   *  undo/redo buttons); opts.mobile=false mounts the desktop branch —
   *  for toolbar interaction tests. */
  mountToolbar: (doc: unknown, opts?: { mobile?: boolean }) => string;
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
  /** Open the picture viewer directly (image nodes have no vault in the
   *  harness, so the gallery items are provided by the test). */
  openGallery: (items: unknown[], index: number) => void;
}

let currentEditor: Editor | null = null;
let lastError: unknown = null;

function appContainer(): HTMLElement {
  const existing = document.getElementById("app");
  if (existing != null) {
    return existing;
  }
  const app = createDiv();
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
  const note = createDiv("note");
  const article = createEl("article", { cls: "texto-editor" });
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
  mountToolbar: (doc: unknown, opts?: { mobile?: boolean }): string => {
    const mobile = opts?.mobile ?? true;
    mountEditor(doc);
    installIconSprite();
    const editor = currentEditor;
    if (editor == null) return "editor";
    const toolbar = new ToolbarElement();
    toolbar.addClass("note-toolbar-host");
    toolbar.props.editor = editor;
    // A fake selection bar switches the toolbar into its mobile branch —
    // the only place the undo/redo buttons render (mobile-only feature).
    if (mobile) toolbar.props.selectionBar = createDiv("fake-selection-bar");
    appContainer().appendChild(toolbar);
    return mobile ? "editor+toolbar(mobile)" : "editor+toolbar(desktop)";
  },
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
  openGallery: (items: unknown[], index: number) => {
    openImageGallery(items as GalleryItem[], index);
  },
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
      schemaVersion: UM_SCHEMA_VERSION_TITLE,
      expanded: opts?.titleExpanded ?? true,
    },
  ];
  notes.set("title-page", {
    type: "noteDoc",
    content: opts?.titleDoc ?? [
      {
        type: "noteTitle",
        content: [{ type: "text", text: "Notepad title" }],
      },
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
      schemaVersion: UM_SCHEMA_VERSION_PLAIN,
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
  // NotepadView guards the open file with `instanceof TFile` (the community
  // review forbids TFile casts) — the harness must hand it a real TFile
  // instance, not a plain object, or the guard rejects it and the editors
  // never mount. The fields are set explicitly: the harness shim's TFile
  // takes no constructor argument.
  const harnessFile = new TFile();
  harnessFile.path = "e2e/harness.um";
  harnessFile.name = "harness.um";
  harnessFile.basename = "harness";
  harnessFile.parent = null;
  // renderCollapsedTitle falls back to the container mtime for pages
  // without a modifiedAt stamp (um-page-updated-at) — TFile always has it.
  harnessFile.stat = { mtime: 1790000000000, ctime: 1790000000000, size: 1 };
  v.file = harnessFile;
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

// ── Export E2E API (window.__e2eExport) ──────────────────────────────────
// Runs the real notepad export pipeline (asset resolver → generateHTML →
// postProcess → page template → adapter writes) in this browser — the only
// place where the mermaid engine actually compiles a diagram (jsdom unit
// tests stub the render callback). Files captured by the fake adapter come
// back keyed by vault path, base64 (text is utf-8 encoded first, so the
// payload stays JSON-safe).

interface ExportUmWebsiteSpec {
  title: string;
  summary?: string;
  /** Page bodies after the title page (schema plain). */
  pages: JSONContent[];
  /** Packed assets; image nodes reference them by `asset:<index>` in
   *  attrs.data.id — rewritten to the generated ULIDs before export. */
  assets?: Array<{ bytesB64: string; filename: string; mime?: string }>;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function toB64(data: string | ArrayBuffer): string {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : new Uint8Array(data);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1)
    bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Rewrites `asset:<index>` references onto the real generated asset ids. */
function remapAssetRefs(node: JSONContent, assetIds: string[]): JSONContent {
  const next: JSONContent = { ...node };
  const data = node.attrs?.data as { id?: unknown } | undefined;
  if (typeof data?.id === "string" && data.id.startsWith("asset:")) {
    next.attrs = {
      ...node.attrs,
      data: { ...data, id: assetIds[Number(data.id.slice(6))] },
    };
  }
  if (Array.isArray(node.content)) {
    next.content = node.content.map((child) => remapAssetRefs(child, assetIds));
  }
  return next;
}

async function exportUmWebsite(spec: ExportUmWebsiteSpec): Promise<{
  folder: string;
  result: {
    missingImages: string[];
    removedAttachments: number;
    droppedDiagrams: number;
    skippedPages: number;
  };
  files: Record<string, string>;
}> {
  const notepad = UmNotepad.empty();
  const titleDescriptor = notepad.addNote(undefined, spec.title);
  notepad.setNoteContent(titleDescriptor.id, {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [{ type: "text", text: spec.title }] },
      {
        type: "noteProperty",
        attrs: { type: "text" },
        content: [
          {
            type: "notePropertyName",
            content: [{ type: "text", text: "description" }],
          },
          {
            type: "notePropertyValue",
            content: spec.summary ? [{ type: "text", text: spec.summary }] : [],
          },
        ],
      },
      { type: "paragraph" },
    ],
  });

  const assetIds: string[] = [];
  for (const asset of spec.assets ?? []) {
    const descriptor = notepad.addAsset(
      b64ToBytes(asset.bytesB64),
      asset.filename,
      asset.mime,
    );
    assetIds.push(descriptor.id);
  }

  let prevId = titleDescriptor.id;
  spec.pages.forEach((body, index) => {
    const descriptor = notepad.addNote(prevId, `Page ${index + 1}`);
    notepad.setNoteContent(descriptor.id, remapAssetRefs(body, assetIds));
    prevId = descriptor.id;
  });

  const files = new Map<string, string | ArrayBuffer>();
  const app = {
    vault: {
      createFolder: async () => {},
      adapter: {
        write: async (path: string, data: string) => {
          files.set(path, data);
        },
        writeBinary: async (path: string, data: ArrayBuffer) => {
          files.set(path, data);
        },
      },
    },
  };
  const file = {
    path: "e2e/export-target.um",
    name: "export-target.um",
    basename: "export-target",
    stat: { ctime: 1700000000000, mtime: 1700000001000, size: 1 },
  };
  const result = await exportNotepadAsWebsite(
    app as never,
    file as never,
    notepad,
    "export",
  );

  const outFiles: Record<string, string> = {};
  for (const [filePath, data] of files) {
    outFiles[filePath] = toB64(data);
  }
  return {
    folder: result.folder,
    result: {
      missingImages: result.missingImages,
      removedAttachments: result.removedAttachments,
      droppedDiagrams: result.droppedDiagrams,
      skippedPages: result.skippedPages,
    },
    files: outFiles,
  };
}

g.__e2eExport = { exportUmWebsite };
