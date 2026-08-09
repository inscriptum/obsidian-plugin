import { litView } from "@web-companions/lit";
import { p } from "@web-companions/gfc";
import { Editor } from "../../texto/core";
import { getToolbarState, type ToolbarState } from "./toolbarState";
import { toolbarIcon, type IconFn } from "./icons";

interface ToolbarButton {
  /** Key in ToolbarState for highlight, or null for action buttons (image/attach/table). */
  activeKey: keyof ToolbarState | null;
  label: string;
  ico: IconFn;
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
      ico: toolbarIcon.paragraph,
      action: (e) => e.chain().focus().clearNodes().run(),
    },
    {
      activeKey: "heading1",
      label: "Heading 1",
      ico: toolbarIcon.h1,
      action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      activeKey: "heading2",
      label: "Heading 2",
      ico: toolbarIcon.h2,
      action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      activeKey: "heading3",
      label: "Heading 3",
      ico: toolbarIcon.h3,
      action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    },
  ],
  // Group 2 — blocks
  [
    {
      activeKey: "blockquote",
      label: "Quote",
      ico: toolbarIcon.blockquote,
      action: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      activeKey: "taskList",
      label: "To-do list",
      ico: toolbarIcon.taskList,
      action: (e) => e.chain().focus().toggleTaskList().run(),
    },
    {
      activeKey: "bulletList",
      label: "Bullet list",
      ico: toolbarIcon.bulletList,
      action: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      activeKey: "orderedList",
      label: "Numbered list",
      ico: toolbarIcon.orderedList,
      action: (e) => e.chain().focus().toggleOrderedList().run(),
    },
    {
      activeKey: "codeBlock",
      label: "Code block",
      ico: toolbarIcon.code,
      action: (e) => e.chain().focus().toggleHljsCodeBlock().run(),
    },
  ],
  // Group 3 — insert
  [
    {
      activeKey: null,
      label: "Image",
      ico: toolbarIcon.image,
      action: (e) => e.chain().focus().selectImageFile().run(),
    },
    {
      activeKey: null,
      label: "Attach",
      ico: toolbarIcon.paperclip,
      action: (e) => e.chain().focus().setAttachment(true).run(),
    },
    {
      activeKey: null,
      label: "Table",
      ico: toolbarIcon.table,
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
  },
})(function* (props) {
  let state = getToolbarState(props.editor);
  let wordCount = countWords(props.editor.getText());
  let saved = true;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  // Simulate autosave cycle (AUTOSAVE_DELAY = 500ms in NoteView):
  // on change — "Saving…", after 600ms — "Saved".
  const markDirty = () => {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
    }
    saved = false;
    saveTimer = window.setTimeout(() => {
      saved = true;
      this.next();
    }, 600);
  };

  const refreshState = () => {
    state = getToolbarState(props.editor);
    wordCount = countWords(props.editor.getText());
    markDirty();
    this.next();
  };

  props.editor.on("selectionUpdate", refreshState);
  props.editor.on("update", refreshState);

  try {
    while (true) {
      props = yield (
        <div class="note-toolbar">
          {GROUPS.map((group, gi) => [
            gi > 0 ? <div class="note-toolbar__sep"></div> : null,
            group.map((btn) => (
              <button
                class={`note-toolbar__btn${btn.activeKey && state[btn.activeKey] ? " is-active" : ""}`}
                aria-label={btn.label}
                title={btn.label}
                onclick={() => btn.action(props.editor)}
              >
                {btn.ico()}
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
      );
    }
  } finally {
    props.editor.off("selectionUpdate", refreshState);
    props.editor.off("update", refreshState);
    if (saveTimer) {
      window.clearTimeout(saveTimer);
    }
  }
})("note-toolbar");
