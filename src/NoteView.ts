import {
  FileView,
  WorkspaceLeaf,
  TFile,
  Notice,
  Platform,
  Menu,
} from "obsidian";
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
import "./components/search/search.element";
import { NoteElement } from "./components/note/note.element";
import { ToolbarElement } from "./components/toolbar/toolbar.element";
import { SearchElement } from "./components/search/search.element";
import { setupScrollShadows } from "./components/toolbar/scrollShadow";
import {
  bubbleMenuPlugin,
  type BubbleMenuView,
  type ShouldShowProps,
} from "./texto/extensions/bubble-menu";
import { BubbleMenuBarElement } from "./components/bubble-menu-bar/bubble-menu-bar.element";
import { TableBubbleMenuElement } from "./components/bubble-menu-bar/table-bubble-menu-bar.element";
import { MediaBubbleMenuElement } from "./components/bubble-menu-bar/media-bubble-menu-bar.element";
import { isMediaNodeSelection } from "./components/bubble-menu-bar/mediaMenuState";
import { setHighlightTheme } from "./theme/hljsTheme";
import { createDocumentSearchPlugin } from "./search/documentSearch";

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

  // ── Mobile: our own bottom toolbar (native-styled) ──
  // Our toolbar is always a separate docked bar. On phones it is shown only
  // while the soft keyboard is open; on iPad it stays visible.
  private scrollShadowCleanup: (() => void) | null = null;
  private mobileScrollCleanup: (() => void) | null = null;
  private mobileNavWasHidden: boolean | null = null;
  private keyboardListenerHandles: Array<{ remove: () => Promise<void> | void }> = [];
  private keyboardListenerGeneration = 0;
  private keyboardViewportCleanup: (() => void) | null = null;
  private leafContentWithNoteClass: HTMLElement | null = null;
  private searchEl: HTMLElement | null = null;

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

  /** Populate the view's "More options" (three-dot) menu. Keeps the default
      FileView items and adds a shortcut to the in-document search. */
  onPaneMenu(menu: Menu, source: "more-options" | "tab-header" | string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((item) =>
      item
        .setTitle("Find in note")
        .setIcon("search")
        .onClick(() => this.openSearch()),
    );
  }

  /** Mobile layout is gated on Platform.isMobile ("UI is in mobile mode").
      It is true on real mobile and also when Obsidian runs in mobile emulation
      (`app.emulateMobile(true)`), so it reflects the actual UI mode. */
  private isMobileView(): boolean {
    return Platform.isMobile;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("note-view-container");

    this.leafContentWithNoteClass =
      this.contentEl.closest<HTMLElement>(".workspace-leaf-content");
    this.leafContentWithNoteClass?.classList.add("has-inscriptum-note-view");

    this.registerDomEvent(
      window,
      "keydown",
      (event) => this.handleSearchShortcut(event),
      true,
    );

    // Obsidian's global Search current file command owns Mod+F and can
    // consume the native macOS shortcut before it reaches the DOM. Register
    // a scope handler with a null key so keyboard layouts are handled by the
    // physical key code instead of the translated character.
    for (const modifier of ["Meta", "Ctrl"] as const) {
      const handler = this.app.scope.register([modifier], null, (event) => {
        if (this.app.workspace.getActiveViewOfType(NoteView) !== this) {
          return;
        }
        if (event.code !== "KeyF" && event.key.toLowerCase() !== "f") {
          return;
        }
        this.openSearch();
        return false;
      });
      this.register(() => this.app.scope.unregister(handler));
    }

    if (this.isMobileView()) {
      this.setupKeyboardHandling();
      this.scrollShadowCleanup?.();
      this.scrollShadowCleanup = setupScrollShadows(this.contentEl);
    }

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", async (leaf) => {
        if (leaf?.view === this) {
          await this.reloadFromDisk();
        }
      }),
    );
  }

  /** Mirror Obsidian's mobile navigation behavior for our inner scroll area.
      Obsidian listens to the Markdown scroller; our FileView has a separate
      `.texto-editor` scroller, so the shell would otherwise never receive the
      hide/show navigation state. */
  private setupMobileScrollBehavior(scrollEl: HTMLElement): void {
    this.mobileScrollCleanup?.();
    const body = document.body;
    const wasHidden = body.classList.contains("is-hidden-nav");
    this.mobileNavWasHidden = wasHidden;
    let lastTop = scrollEl.scrollTop;

    const onScroll = () => {
      const top = scrollEl.scrollTop;
      this.contentEl.classList.toggle("is-scrolled", top > 2);

      if (top <= 2 || top < lastTop - 1) {
        body.classList.remove("is-hidden-nav");
      } else if (top > lastTop + 1) {
        body.classList.add("is-hidden-nav");
      }
      lastTop = top;
    };

    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    this.mobileScrollCleanup = () => {
      scrollEl.removeEventListener("scroll", onScroll);
      this.contentEl.classList.remove("is-scrolled");
      if (this.mobileNavWasHidden) body.classList.add("is-hidden-nav");
      else body.classList.remove("is-hidden-nav");
      this.mobileNavWasHidden = null;
    };
  }

  /** Track the soft keyboard and reserve its height so the toolbar sits
      immediately above it. Focus is deliberately not used here: dismissing
      the keyboard does not necessarily blur a contenteditable element. */
  private setupKeyboardHandling(): void {
    this.clearKeyboardListeners();
    const generation = this.keyboardListenerGeneration;
    const update = (height: number, reserveSpace: boolean) => {
      const open = height > 0;
      this.contentEl.classList.toggle("is-keyboard-open", open);
      // Capacitor/Obsidian already resizes the view above the keyboard. The
      // viewport fallback may overlay it, so only that path needs padding.
      this.contentEl.setCssProps({
        "--keyboard-offset": reserveSpace && open ? `${height}px` : "",
      });
    };

    // Obsidian Android/iOS exposes Capacitor's Keyboard plugin. Unlike
    // visualViewport, it also works when Android draws the keyboard as an
    // overlay (the emulator and Android 15+ commonly do this).
    type KeyboardPlugin = {
      addListener?: (
        event: string,
        listener: (info: { keyboardHeight?: number }) => void,
      ) => Promise<{ remove: () => Promise<void> | void }>;
    };
    const capacitor = (window as unknown as {
      Capacitor?: { Plugins?: { Keyboard?: KeyboardPlugin } };
    }).Capacitor;
    const keyboard = capacitor?.Plugins?.Keyboard;

    if (keyboard?.addListener) {
      update(0, false);
      for (const event of ["keyboardWillShow", "keyboardDidShow", "keyboardWillHide", "keyboardDidHide"]) {
        void keyboard.addListener(event, (info) => {
          const height = event.endsWith("Hide") ? 0 : Number(info.keyboardHeight ?? 0);
          update(Number.isFinite(height) ? height : 0, false);
        }).then((handle) => {
          if (generation === this.keyboardListenerGeneration) {
            this.keyboardListenerHandles.push(handle);
          } else {
            void handle.remove();
          }
        });
      }
      return;
    }

    // Fallback for desktop mobile emulation and browsers without Capacitor.
    const updateFromViewport = () => {
      const { height } = this.keyboardState();
      update(height, true);
    };
    updateFromViewport();
    if (window.visualViewport) {
      const viewport = window.visualViewport;
      viewport.addEventListener("resize", updateFromViewport);
      viewport.addEventListener("scroll", updateFromViewport);
      this.keyboardViewportCleanup = () => {
        viewport.removeEventListener("resize", updateFromViewport);
        viewport.removeEventListener("scroll", updateFromViewport);
      };
    }
    this.registerDomEvent(window, "resize", updateFromViewport);
    this.registerEvent(this.app.workspace.on("resize", updateFromViewport));
  }

  private clearKeyboardListeners(): void {
    this.keyboardListenerGeneration += 1;
    this.keyboardViewportCleanup?.();
    this.keyboardViewportCleanup = null;
    for (const handle of this.keyboardListenerHandles) {
      void handle.remove();
    }
    this.keyboardListenerHandles = [];
  }

  private keyboardState(): { open: boolean; height: number } {
    const vv = window.visualViewport;
    if (!vv) return { open: false, height: 0 };
    const height = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    return { open: height > 120, height };
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.mobileScrollCleanup?.();
    this.mobileScrollCleanup = null;
    this.destroyEditor();
    this.destroySearchBar();
    this.contentEl.empty();

    const content = await readNote(file, this.app.vault);
    const noteEl = new NoteElement();
    noteEl.addClass("texto-editor-host");
    const toolbarEl = new ToolbarElement();
    toolbarEl.addClass("note-toolbar-host");
    const bubbleMenuBarEl = new BubbleMenuBarElement();
    bubbleMenuBarEl.addClass("bubble-menu-bar-host");
    const tableBubbleMenuEl = new TableBubbleMenuElement();
    tableBubbleMenuEl.addClass("table-bubble-menu-bar-host");
    const mediaBubbleMenuEl = new MediaBubbleMenuElement();
    mediaBubbleMenuEl.addClass("bubble-menu-bar-host");

    window.requestAnimationFrame(() => {
      const isMobile = this.isMobileView();
      if (isMobile) {
        this.contentEl.addClass("is-mobile");
        if (Platform.isPhone) this.contentEl.addClass("is-phone");
      }
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
        this.editor.registerPlugin(createDocumentSearchPlugin());
        this.createSearchBar();

        if (isMobile) {
          this.setupMobileScrollBehavior(editorEl);
        }

        this.editor.on("blur", () => {
          void this.flushSave();
        });

        this._skipNextReload = true;

        noteEl.props.editor = this.editor;

        toolbarEl.props.editor = this.editor;
        bubbleMenuBarEl.props.editor = this.editor;
        tableBubbleMenuEl.props.editor = this.editor;
        mediaBubbleMenuEl.props.editor = this.editor;
        mediaBubbleMenuEl.props.app = this.app;

        // Attach menus to the DOM AFTER setting props.editor: for the required prop,
        // connectedCallback starts the generator only when editor is already set.
        if (isMobile) {
          // Mobile: bubble menus render inside the bottom toolbar and swap in
          // on selection (see ToolbarElement). No floating tippy popup.
          toolbarEl.props.selectionBar = bubbleMenuBarEl;
          toolbarEl.props.tableSelectionBar = tableBubbleMenuEl;
          toolbarEl.props.mediaSelectionBar = mediaBubbleMenuEl;
        } else {
          this.contentEl.appendChild(bubbleMenuBarEl);
          this.contentEl.appendChild(tableBubbleMenuEl);
          this.contentEl.appendChild(mediaBubbleMenuEl);

          // ── Text bubble menu ──
        // Show for non-empty text selection OUTSIDE tables.
        // Inside a table — the separate table menu handles it.
        if (!isMobile) this.editor.registerPlugin(
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

              // Media nodes have their own menu — hide the text menu for them.
              if (isMediaNodeSelection(state)) {
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
        if (!isMobile) this.editor.registerPlugin(
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

        // ── Media bubble menu (image / attachment) ──
        if (!isMobile) this.editor.registerPlugin(
          bubbleMenuPlugin({
            pluginKey: "mediaBubbleMenu",
            editor: this.editor,
            element: mediaBubbleMenuEl,
            shouldShow: function (
              this: BubbleMenuView,
              { editor, state }: ShouldShowProps,
            ) {
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

              return isMediaNodeSelection(state);
            },
            tippyOptions: {
              placement: "top",
              offset: [0, 8],
              animation: "bubble-pop",
              duration: [160, 120],
            },
          }),
        );
        }

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
    this.mobileScrollCleanup?.();
    this.mobileScrollCleanup = null;
    this.destroySearchBar();
    await this.flushSave();
    this.destroyEditor();
    this.contentEl.empty();
  }

  async onClose(): Promise<void> {
    this.mobileScrollCleanup?.();
    this.mobileScrollCleanup = null;
    this.clearKeyboardListeners();
    this.destroySearchBar();
    this.leafContentWithNoteClass?.classList.remove("has-inscriptum-note-view");
    this.leafContentWithNoteClass = null;
    this.scrollShadowCleanup?.();
    this.scrollShadowCleanup = null;
    await this.flushSave();
    this.destroyEditor();
    this.contentEl.empty();
  }

  public openSearch(): void {
    if (!this.editor || !this.searchEl) return;
    this.searchEl.dispatchEvent(new Event("open-search"));
  }

  private handleSearchShortcut(event: KeyboardEvent): void {
    if (this.app.workspace.getActiveViewOfType(NoteView) !== this) return;

    const isFindKey =
      event.code === "KeyF" || event.key.toLowerCase() === "f";
    if (!(event.metaKey || event.ctrlKey) || !isFindKey) {
      if (event.key === "Escape") {
        this.searchEl?.dispatchEvent(new Event("close-search"));
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.openSearch();
  }

  private createSearchBar(): void {
    this.destroySearchBar();
    if (!this.editor) return;

    const searchEl = new SearchElement();
    searchEl.props.editor = this.editor;
    this.searchEl = searchEl;
    this.contentEl.appendChild(searchEl);
  }

  private destroySearchBar(): void {
    this.searchEl?.remove();
    this.searchEl = null;
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
