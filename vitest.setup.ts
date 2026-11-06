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
  if (typeof attrs === "string") {
    // Obsidian semantics: the string form is the CLASS shorthand
    // (createDiv("cls") — same as { cls: "cls" }).
    el.className = attrs;
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
    const children = Array.isArray(attrs.append)
      ? attrs.append
      : [attrs.append];
    for (const child of children) {
      el.append(child);
    }
  }
  return el;
}


// jsdom implements no layout: ProseMirror's scrollIntoView resolves
// positions to nodes and asks them for their client rects. Text nodes,
// DOM Ranges and elements all need an answer — a single all-zero rect
// keeps the geometry math happy without a layout engine.
const zeroRect = () => ({
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
});
const ensureRects = (proto: unknown) => {
  const protoRecord = proto as Record<string, unknown>;
  if (typeof protoRecord.getClientRects !== "function") {
    protoRecord.getClientRects = function () {
      return [zeroRect()];
    };
  }
  if (typeof protoRecord.getBoundingClientRect !== "function") {
    protoRecord.getBoundingClientRect = function () {
      return zeroRect();
    };
  }
};
ensureRects(Element.prototype);
ensureRects(Text.prototype);
ensureRects(Range.prototype);

const g = globalThis as Record<string, unknown>;

g.createEl = (tag: string, attrs?: DomAttrs | string) =>
  applyAttrs(document.createElement(tag), attrs);
g.createDiv = (attrs?: DomAttrs | string) =>
  applyAttrs(document.createElement("div"), attrs);
g.createSpan = (attrs?: DomAttrs | string) =>
  applyAttrs(document.createElement("span"), attrs);
g.createSvg = (tag: string, attrs?: DomAttrs | string) =>
  applyAttrs(
    document.createElementNS("http://www.w3.org/2000/svg", tag),
    attrs,
  );
g.createFragment = () => document.createDocumentFragment();

// jsdom has no DataTransfer/ClipboardEvent: the clipboard degradation paths
// (cellClipboard paste branches) are untestable without a minimal shim. The
// shims carry only what production code and the tests use — setData/getData/
// clearData, types, and an init-provided clipboardData on the event.
class DataTransferShim {
  private data = new Map<string, string>();
  setData(type: string, value: string): void {
    this.data.set(type, value);
  }
  getData(type: string): string {
    return this.data.get(type) ?? "";
  }
  clearData(): void {
    this.data.clear();
  }
  get types(): string[] {
    return [...this.data.keys()];
  }
  // the editor's image paste handler reads both on every paste event
  files: readonly unknown[] = [];
  items: readonly unknown[] = [];
}
class ClipboardEventShim extends Event {
  clipboardData: DataTransferShim;
  constructor(
    type: string,
    init?: EventInit & { clipboardData?: DataTransferShim },
  ) {
    super(type, init);
    this.clipboardData = init?.clipboardData ?? new DataTransferShim();
  }
}
g.DataTransfer = DataTransferShim;
g.ClipboardEvent = ClipboardEventShim;
