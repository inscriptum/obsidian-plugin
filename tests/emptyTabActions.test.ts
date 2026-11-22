import { describe, it, expect, vi } from "vitest";
import {
  ensureEmptyTabActions,
  removeEmptyTabActions,
  type EmptyTabAction,
} from "../src/ui/emptyTabActions";

/** Obsidian's empty-tab DOM (structure-only sketch, no localized text). */
function emptyLeafContent(): HTMLElement {
  const content = document.createElement("div");
  content.className = "workspace-leaf-content";
  content.setAttribute("data-type", "empty");
  const viewContent = document.createElement("div");
  viewContent.className = "view-content";
  const list = document.createElement("div");
  list.className = "empty-state-action-list";
  const native = document.createElement("div");
  native.className = "text-icon-button tappable mod-pill empty-state-action";
  list.appendChild(native);
  viewContent.appendChild(list);
  content.appendChild(viewContent);
  return content;
}

const actions: EmptyTabAction[] = [
  {
    cls: "inscriptum-empty-new-um",
    label: "New um",
    icon: "test-icon-a",
    onClick: () => {},
  },
  {
    cls: "inscriptum-empty-new-note",
    label: "New inscriptum",
    icon: "test-icon-b",
    onClick: () => {},
  },
];

describe("ensureEmptyTabActions", () => {
  it("appends the actions in order after the native ones", () => {
    const content = emptyLeafContent();
    ensureEmptyTabActions(content, actions);
    const items = [...content.querySelectorAll(".empty-state-action-list > *")];
    expect(items).toHaveLength(3);
    expect(items[1].classList.contains("inscriptum-empty-new-um")).toBe(true);
    expect(items[2].classList.contains("inscriptum-empty-new-note")).toBe(true);
  });

  it("is idempotent: a second ensure adds no duplicates", () => {
    const content = emptyLeafContent();
    ensureEmptyTabActions(content, actions);
    ensureEmptyTabActions(content, actions);
    expect(
      content.querySelectorAll(".inscriptum-empty-new-um"),
    ).toHaveLength(1);
    expect(
      content.querySelectorAll(".inscriptum-empty-new-note"),
    ).toHaveLength(1);
  });

  it("handles several empty tabs independently", () => {
    const a = emptyLeafContent();
    const b = emptyLeafContent();
    const root = document.createElement("div");
    root.append(a, b);
    ensureEmptyTabActions(root, actions);
    expect(
      root.querySelectorAll(".inscriptum-empty-new-um"),
    ).toHaveLength(2);
  });

  it("skips silently when the expected DOM structure is absent", () => {
    const foreign = document.createElement("div");
    foreign.setAttribute("data-type", "file-explorer");
    ensureEmptyTabActions(foreign, actions);
    expect(foreign.querySelectorAll(".inscriptum-empty-action")).toHaveLength(0);
  });

  it("wires the click handler of the injected action", () => {
    const content = emptyLeafContent();
    let clicked = 0;
    ensureEmptyTabActions(content, [
      { ...actions[0], onClick: () => clicked++ },
    ]);
    const btn = content.querySelector<HTMLElement>(".inscriptum-empty-new-um");
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toBe(1);
  });

  it("removeEmptyTabActions clears every injected action", () => {
    const root = document.createElement("div");
    root.append(emptyLeafContent(), emptyLeafContent());
    ensureEmptyTabActions(root, actions);
    removeEmptyTabActions(root);
    expect(root.querySelectorAll(".inscriptum-empty-action")).toHaveLength(0);
    // the native action stays untouched
    expect(root.querySelectorAll(".empty-state-action")).toHaveLength(2);
  });

  describe("keyboard activation", () => {
    function pillWithSpy(): { btn: HTMLElement; onClick: ReturnType<typeof vi.fn> } {
      const content = emptyLeafContent();
      const onClick = vi.fn();
      ensureEmptyTabActions(content, [{ ...actions[0], onClick }]);
      const btn = content.querySelector<HTMLElement>(
        ".inscriptum-empty-new-um",
      );
      expect(btn).not.toBeNull();
      return { btn: btn as HTMLElement, onClick };
    }

    it("Enter activates once and prevents the default", () => {
      const { btn, onClick } = pillWithSpy();
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      btn.dispatchEvent(event);
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it("Space activates once and prevents the default", () => {
      const { btn, onClick } = pillWithSpy();
      const event = new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      });
      btn.dispatchEvent(event);
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it("other keys do not activate", () => {
      const { btn, onClick } = pillWithSpy();
      btn.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(onClick).not.toHaveBeenCalled();
    });
  });
});
