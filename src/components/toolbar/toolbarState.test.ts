import { describe, it, expect } from "vitest";
import type { CanCommands } from "../../texto/core/@types";
import type { Editor } from "../../texto/core";
import { getToolbarState } from "./toolbarState";

function makeEditor(
  active: Record<string, boolean>,
  history: { undo?: boolean; redo?: boolean } = {},
): Pick<Editor, "isActive" | "can"> {
  const canCommands = {
    undo: () => history.undo ?? false,
    redo: () => history.redo ?? false,
  } as unknown as CanCommands;
  return {
    // Editor.isActive has two overloads: (name, attributes?) and (attributes).
    // The mock accepts both; only the (name, attributes) form is exercised.
    isActive(
      nameOrAttributes: string | object,
      attributesOrUndefined?: object,
    ) {
      const name = typeof nameOrAttributes === "string" ? nameOrAttributes : "";
      const attrs =
        typeof nameOrAttributes === "string"
          ? attributesOrUndefined
          : nameOrAttributes;
      if (name === "heading")
        return (
          active[
            `heading${(attrs as { level?: number } | undefined)?.level}`
          ] ?? false
        );
      return active[name] ?? false;
    },
    can: () => canCommands,
  };
}

describe("getToolbarState", () => {
  it("all false by default", () => {
    expect(getToolbarState(makeEditor({}))).toEqual({
      paragraph: false,
      heading1: false,
      heading2: false,
      heading3: false,
      blockquote: false,
      taskList: false,
      bulletList: false,
      orderedList: false,
      codeBlock: false,
      link: false,
      canUndo: false,
      canRedo: false,
    });
  });

  it("detects link", () => {
    expect(getToolbarState(makeEditor({ link: true })).link).toBe(true);
  });

  it("detects paragraph", () => {
    expect(getToolbarState(makeEditor({ paragraph: true })).paragraph).toBe(
      true,
    );
  });

  it("detects heading levels separately", () => {
    expect(getToolbarState(makeEditor({ heading1: true })).heading1).toBe(true);
    expect(getToolbarState(makeEditor({ heading1: true })).heading2).toBe(
      false,
    );
    expect(getToolbarState(makeEditor({ heading2: true })).heading2).toBe(true);
    expect(getToolbarState(makeEditor({ heading3: true })).heading3).toBe(true);
    expect(getToolbarState(makeEditor({ heading3: true })).heading2).toBe(
      false,
    );
  });

  it("detects blockquote", () => {
    expect(getToolbarState(makeEditor({ blockquote: true })).blockquote).toBe(
      true,
    );
  });

  it("detects lists and code block", () => {
    const s = getToolbarState(
      makeEditor({
        taskList: true,
        bulletList: false,
        orderedList: true,
        hljsCodeBlock: true,
      }),
    );
    expect(s.taskList).toBe(true);
    expect(s.bulletList).toBe(false);
    expect(s.orderedList).toBe(true);
    expect(s.codeBlock).toBe(true);
  });

  it("mirrors the undo/redo stacks independently", () => {
    const both = getToolbarState(makeEditor({}, { undo: true, redo: true }));
    expect(both.canUndo).toBe(true);
    expect(both.canRedo).toBe(true);

    const undoOnly = getToolbarState(makeEditor({}, { undo: true }));
    expect(undoOnly.canUndo).toBe(true);
    expect(undoOnly.canRedo).toBe(false);

    const redoOnly = getToolbarState(makeEditor({}, { redo: true }));
    expect(redoOnly.canUndo).toBe(false);
    expect(redoOnly.canRedo).toBe(true);
  });
});
