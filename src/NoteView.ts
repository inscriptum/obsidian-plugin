import { FileView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { CellSelection, isInTable } from "prosemirror-tables";
import { Editor, isTextSelection } from "./texto/core";
import { readNote, writeNote } from "./storage/noteStorage";
import { getDesiredFileName } from "./storage/fileNaming";
import {
  saveAttachmentFile,
  deleteAttachmentFile,
} from "./storage/attachments";
import { getExtensions, type ExtensionHooks } from "./texto/getExtensions";
import {
  handleAddImg,
  imageOnSetViewProps,
  type ImageToolContext,
} from "./tools/image";
import type { JSONContent } from "./texto/core/@types";
import "./styles/bubble-menu.css";
import "./components/note/note.element";
import "./components/toolbar/toolbar.element";
import { NoteElement } from "./components/note/note.element";
import { ToolbarElement } from "./components/toolbar/toolbar.element";
import {
  bubbleMenuPlugin,
  type BubbleMenuView,
  type ShouldShowProps,
} from "./texto/extensions/bubble-menu";
import { BubbleMenuBarElement } from "./components/bubble-menu-bar/bubble-menu-bar.element";
import { TableBubbleMenuElement } from "./components/bubble-menu-bar/table-bubble-menu-bar.element";
import { setHighlightTheme } from "./theme/hljsTheme";

export const NOTE_VIEW_TYPE = "note-view";

let saveTimer: number | null = null;
const AUTOSAVE_DELAY = 500;

function isLightTheme(): boolean {
  return document.body.classList.contains("theme-light");
}

setHighlightTheme(isLightTheme());

const themeObserver = new MutationObserver(() => {
  setHighlightTheme(isLightTheme());
});
themeObserver.observe(document.body, {
  attributes: true,
  attributeFilter: ["class"],
});

export class NoteView extends FileView {
  private editor: Editor | null = null;
  private _skipNextReload = true;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return NOTE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Texto Note";
  }

  getIcon(): string {
    return "notebook-pen";
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "note";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("note-view-container");

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", async (leaf) => {
        if (leaf?.view === this) {
          await this.reloadFromDisk();
        }
      }),
    );
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.destroyEditor();
    this.contentEl.empty();

    const content = await readNote(file, this.app.vault);
    const noteEl = new NoteElement();
    noteEl.addClass("texto-editor-host");
    const toolbarEl = new ToolbarElement();
    toolbarEl.addClass("note-toolbar-host");
    const bubbleMenuBarEl = new BubbleMenuBarElement();
    bubbleMenuBarEl.addClass("bubble-menu-bar-host");
    const tableBubbleMenuEl = new TableBubbleMenuElement();

    window.requestAnimationFrame(() => {
      const editorEl = noteEl.props.editorContainerEl?.value;

      if (editorEl != null) {
        const editorRef: { current: Editor | null } = { current: null };
        const ctx: ImageToolContext = { app: this.app, noteFile: file };

        this.editor = new Editor({
          element: editorEl,
          content: content,
          onError: (err) => {
            console.error("Editor creation failed:", err);
          },
          onUpdate: () => {
            this.scheduleSave();
          },
          extensions: getExtensions(
            this.buildExtensionHooks(file, editorRef, ctx),
          ),
          autofocus: "start",
        });

        editorRef.current = this.editor;

        this.editor.on("blur", () => {
          void this.flushSave();
        });

        this._skipNextReload = true;

        noteEl.props.editor = this.editor;

        toolbarEl.props.editor = this.editor;
        bubbleMenuBarEl.props.editor = this.editor;
        tableBubbleMenuEl.props.editor = this.editor;

        // Attach menus to the DOM AFTER setting props.editor: for the required prop,
        // connectedCallback starts the generator only when editor is already set.
        this.contentEl.appendChild(bubbleMenuBarEl);
        this.contentEl.appendChild(tableBubbleMenuEl);

        // ── Text bubble menu ──
        // Show for non-empty text selection OUTSIDE tables.
        // Inside a table — the separate table menu handles it.
        this.editor.registerPlugin(
          bubbleMenuPlugin({
            pluginKey: "bubbleMenu",
            editor: this.editor,
            element: bubbleMenuBarEl,
            shouldShow: function (
              this: BubbleMenuView,
              { editor, state, from, to }: ShouldShowProps,
            ) {
              const selection = state.selection;
              const empty = selection.empty;
              const inTable = isInTable(state);

              const parentElement = this.tippy?.popper ?? this.element;
              const isChildOfMenu = parentElement.contains(
                document.activeElement,
              );
              const hasEditorFocus = editor.view.hasFocus() || isChildOfMenu;

              if (
                !hasEditorFocus ||
                !editor.isEditable ||
                this.isMousePressed
              ) {
                return false;
              }

              // Text menu is shown for selected text,
              // even inside a table (for formatting text in cells)
              if (inTable && !empty && isTextSelection(selection)) {
                return true;
              }

              // CellSelection — shows table menu, hide text menu
              if (selection instanceof CellSelection) {
                return false;
              }

              // Inside a table (caret) — shows table menu
              if (inTable) {
                return false;
              }

              // Normal mode: non-empty text selection
              const isEmptyTextBlock =
                !state.doc.textBetween(from, to).length &&
                isTextSelection(selection);
              if (empty || isEmptyTextBlock) {
                return false;
              }

              return true;
            },
            tippyOptions: {
              placement: "top",
              offset: [0, 8],
              animation: "bubble-pop",
              duration: [160, 120],
            },
          }),
        );

        // ── Table bubble menu ──
        // Always show when inside a table.
        this.editor.registerPlugin(
          bubbleMenuPlugin({
            pluginKey: "tableBubbleMenu",
            editor: this.editor,
            element: tableBubbleMenuEl,
            shouldShow: function (
              this: BubbleMenuView,
              { editor, state }: ShouldShowProps,
            ) {
              const selection = state.selection;
              const parentElement = this.tippy?.popper ?? this.element;
              const isChildOfMenu = parentElement.contains(
                document.activeElement,
              );
              const hasEditorFocus = editor.view.hasFocus() || isChildOfMenu;

              if (
                !hasEditorFocus ||
                !editor.isEditable ||
                this.isMousePressed
              ) {
                return false;
              }

              // Table menu — only for caret or CellSelection.
              // When text is selected in a cell — text menu.
              return (
                isInTable(state) &&
                (selection.empty || selection instanceof CellSelection)
              );
            },
            tippyOptions: {
              placement: "top",
              offset: [0, 8],
              animation: "bubble-pop",
              duration: [160, 120],
            },
          }),
        );

        window.requestAnimationFrame(() => {
          window.setTimeout(() => {
            this.editor?.view?.focus();
            this.contentEl.insertAdjacentElement("afterbegin", toolbarEl);
          }, 100);
        });
      }
    });

    this.contentEl.appendChild(noteEl);
  }

  async onUnloadFile(file: TFile): Promise<void> {
    await this.flushSave();
    this.destroyEditor();
    this.contentEl.empty();
  }

  async onClose(): Promise<void> {
    await this.flushSave();
    this.destroyEditor();
    this.contentEl.empty();
  }

  private scheduleSave(): void {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
    }

    saveTimer = window.setTimeout(() => {
      void this.flushSave();
    }, AUTOSAVE_DELAY);
  }

  private async flushSave(): Promise<void> {
    if (!this.editor || !this.file) {
      return;
    }
    try {
      const json = this.editor.getJSON();
      await writeNote(this.file, this.app.vault, json);
      await this.renameToTitleIfNeeded(json);
    } catch (err) {
      new Notice(`Failed to save note: ${String(err)}`);
    }
  }

  private async reloadFromDisk(): Promise<void> {
    if (!this.editor || !this.file) return;

    if (this._skipNextReload) {
      this._skipNextReload = false;
      return;
    }
    try {
      const content = await readNote(this.file, this.app.vault);
      this.editor.commands.setContent(content);
    } catch (err) {
      console.error("Failed to reload note content:", err);
    }
  }

  /**
   * Renames the file if noteTitle has changed and the name is valid,
   * same as Obsidian does when renaming an open file.
   */
  private async renameToTitleIfNeeded(doc: JSONContent): Promise<void> {
    const desired = getDesiredFileName(doc);
    if (!desired) {
      return;
    }

    const current = this.file?.basename ?? "";
    if (desired === current) {
      return;
    }

    const folder = this.file!.path.includes("/")
      ? this.file!.path.slice(0, this.file!.path.lastIndexOf("/") + 1)
      : "";
    const targetPath = `${folder}${desired}.${this.file!.extension}`;

    if (this.app.vault.getAbstractFileByPath(targetPath)) {
      new Notice(`File "${targetPath}" already exists — keeping current name`);
      return;
    }

    try {
      await this.app.vault.rename(this.file!, targetPath);
    } catch (err) {
      new Notice(`Failed to rename note: ${String(err)}`);
    }
  }

  /**
   * Hooks for state/image/attachment extensions.
   * Image follows the pattern: onSetViewProps injects onFileSelected and
   * restores src from data.id, while State.onAdd handles paste/drop.
   * Attachment uses the built-in onFileSelected hook.
   */
  private buildExtensionHooks(
    noteFile: TFile,
    editorRef: { current: Editor | null },
    ctx: ImageToolContext,
  ): ExtensionHooks {
    const app = this.app;

    return {
      state: {
        onAdd: (node, deco) => {
          if (node.type.name !== "image") return;
          // Blur so the image plugin doesn't delete the empty node on file selection from OS
          editorRef.current?.commands.blur();
          // The state plugin stores the node's key in the decoration spec.
          const key = (deco.spec as {id: string}).id;
          handleAddImg({ ...node.attrs, key }, editorRef, ctx);
        },
        onRemove: (node) => {
          // Delete image file from disk on node removal
          if (node.type.name === "image") {
            const data = node.attrs.data as {id?: string} | undefined;
            void deleteAttachmentFile(app, data?.id);
          }
        },
      },
      image: {
        onSetViewProps: (props, update) =>
          imageOnSetViewProps(props, update, ctx),
      },
      attachment: {
        onFileSelected: async (file, update) => {
          if (!file) return;
          update({
            state: {
              fileStatus: "loading",
              text: "Loading…",
              subtext: "",
              preparedData: undefined,
            },
            data: undefined,
          });
          try {
            const saved = await saveAttachmentFile(app, noteFile, file);
            update({
              state: {
                fileStatus: "attached",
                src: saved.src,
                text: saved.filename,
                subtext: "",
                preparedData: undefined,
              },
              data: {
                id: saved.id,
                size: saved.size,
                filename: saved.filename,
              },
            });
          } catch (err) {
            update({
              state: {
                fileStatus: "none",
                text: String(err),
                preparedData: undefined,
              },
            });
          }
        },
        onDeleteFile: (attrs) => {
          void deleteAttachmentFile(app, attrs.data?.id);
        },
        onRemove: (attrs) => {
          void deleteAttachmentFile(app, attrs.data?.id);
        },
        onClick: (attrs) => {
          const id = attrs.data?.id;
          if (id) {
            // openWithDefaultApp exists in Obsidian runtime but not in public types
            (app as { openWithDefaultApp?: (path: string) => void }).openWithDefaultApp?.(id);
          }
        },
      },
    };
  }

  private destroyEditor(): void {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
  }
}
