import { describe, expect, it, afterEach, vi } from "vitest";
import { NotepadView } from "../NotepadView";

/**
 * focusStartPage without mounting the view: the method only touches
 * this.notepad and this.sections, so it runs against a prototype-derived
 * fake (same pattern as lockGateWiring.test.ts). Fake timers drive the
 * 50ms editor-poll ticks.
 */

type EditorStub = {
  isDestroyed: boolean;
  view: { focus: ReturnType<typeof vi.fn> };
};
type SectionStub = { editor: EditorStub | null };
type NotepadStub = {
  notes(): Array<{ id: string; order: number; path: string }>;
};

function fakeView(
  notepad: NotepadStub | null,
  sections: Map<string, SectionStub>,
): NotepadView {
  const view = Object.create(NotepadView.prototype) as NotepadView & {
    notepad: NotepadStub | null;
    sections: Map<string, SectionStub>;
  };
  return Object.assign(view, { notepad, sections });
}

describe("NotepadView.focusStartPage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("focuses the editor as soon as it appears (second tick)", async () => {
    vi.useFakeTimers();
    const focus = vi.fn();
    const editor: EditorStub = { isDestroyed: false, view: { focus } };
    const handle: SectionStub = { editor: null };
    const view = fakeView(
      { notes: () => [{ id: "n1", order: 0, path: "0.md" }] },
      new Map([["n1", handle]]),
    );
    // the quick-create path opens the file before the editor mounts: the
    // first poll misses, the editor appears, the next tick finds it
    const pending = view.focusStartPage();
    handle.editor = editor;
    await vi.advanceTimersByTimeAsync(50);
    await pending;
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("returns immediately when there is no notepad", async () => {
    const focus = vi.fn();
    const view = fakeView(null, new Map());
    await view.focusStartPage();
    expect(focus).not.toHaveBeenCalled();
  });

  it("aborts without focusing when the notepad changes while waiting", async () => {
    vi.useFakeTimers();
    const focus = vi.fn();
    const notepadA: NotepadStub = {
      notes: () => [{ id: "n1", order: 0, path: "0.md" }],
    };
    const notepadB: NotepadStub = { notes: () => [] };
    const view = fakeView(notepadA, new Map([["n1", { editor: null }]]));
    const pending = view.focusStartPage();
    await vi.advanceTimersByTimeAsync(50); // first tick: editor still missing
    // the view reloaded (or closed) mid-wait — notepad is private on the
    // view, the fake swaps it through the structural shape
    (view as unknown as { notepad: NotepadStub | null }).notepad = notepadB;
    await vi.advanceTimersByTimeAsync(50); // second tick sees the swap
    await pending;
    expect(focus).not.toHaveBeenCalled();
  });
});
