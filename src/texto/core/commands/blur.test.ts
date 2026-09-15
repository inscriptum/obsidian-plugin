import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { blur } from "./blur";

type SelectionApi = {
  anchorNode: Node | null;
  removeAllRanges: () => void;
};

function setupSelection(anchorNode: Node | null) {
  const removeAllRanges = vi.fn();
  const selection: SelectionApi = { anchorNode, removeAllRanges };
  vi.stubGlobal("getSelection", () => selection);
  return { removeAllRanges, selection };
}

/** Runs the blur command and flushes its requestAnimationFrame callback. */
function runBlur(viewDom: HTMLElement) {
  const rafCallbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });

  const command = blur();
  const ok = command({
    editor: { isDestroyed: false },
    view: { dom: viewDom },
  } as never);

  for (const cb of rafCallbacks) cb(0);
  return ok;
}

describe("blur command", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears the selection when the caret lives inside this editor", () => {
    const viewDom = createDiv();
    const caret = createSpan();
    viewDom.appendChild(caret);
    document.body.appendChild(viewDom);

    const { removeAllRanges } = setupSelection(caret);
    runBlur(viewDom);

    expect(removeAllRanges).toHaveBeenCalledTimes(1);
  });

  it("does not clear a foreign selection (another pane's caret)", () => {
    const viewDom = createDiv();
    document.body.appendChild(viewDom);
    // Caret anchored in a foreign editor's DOM subtree.
    const foreignEditor = createDiv();
    const foreignCaret = createSpan();
    foreignEditor.appendChild(foreignCaret);
    document.body.appendChild(foreignEditor);

    const { removeAllRanges } = setupSelection(foreignCaret);
    runBlur(viewDom);

    expect(removeAllRanges).not.toHaveBeenCalled();
  });

  it("does not clear anything when the selection is empty", () => {
    const viewDom = createDiv();
    document.body.appendChild(viewDom);

    const { removeAllRanges } = setupSelection(null);
    runBlur(viewDom);

    expect(removeAllRanges).not.toHaveBeenCalled();
  });

  it("does not touch the selection when the editor is destroyed", () => {
    const viewDom = createDiv();
    document.body.appendChild(viewDom);

    const rafCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    const { removeAllRanges } = setupSelection(viewDom);

    const command = blur();
    command({ editor: { isDestroyed: true }, view: { dom: viewDom } } as never);
    for (const cb of rafCallbacks) cb(0);

    expect(removeAllRanges).not.toHaveBeenCalled();
  });
});
