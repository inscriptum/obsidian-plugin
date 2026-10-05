import { describe, it, expect, vi, afterEach } from "vitest";
import { Editor } from "../texto/core/Editor";
import type { JSONContent } from "../texto/core/@types";
import { getExtensions } from "../texto/getExtensions";
import { getFoldedHeadingPositions } from "../texto/extensions/heading/folding";
import {
  createFoldPersistence,
  foldStorageKey,
} from "./foldPersistence";

function testContent(): JSONContent {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [{ type: "text", text: "Title" }] },
      { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Section A" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "A one" }] },
      { type: "paragraph", content: [{ type: "text", text: "A two" }] },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Section B" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "B body" }] },
    ],
  };
}

interface Fixture {
  editor: Editor;
  /** Position of the "Section A" heading. */
  headingA: number;
  dispose: () => void;
}

const fixtures: Fixture[] = [];

function buildEditor(content: JSONContent = testContent()): Fixture {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    content,
    extensions: getExtensions({}, { isMobileView: false }),
    autofocus: "start",
  });
  let headingA = -1;
  editor.state.doc.forEach((node, pos) => {
    if (node.type.name === "heading" && headingA === -1) headingA = pos;
  });
  const fixture = {
    editor,
    headingA,
    dispose: () => {
      editor.destroy();
      el.remove();
    },
  };
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.dispose();
});

describe("foldStorageKey", () => {
  it("scopes by kind prefix and scope string", () => {
    expect(foldStorageKey("heading", "docs/book.note")).toBe(
      "inscriptum-note-fold-docs/book.note",
    );
    expect(foldStorageKey("task", "docs/book.um/page-1")).toBe(
      "inscriptum-task-fold-docs/book.um/page-1",
    );
  });
});

describe("createFoldPersistence", () => {
  function mockApp() {
    const saved = new Map<string, unknown>();
    return {
      saved,
      loadLocalStorage: vi.fn((key: string) => saved.get(key) ?? null),
      saveLocalStorage: vi.fn((key: string, value: unknown) => {
        if (value == null) saved.delete(key);
        else saved.set(key, value);
      }),
    };
  }

  it("syncs a page fold to the scoped key and restores it into a fresh editor", () => {
    const app = mockApp();
    const scope = "docs/book.um/01HZPAGE";
    let currentScope: string | null = scope;
    const persistence = createFoldPersistence(app, () => currentScope);

    const first = buildEditor();
    expect(first.editor.commands.foldHeading(first.headingA)).toBe(true);
    persistence.sync(first.editor);

    const key = foldStorageKey("heading", scope);
    expect(app.saveLocalStorage).toHaveBeenCalledWith(key, {
      folds: [first.headingA],
    });
    expect(app.saved.get(key)).toMatchObject({ folds: [first.headingA] });

    // A fresh editor (page re-expanded / file reopened) restores the fold
    // from storage: same position folded again, document untouched.
    const second = buildEditor();
    persistence.restore(second.editor);
    expect(getFoldedHeadingPositions(second.editor.state)).toEqual([
      first.headingA,
    ]);
    expect(second.editor.getJSON()).toEqual(first.editor.getJSON());

    // Unfolding persists the cleared state (the stored value is removed,
    // like Obsidian's foldManager — no empty [] is kept).
    expect(second.editor.commands.unfoldHeading(first.headingA)).toBe(true);
    persistence.sync(second.editor);
    expect(app.saved.has(key)).toBe(false);
  });

  it("skips sync when nothing changed since the last write", () => {
    const app = mockApp();
    const persistence = createFoldPersistence(app, () => "scope");
    const fixture = buildEditor();

    // First sync writes the empty state for both kinds (a clear, like
    // Obsidian's foldManager — no empty [] is kept).
    persistence.sync(fixture.editor);
    expect(app.saveLocalStorage).toHaveBeenCalledTimes(2);

    fixture.editor.commands.foldHeading(fixture.headingA);
    persistence.sync(fixture.editor);
    expect(app.saveLocalStorage).toHaveBeenCalledTimes(3);
    persistence.sync(fixture.editor); // same positions — no redundant write
    expect(app.saveLocalStorage).toHaveBeenCalledTimes(3);
  });

  it("re-resolves the scope live, so a renamed container lands on the new key", () => {
    const app = mockApp();
    let scope: string | null = "old/book.um/page";
    const persistence = createFoldPersistence(app, () => scope);
    const fixture = buildEditor();
    fixture.editor.commands.foldHeading(fixture.headingA);

    persistence.sync(fixture.editor);
    expect(
      app.saved.has(foldStorageKey("heading", "old/book.um/page")),
    ).toBe(true);

    scope = "renamed/book.um/page";
    fixture.editor.commands.unfoldHeading(fixture.headingA);
    persistence.sync(fixture.editor);
    // The clear went to the current scope, the old key is left untouched.
    expect(
      app.saved.has(foldStorageKey("heading", "renamed/book.um/page")),
    ).toBe(false);
    expect(
      app.saved.has(foldStorageKey("heading", "old/book.um/page")),
    ).toBe(true);
  });

  it("restore filters stale positions that no longer point at the node kind", () => {
    const app = mockApp();
    const scope = "docs/book.um/01HZPAGE";
    app.saved.set(foldStorageKey("heading", scope), {
      folds: [999_999, 12.5, Number.NaN, "x"],
    });
    const persistence = createFoldPersistence(app, () => scope);
    const fixture = buildEditor();

    persistence.restore(fixture.editor);
    expect(getFoldedHeadingPositions(fixture.editor.state)).toEqual([]);
  });

  it("no-ops when the scope is unavailable, and does not consume the change", () => {
    const app = mockApp();
    let scope: string | null = null;
    const persistence = createFoldPersistence(app, () => scope);
    const fixture = buildEditor();
    fixture.editor.commands.foldHeading(fixture.headingA);

    persistence.sync(fixture.editor);
    expect(app.saveLocalStorage).not.toHaveBeenCalled();

    // The scope check must not mark the change as saved: once the scope is
    // available (e.g. the file was just assigned to the view), the pending
    // positions reach storage.
    scope = "docs/book.um/01HZPAGE";
    persistence.sync(fixture.editor);
    expect(app.saveLocalStorage).toHaveBeenCalledWith(
      foldStorageKey("heading", scope),
      { folds: [fixture.headingA] },
    );

    persistence.restore(fixture.editor);
    expect(app.loadLocalStorage).toHaveBeenCalled();
  });

  it("never wipes stored folds from an editor whose folding plugin is off (mobile)", () => {
    const app = mockApp();
    const scope = "docs/book.um/01HZPAGE";
    const key = foldStorageKey("heading", scope);
    // A fold saved from a desktop session…
    app.saved.set(key, { folds: [21] });
    const persistence = createFoldPersistence(app, () => scope);

    // …then the page is edited on mobile, where the folding plugins are
    // disabled: the absent plugin state reads as "no folds", and a naive
    // sync would clear the desktop's saved value. It must be a no-op.
    const el = document.createElement("div");
    document.body.appendChild(el);
    let mobileEditor: Editor | null = new Editor({
      element: el,
      content: testContent(),
      extensions: getExtensions({}, { isMobileView: true }),
      autofocus: "start",
    });
    try {
      persistence.sync(mobileEditor);
      expect(app.saved.get(key)).toMatchObject({ folds: [21] });
      expect(app.saveLocalStorage).not.toHaveBeenCalled();
    } finally {
      mobileEditor?.destroy();
      mobileEditor = null;
      el.remove();
    }
  });
});
