import { litView } from "@web-companions/lit";
import { p } from "@web-companions/gfc";
import { Editor, isTextSelection } from "../../texto/core";
import { CellSelection, isInTable } from "prosemirror-tables";
import { elTag } from "../../tags";
import { getToolbarState, type ToolbarState } from "./toolbarState";
import { iconNodes } from "../icons/icon.svgnode";
import type { IconName } from "../icons/iconSprite";

interface ToolbarButton {
  /** Key in ToolbarState for highlight, or null for action buttons (image/attach/table). */
  activeKey: keyof ToolbarState | null;
  label: string;
  icon: IconName;
  action: (editor: Editor) => void;
}

/**
 * Buttons grouped by Figma layout (design/src/components/obs-toolbar.ts):
 * typography | blocks | insert. A vertical separator is drawn between groups.
 * Icons — Tabler outline, as in the mockup (see icons.ts).
 */
const GROUPS: ToolbarButton[][] = [
  // Group 1 — typography
  [
    {
      activeKey: "paragraph",
      label: "Text",
      icon: "paragraph",
      action: (e) => e.chain().focus().clearNodes().run(),
    },
    {
      activeKey: "heading1",
      label: "Heading 1",
      icon: "h1",
      action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      activeKey: "heading2",
      label: "Heading 2",
      icon: "h2",
      action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      activeKey: "heading3",
      label: "Heading 3",
      icon: "h3",
      action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    },
  ],
  // Group 2 — blocks
  [
    {
      activeKey: "blockquote",
      label: "Quote",
      icon: "blockquote",
      action: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      activeKey: "taskList",
      label: "To-do list",
      icon: "taskList",
      action: (e) => e.chain().focus().toggleTaskList().run(),
    },
    {
      activeKey: "bulletList",
      label: "Bullet list",
      icon: "bulletList",
      action: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      activeKey: "orderedList",
      label: "Numbered list",
      icon: "orderedList",
      action: (e) => e.chain().focus().toggleOrderedList().run(),
    },
    {
      activeKey: "codeBlock",
      label: "Code block",
      icon: "code",
      action: (e) => e.chain().focus().toggleHljsCodeBlock().run(),
    },
  ],
  // Group 3 — insert
  [
    {
      activeKey: null,
      label: "Image",
      icon: "image",
      action: (e) => e.chain().focus().selectImageFile().run(),
    },
    {
      activeKey: null,
      label: "Attach",
      icon: "paperclip",
      action: (e) => e.chain().focus().setAttachment(true).run(),
    },
    {
      activeKey: null,
      label: "Table",
      icon: "table",
      action: (e) => e.chain().focus().insertTable().run(),
    },
  ],
];

function countWords(text: string): number {
  return text.trim() ? text.split(/\s+/).filter(Boolean).length : 0;
}

export const ToolbarElement = litView.element({
  props: {
    editor: p.req<Editor>(),
    /** Mobile only: the (former) text bubble menu bar, shown on text selection. */
    selectionBar: p.opt<HTMLElement>(),
    /** Mobile only: the (former) table bubble menu bar, shown in a table. */
    tableSelectionBar: p.opt<HTMLElement>(),
  },
})(function* (props) {
  let state = getToolbarState(props.editor);
  let wordCount = countWords(props.editor.getText());
  let saved = true;
  let saveTimer: number | null = null;
  let mode: "none" | "text" | "table" = "none";

  // Simulate autosave cycle (AUTOSAVE_DELAY = 500ms in NoteView):
  // on change — "Saving…", after 600ms — "Saved".
  const markDirty = () => {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
    }
    saved = false;
    saveTimer = window.setTimeout(() => {
      saved = true;
      void this.next();
    }, 600);
  };

  const computeMode = (): "none" | "text" | "table" => {
    const { selection } = props.editor.state;
    if (isInTable(props.editor.state)) {
      if (selection.empty || selection instanceof CellSelection) return "table";
    }
    if (!selection.empty && isTextSelection(selection)) return "text";
    return "none";
  };

  const refreshState = () => {
    state = getToolbarState(props.editor);
    wordCount = countWords(props.editor.getText());
    mode = computeMode();
    markDirty();
    void this.next();
  };

  props.editor.on("selectionUpdate", refreshState);
  props.editor.on("update", refreshState);

  mode = computeMode();

  try {
    while (true) {
      const isMobileSwap = !!props.selectionBar;
      props = yield (
        <>
          <div class={`note-toolbar${isMobileSwap && mode !== "none" ? " is-hidden" : ""}`}>
            {GROUPS.map((group, gi) => [
              gi > 0 ? <div class="note-toolbar__sep"></div> : null,
              group.map((btn) => (
                <button
                  class={`note-toolbar__btn${btn.activeKey && state[btn.activeKey] ? " is-active" : ""}`}
                  aria-label={btn.label}
                  title={btn.label}
                  onclick={() => btn.action(props.editor)}
                >
                  <span class="note-toolbar__icon">{iconNodes[btn.icon]({})}</span>
                </button>
              )),
            ])}
            <div class="note-toolbar__spacer"></div>
            <div class="note-toolbar__meta">
              <span class={`note-toolbar__dot${saved ? "" : " is-pending"}`}></span>
              <span>{saved ? "Saved" : "Saving…"}</span>
              <span>·</span>
              <span>{wordCount} w.</span>
            </div>
          </div>
          {isMobileSwap && props.selectionBar ? (
            <div class={`mobile-sel-bar mobile-sel-bar--text${mode === "text" ? " is-active" : ""}`}>
              {props.selectionBar}
            </div>
          ) : null}
          {isMobileSwap && props.tableSelectionBar ? (
            <div class={`mobile-sel-bar mobile-sel-bar--table${mode === "table" ? " is-active" : ""}`}>
              {props.tableSelectionBar}
            </div>
          ) : null}
        </>
      );
    }
  } finally {
    props.editor.off("selectionUpdate", refreshState);
    props.editor.off("update", refreshState);
    if (saveTimer) {
      window.clearTimeout(saveTimer);
    }
  }
})(elTag("note-toolbar"));
