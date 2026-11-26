import { describe, it, expect, beforeAll, vi } from "vitest";
import NotesPlugin from "../src/main";

/**
 * Structural test for NotesPlugin.ensureFileExplorerButton — pure DOM
 * logic (querySelector + createDiv + insertBefore) against a file-explorer
 * nav-bar sketch. The method only touches two this-members (the create
 * callbacks, inside the click listeners), so a fake this with spies is
 * enough; setIcon comes from the obsidian test mock.
 */

beforeAll(() => {
  // Obsidian patches createDiv onto HTMLElement (object form: cls + attr);
  // jsdom has none.
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["createDiv"] ??= function (
    this: HTMLElement,
    attrs?: string | { cls?: string; attr?: Record<string, string> },
  ) {
    const el = document.createElement("div");
    if (typeof attrs === "string") {
      el.className = attrs;
    } else if (attrs != null) {
      if (attrs.cls) el.className = attrs.cls;
      if (attrs.attr) {
        for (const [key, value] of Object.entries(attrs.attr)) {
          el.setAttribute(key, value);
        }
      }
    }
    this.appendChild(el);
    return el;
  };
});

interface FakePluginThis {
  createQuickNotepad: () => unknown;
  createNewNote: () => unknown;
}

const ensureFileExplorerButton = (
  NotesPlugin.prototype as unknown as {
    ensureFileExplorerButton: (this: FakePluginThis) => void;
  }
).ensureFileExplorerButton;

function buildExplorer(): HTMLElement {
  document.body.innerHTML = "";
  const leaf = document.createElement("div");
  leaf.className = "workspace-leaf-content";
  leaf.dataset["type"] = "file-explorer";
  const container = document.createElement("div");
  container.className = "nav-buttons-container";
  const native = document.createElement("div");
  native.className = "clickable-icon nav-action-button";
  native.setAttribute("aria-label", "New note");
  container.appendChild(native);
  leaf.appendChild(container);
  document.body.appendChild(leaf);
  return container;
}

function labelsOf(container: HTMLElement): string[] {
  return Array.from(container.children).map(
    (el) => el.getAttribute("aria-label") ?? "",
  );
}

describe("NotesPlugin.ensureFileExplorerButton", () => {
  it("injects um + inscriptum buttons right after the first native button", () => {
    const container = buildExplorer();
    const createQuickNotepad = vi.fn();
    const createNewNote = vi.fn();

    ensureFileExplorerButton.call({ createQuickNotepad, createNewNote });

    expect(labelsOf(container)).toEqual([
      "New note",
      "New um",
      "New inscriptum",
    ]);
    const um = container.querySelector<HTMLElement>(".inscriptum-nav-new-um");
    expect(um).not.toBeNull();
    expect(um!.getAttribute("type")).toBe("button");
    const note = container.querySelector<HTMLElement>(
      ".inscriptum-nav-new-note",
    );
    expect(note).not.toBeNull();
    expect(note!.getAttribute("type")).toBe("button");
    // the injected buttons never match the native-only selector
    const nativeOnly = container.querySelector<HTMLElement>(
      ".nav-action-button:not(.inscriptum-nav-new-um):not(.inscriptum-nav-new-note)",
    );
    expect(nativeOnly!.getAttribute("aria-label")).toBe("New note");
  });

  it("is idempotent — a second call injects nothing", () => {
    const container = buildExplorer();
    const callbacks = { createQuickNotepad: vi.fn(), createNewNote: vi.fn() };

    ensureFileExplorerButton.call(callbacks);
    ensureFileExplorerButton.call(callbacks);

    expect(labelsOf(container)).toEqual([
      "New note",
      "New um",
      "New inscriptum",
    ]);
  });

  it("re-orders misplaced buttons instead of duplicating them", () => {
    const container = buildExplorer();
    const callbacks = { createQuickNotepad: vi.fn(), createNewNote: vi.fn() };
    ensureFileExplorerButton.call(callbacks);

    // Obsidian rebuilt the nav bar order (or a theme moved ours): um sits
    // before the native button. A re-run must repair the order.
    const um = container.querySelector<HTMLElement>(".inscriptum-nav-new-um")!;
    container.insertBefore(um, container.firstChild);
    expect(labelsOf(container)).toEqual(["New um", "New note", "New inscriptum"]);

    ensureFileExplorerButton.call(callbacks);

    expect(container.children).toHaveLength(3);
    expect(labelsOf(container)).toEqual([
      "New note",
      "New um",
      "New inscriptum",
    ]);
  });

  it("wires the button clicks to the plugin callbacks", () => {
    const container = buildExplorer();
    const createQuickNotepad = vi.fn();
    const createNewNote = vi.fn();

    ensureFileExplorerButton.call({ createQuickNotepad, createNewNote });

    container
      .querySelector<HTMLElement>(".inscriptum-nav-new-um")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container
      .querySelector<HTMLElement>(".inscriptum-nav-new-note")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(createQuickNotepad).toHaveBeenCalledTimes(1);
    expect(createNewNote).toHaveBeenCalledTimes(1);
  });
});
