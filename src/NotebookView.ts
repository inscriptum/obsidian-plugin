import {
  FileView,
  Menu,
  Notice,
  Platform,
  setIcon,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { CellSelection, isInTable } from "prosemirror-tables";
import { Editor, isTextSelection } from "./texto/core";
import { getExtensions, type ExtensionHooks } from "./texto/getExtensions";
import { readUmFile, umFingerprint, writeUmFile } from "./storage/um/umVault";
import { UmNotebook } from "./storage/um/umNotebook";
import { UmError } from "./storage/um/umTypes";
import { FileChangedModal } from "./ui/FileChangedModal";
import {
  saveAttachmentFile,
  deleteAttachmentFile,
} from "./storage/attachments";
import {
  handleAddImgContainer,
  imageOnSetViewPropsContainer,
} from "./notebook/imageTools";
import type { ImageToolContext } from "./tools/image";
import { elTag } from "./tags";
import { NoteElement } from "./components/note/note.element";
import { ToolbarElement } from "./components/toolbar/toolbar.element";
import { BubbleMenuBarElement } from "./components/bubble-menu-bar/bubble-menu-bar.element";
import { TableBubbleMenuElement } from "./components/bubble-menu-bar/table-bubble-menu-bar.element";
import { MediaBubbleMenuElement } from "./components/bubble-menu-bar/media-bubble-menu-bar.element";
import { isMediaNodeSelection } from "./components/bubble-menu-bar/mediaMenuState";
import {
  bubbleMenuPlugin,
  type BubbleMenuView,
  type ShouldShowProps,
} from "./texto/extensions/bubble-menu";
import type { JSONContent } from "./texto/core/@types";
import "./components/note/note.element";
import "./components/toolbar/toolbar.element";
import "./components/bubble-menu-bar/bubble-menu-bar.element";
import "./components/bubble-menu-bar/table-bubble-menu-bar.element";
import "./components/bubble-menu-bar/media-bubble-menu-bar.element";
import "./styles/notebook.css";

export const NOTEBOOK_VIEW_TYPE = "notebook-view";

const AUTOSAVE_DELAY = 500;
/** Coalescing window for vault "modify" events (mirrors NoteView). */
const EXTERNAL_CHANGE_DEBOUNCE = 300;

/**
 * Construct a versioned custom element, surviving a plugin reload without
 * an app restart. tags.ts versions element tags so a fresh bundle can
 * register fresh classes — but after a reload the registry still holds the
 * PREVIOUS build's class, and `new FreshClass()` is an Illegal constructor.
 * Falling back to createElement picks up whatever class the registry holds
 * (structurally identical DOM and props), so the view keeps working until
 * the app restarts.
 */
function createCustomElement<T>(baseTag: string, make: () => T): T {
  try {
    return make();
  } catch {
    return document.createElement(elTag(baseTag)) as unknown as T;
  }
}

const makeNoteElement = () =>
  createCustomElement<NoteElement>("texto-editor", () => new NoteElement());
const makeToolbarElement = () =>
  createCustomElement<ToolbarElement>(
    "note-toolbar",
    () => new ToolbarElement(),
  );
const makeBubbleMenuBarElement = () =>
  createCustomElement<HTMLElement>(
    "bubble-menu-bar",
    () => new BubbleMenuBarElement() as unknown as HTMLElement,
  );
const makeTableBubbleMenuElement = () =>
  createCustomElement<HTMLElement>(
    "table-bubble-menu-bar",
    () => new TableBubbleMenuElement() as unknown as HTMLElement,
  );
const makeMediaBubbleMenuElement = () =>
  createCustomElement<HTMLElement>(
    "media-bubble-menu-bar",
    () => new MediaBubbleMenuElement() as unknown as HTMLElement,
  );

/** Chevron toggle icon for a section gutter — hairline tabler-style stroke
 *  like the blog draft view (folded state; CSS rotates it when expanded). */
function chevronSvg(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const polyline = document.createElementNS(ns, "polyline");
  polyline.setAttribute("points", "9 6 15 12 9 18");
  svg.appendChild(polyline);
  return svg;
}

interface SectionHandle {
  id: string;
  root: HTMLElement;
  body: HTMLElement;
  noteEl: NoteElement | null;
  editor: Editor | null;
  editorRef: { current: Editor | null };
  bubbleEls: HTMLElement[];
}

/**
 * View for `.um` containers (UM spec): a flat document of collapsed
 * sections, one section per note, in manifest order. Sections expand lazily
 * — a ProseMirror editor is created only for the expanded note, and its
 * content is written back into the in-memory notebook on collapse and on
 * save. Images inside notebook notes are packed into the container as
 * assets; other attachments stay external vault files.
 */
export class NotebookView extends FileView {
  private notebook: UmNotebook | null = null;
  private sections = new Map<string, SectionHandle>();
  /** Note ids currently collapsed; everything else is expanded. Notes start
   *  collapsed (spec section 14). */
  private foldedIds = new Set<string>();
  /** Expansion builds in flight, to prevent double editor creation for the
   *  same note. */
  private pendingExpansions = new Set<string>();

  private scrollerEl: HTMLElement | null = null;
  private sectionsEl: HTMLElement | null = null;
  private toolbarHost: HTMLElement | null = null;
  private toolbarEl: ToolbarElement | null = null;

  private dirty = false;
  private saveTimer: number | null = null;
  private externalChangeTimer: number | null = null;
  private conflictModalOpen = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return NOTEBOOK_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Notebook";
  }

  getIcon(): string {
    return "notebook";
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "um";
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((item) =>
      item
        .setTitle("Add note")
        .setIcon("plus")
        .onClick(() => this.addNote()),
    );
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("notebook-view-container");

    this.toolbarHost = this.contentEl.createDiv("notebook-toolbar-host");

    this.scrollerEl = this.contentEl.createDiv("notebook-scroller");
    this.sectionsEl = this.scrollerEl.createDiv("notebook-sections");

    // Watch for external modifications (git sync etc.) — same contract as
    // NoteView, with a fingerprint instead of a raw string diff.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file === this.file) this.onFileMaybeExternallyChanged();
      }),
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", async (leaf) => {
        if (leaf?.view !== this) await this.flushSave("leaf-blur");
      }),
    );
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.destroyAllSections();
    const notebook = await this.readNotebookWithRetries(file);
    if (notebook == null) {
      this.renderUnreadableFileState(file);
      return;
    }
    this.notebook = notebook;
    notebook.savedFingerprint = await umFingerprint(this.app.vault, file);
    // Spec section 14: notes SHOULD initially be collapsed.
    this.foldedIds = new Set(notebook.notes().map((n) => n.id));
    this.render();
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    await this.flushSave("unload-file");
    this.destroyAllSections();
  }

  async onClose(): Promise<void> {
    await this.flushSave("close");
    this.destroyAllSections();
    this.contentEl.empty();
    this.notebook?.destroy();
    this.notebook = null;
  }

  // ── Loading ──

  private async readNotebookWithRetries(
    file: TFile,
    attempts = 3,
    delayMs = 400,
  ): Promise<UmNotebook | null> {
    for (let i = 0; i < attempts; i++) {
      try {
        return await readUmFile(file, this.app.vault);
      } catch (err) {
        if (err instanceof UmError) {
          // A container that fails manifest validation stays broken —
          // retrying cannot fix it.
          console.error(`Failed to open notebook "${file.path}":`, err);
          return null;
        }
        console.error(
          `Failed to read notebook "${file.path}" (attempt ${i + 1}/${attempts}):`,
          err,
        );
        if (i < attempts - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
      }
    }
    return null;
  }

  private renderUnreadableFileState(file: TFile): void {
    this.contentEl.empty();
    const box = this.contentEl.createDiv({ cls: "inscriptum-unreadable-note" });
    box.createEl("p", {
      cls: "inscriptum-unreadable-note-title",
      text: "This notebook could not be opened.",
    });
    box.createEl("p", {
      text:
        `The file "${file.path}" is not a valid UM container. ` +
        "Nothing was loaded or saved — the file on disk was not modified.",
    });
  }

  // ── Rendering ──

  private render(): void {
    if (!this.notebook || !this.sectionsEl) return;
    // Keep unsaved editor content before tearing the sections down.
    for (const handle of this.sections.values()) {
      this.flushSectionToNotebook(handle);
    }
    this.destroyAllSections();
    this.sectionsEl.empty();

    for (const descriptor of this.notebook.notes()) {
      this.sectionsEl.appendChild(
        this.buildSection(descriptor.id, descriptor.title, descriptor.order),
      );
    }
    // Per-section controls cover add-after everywhere; a dedicated row is
    // only needed so an empty notebook is not a dead end.
    if (this.notebook.notes().length === 0) {
      this.sectionsEl.appendChild(this.buildAddNoteRow());
    }

    // Re-expand notes that are not folded (preserved across reloads).
    for (const descriptor of this.notebook.notes()) {
      if (!this.foldedIds.has(descriptor.id)) {
        void this.expandSection(descriptor.id, { focus: false });
      }
    }
  }

  private buildSection(id: string, title: string, order: number): HTMLElement {
    const root = createDiv("notebook-section");

    // Left margin: page order (the first page is unlabeled, like the blog
    // draft view) + the fold chevron.
    const margin = root.createDiv("notebook-section-margin");
    const orderLabel = margin.createDiv("notebook-section-order");
    if (order > 0) orderLabel.setText(String(order));
    const gutter = createEl("button", { cls: "notebook-section-gutter" });
    gutter.setAttribute("aria-label", "Toggle note");
    gutter.appendChild(chevronSvg());
    gutter.addEventListener("click", () => this.toggleSection(id));
    margin.appendChild(gutter);

    const body = root.createDiv("notebook-section-body");

    // Ghost controls under the section: add-after / delete (visible on hover).
    const controls = root.createDiv("notebook-section-controls");
    const addBtn = createEl("button", { cls: "notebook-section-control" });
    addBtn.setAttribute("aria-label", "Add note after");
    setIcon(addBtn, "file-plus");
    addBtn.addEventListener("click", () => this.addNoteAfter(id));
    const delBtn = createEl("button", { cls: "notebook-section-control" });
    delBtn.setAttribute("aria-label", "Delete note");
    setIcon(delBtn, "file-x");
    delBtn.addEventListener("click", () => this.deleteNote(id));
    controls.appendChild(addBtn);
    controls.appendChild(delBtn);

    const handle: SectionHandle = {
      id,
      root,
      body,
      noteEl: null,
      editor: null,
      editorRef: { current: null },
      bubbleEls: [],
    };
    this.sections.set(id, handle);

    this.renderCollapsedTitle(handle, title);
    return root;
  }

  /** The one-line collapsed representation: the note title, or a muted
   *  placeholder when empty. */
  private renderCollapsedTitle(handle: SectionHandle, title: string): void {
    handle.body.empty();
    const row = handle.body.createDiv("notebook-section-collapsed");
    const label = row.createDiv("notebook-section-title");
    if (title.trim().length > 0) {
      label.setText(title);
    } else {
      label.addClass("is-empty");
      label.setText("Untitled");
    }
    row.addEventListener("click", () =>
      this.toggleSection(handle.id, { expand: true }),
    );
    row.addEventListener("dblclick", () => this.editTitleInline(handle));

    const edit = row.createDiv("notebook-section-edit");
    edit.setAttribute("aria-label", "Rename note");
    edit.setText("✎");
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      this.editTitleInline(handle);
    });
  }

  private editTitleInline(handle: SectionHandle): void {
    const descriptor = this.notebook?.note(handle.id);
    if (!descriptor) return;
    const row = handle.body.querySelector(".notebook-section-collapsed");
    if (row == null || row.querySelector("input") != null) return;

    const input = document.createElement("input");
    input.addClass("notebook-title-input");
    input.value = descriptor.title ?? "";
    input.addEventListener("click", (event) => event.stopPropagation());
    row.empty();
    row.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const commit = (save: boolean) => {
      if (done) return;
      done = true;
      if (save && this.notebook) {
        // Renaming updates the document's first line (source of truth);
        // the manifest title mirror follows.
        this.notebook.setDisplayTitle(handle.id, input.value);
        void this.flushSave("rename");
      }
      this.renderSectionTitleOnly(handle);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") commit(true);
      else if (event.key === "Escape") commit(false);
    });
    input.addEventListener("blur", () => commit(true));
  }

  /** Re-render the collapsed title text after inline editing. */
  private renderSectionTitleOnly(handle: SectionHandle): void {
    if (!this.foldedIds.has(handle.id)) return;
    const descriptor = this.notebook?.note(handle.id);
    this.renderCollapsedTitle(handle, descriptor?.title ?? "");
  }

  private buildAddNoteRow(): HTMLElement {
    const row = createEl("button", { cls: "notebook-add-note" });
    row.setText("Add note");
    row.addEventListener("click", () => this.addNote());
    return row;
  }

  // ── Expand / collapse ──

  private toggleSection(id: string, opts?: { expand?: boolean }): void {
    const isFolded = this.foldedIds.has(id);
    if (!isFolded && opts?.expand === true) return; // already expanded
    if (isFolded) void this.expandSection(id, { focus: true });
    else void this.collapseSection(id);
  }

  private async expandSection(
    id: string,
    opts?: { focus?: boolean },
  ): Promise<void> {
    const notebook = this.notebook;
    const handle = this.sections.get(id);
    if (!notebook || !handle) return;
    const content = notebook.noteContent(id);
    if (content == null) return;
    // Already expanded (or expansion in flight) — nothing to build.
    if (handle.editor != null || this.pendingExpansions.has(id)) {
      this.foldedIds.delete(id);
      if (opts?.focus) handle.editor?.view.focus();
      return;
    }

    this.pendingExpansions.add(id);
    try {
      this.foldedIds.delete(id);
      handle.root.addClass("is-expanded");
      handle.body.empty();

      const noteEl = makeNoteElement();
      noteEl.addClass("notebook-note-host");
      handle.body.appendChild(noteEl);
      handle.noteEl = noteEl;

      const editor = await this.createEditorForSection(handle, content);
      if (editor == null) {
        // The editor container never rendered — fold the section back
        // instead of showing a dead body.
        handle.noteEl = null;
        noteEl.remove();
        handle.root.removeClass("is-expanded");
        this.foldedIds.add(id);
        this.renderSectionTitleOnly(handle);
        return;
      }
      handle.editor = editor;
      if (opts?.focus) editor.view.focus();
    } finally {
      this.pendingExpansions.delete(id);
    }
  }

  private async collapseSection(id: string): Promise<void> {
    const handle = this.sections.get(id);
    if (!handle || this.foldedIds.has(id)) return;

    // Flush the editor content into the in-memory notebook first.
    this.flushSectionToNotebook(handle);

    this.foldedIds.add(id);
    handle.root.removeClass("is-expanded");
    for (const el of handle.bubbleEls) el.remove();
    handle.bubbleEls = [];
    if (this.toolbarEl?.props.editor === handle.editor) this.destroyToolbar();
    handle.editor = null;
    handle.editorRef.current = null;
    // Removing the element destroys the editor (NoteElement cleanup).
    handle.noteEl?.remove();
    handle.noteEl = null;
    handle.body.empty();

    const descriptor = this.notebook?.note(id);
    this.renderCollapsedTitle(handle, descriptor?.title ?? "");
  }

  /** Copy the live editor JSON into the notebook model (change-gated, so
   *  idempotent flushes don't mark the notebook dirty). Notes that were
   *  removed from the manifest are skipped — their editor flush must not
   *  resurrect them. */
  private flushSectionToNotebook(handle: SectionHandle): void {
    if (!this.notebook || !handle.editor || handle.editor.isDestroyed) return;
    if (!this.notebook.note(handle.id)) return;
    const json = handle.editor.getJSON();
    const current = this.notebook.noteContent(handle.id);
    if (current != null && JSON.stringify(current) === JSON.stringify(json)) {
      return;
    }
    this.notebook.setNoteContent(handle.id, json);
  }

  private destroyAllSections(): void {
    for (const handle of this.sections.values()) {
      for (const el of handle.bubbleEls) el.remove();
      handle.noteEl?.remove();
    }
    this.sections.clear();
    this.pendingExpansions.clear();
    if (this.sectionsEl) this.sectionsEl.empty();
    this.destroyToolbar();
  }

  // ── Editor creation ──

  private async createEditorForSection(
    handle: SectionHandle,
    content: JSONContent,
  ): Promise<Editor | null> {
    const notebook = this.notebook;
    if (!notebook) return null;

    // The gfc custom element renders its container asynchronously —
    // retry like NoteView does for the main editor host.
    const editorEl = await this.waitForEditorElement(handle.noteEl);
    if (editorEl == null) return null;

    const editorRef = handle.editorRef;
    const ctx: ImageToolContext = {
      app: this.app,
      noteFile: this.file as TFile,
    };
    const isMobile = Platform.isMobile;

    const editor = new Editor({
      element: editorEl,
      content,
      onError: (err) => console.error("Notebook editor creation failed:", err),
      onUpdate: () => {
        this.dirty = true;
        this.scheduleSave();
      },
      extensions: getExtensions(
        this.buildExtensionHooks(notebook, editorRef, ctx),
        { isMobileView: isMobile },
      ),
      autofocus: "start",
    });

    if (editor.view == null) {
      console.error("Notebook editor init failed for note", handle.id);
      return null;
    }
    editorRef.current = editor;

    editor.on("focus", () => {
      if (!isMobile) this.ensureToolbar(editor);
    });

    if (!isMobile) this.createBubbleMenus(editor, handle);
    return editor;
  }

  private async waitForEditorElement(
    noteEl: NoteElement | null,
    tries = 120,
  ): Promise<HTMLElement | null> {
    for (let i = 0; i < tries; i++) {
      const el = noteEl?.props.editorContainerEl?.value;
      if (el != null) return el;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    return null;
  }

  private buildExtensionHooks(
    notebook: UmNotebook,
    editorRef: { current: Editor | null },
    ctx: ImageToolContext,
  ): ExtensionHooks {
    const app = this.app;
    return {
      state: {
        onAdd: (node, deco) => {
          if (node.type.name !== "image") return;
          const key = (deco.spec as { id: string }).id;
          handleAddImgContainer({ ...node.attrs, key }, editorRef, notebook);
        },
        onRemove: () => {
          // Packed assets are garbage-collected at save time; external
          // attachment files are removed via their explicit delete button
          // (attachment.onDeleteFile), not on node removal — matching the
          // plain-note policy of not touching files on undo/cut.
        },
      },
      image: {
        onSetViewProps: (props, update) =>
          imageOnSetViewPropsContainer(props, update, ctx, notebook),
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
            const saved = await saveAttachmentFile(
              app,
              this.file as TFile,
              file,
            );
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

  // ── Toolbar (single, follows the focused section) ──

  private ensureToolbar(editor: Editor): void {
    if (this.toolbarEl != null && this.toolbarEl.props.editor === editor)
      return;
    this.destroyToolbar();
    if (!this.toolbarHost) return;
    const toolbarEl = makeToolbarElement();
    toolbarEl.addClass("notebook-toolbar");
    toolbarEl.setAttribute("data-ignore-swipe", "true");
    toolbarEl.props.editor = editor;
    this.toolbarEl = toolbarEl;
    this.toolbarHost.appendChild(toolbarEl);
  }

  private destroyToolbar(): void {
    this.toolbarEl?.remove();
    this.toolbarEl = null;
  }

  // ── Bubble menus (desktop, per expanded section) ──

  private createBubbleMenus(editor: Editor, handle: SectionHandle): void {
    const bubbleMenuBarEl = makeBubbleMenuBarElement();
    const tableBubbleMenuEl = makeTableBubbleMenuElement();
    const mediaBubbleMenuEl = makeMediaBubbleMenuElement();
    bubbleMenuBarEl.addClass("bubble-menu-bar-host");
    tableBubbleMenuEl.addClass("table-bubble-menu-bar-host");
    mediaBubbleMenuEl.addClass("bubble-menu-bar-host");
    handle.bubbleEls = [bubbleMenuBarEl, tableBubbleMenuEl, mediaBubbleMenuEl];
    this.contentEl.appendChild(bubbleMenuBarEl);
    this.contentEl.appendChild(tableBubbleMenuEl);
    this.contentEl.appendChild(mediaBubbleMenuEl);
    bubbleMenuBarEl.props.editor = editor;
    tableBubbleMenuEl.props.editor = editor;
    mediaBubbleMenuEl.props.editor = editor;

    editor.registerPlugin(
      bubbleMenuPlugin({
        pluginKey: `nb-text-${handle.id}`,
        editor,
        element: bubbleMenuBarEl,
        shouldShow: function (
          this: BubbleMenuView,
          { editor, state, from, to }: ShouldShowProps,
        ) {
          const selection = state.selection;
          const hasFocus =
            editor.view.hasFocus() ||
            (this.tippy?.popper ?? this.element).contains(
              document.activeElement,
            );
          if (!hasFocus || !editor.isEditable || this.isMousePressed)
            return false;
          if (isMediaNodeSelection(state)) return false;
          const inTable = isInTable(state);
          // Selected text — the text menu serves it even inside a table.
          if (inTable && !selection.empty && isTextSelection(selection))
            return true;
          if (selection instanceof CellSelection) return false;
          if (inTable) return false;
          if (selection.empty) return false;
          return state.doc.textBetween(from, to).length > 0;
        },
        tippyOptions: { placement: "top", offset: [0, 8] },
      }),
    );

    editor.registerPlugin(
      bubbleMenuPlugin({
        pluginKey: `nb-table-${handle.id}`,
        editor,
        element: tableBubbleMenuEl,
        shouldShow: function (
          this: BubbleMenuView,
          { editor, state }: ShouldShowProps,
        ) {
          const hasFocus =
            editor.view.hasFocus() ||
            (this.tippy?.popper ?? this.element).contains(
              document.activeElement,
            );
          if (!hasFocus || !editor.isEditable || this.isMousePressed)
            return false;
          const selection = state.selection;
          return (
            isInTable(state) &&
            (selection.empty || selection instanceof CellSelection)
          );
        },
        tippyOptions: { placement: "top", offset: [0, 8] },
      }),
    );

    editor.registerPlugin(
      bubbleMenuPlugin({
        pluginKey: `nb-media-${handle.id}`,
        editor,
        element: mediaBubbleMenuEl,
        shouldShow: function (
          this: BubbleMenuView,
          { editor, state }: ShouldShowProps,
        ) {
          const hasFocus =
            editor.view.hasFocus() ||
            (this.tippy?.popper ?? this.element).contains(
              document.activeElement,
            );
          if (!hasFocus || !editor.isEditable || this.isMousePressed)
            return false;
          return isMediaNodeSelection(state);
        },
        tippyOptions: { placement: "top", offset: [0, 8] },
      }),
    );
  }

  // ── Notes ──

  addNote(): void {
    const notebook = this.notebook;
    if (!notebook) return;
    const notes = notebook.notes();
    const lastId = notes[notes.length - 1]?.id;
    notebook.addNote(lastId, "");
    // render() rebuilds the section list and auto-expands every note that is
    // not folded — including the newly added one.
    this.render();
    void this.flushSave("add-note");
  }

  /** Insert a new note right after the given section (per-section + control). */
  private addNoteAfter(id: string): void {
    const notebook = this.notebook;
    if (!notebook || !notebook.note(id)) return;
    notebook.addNote(id, "");
    this.render();
    void this.flushSave("add-note");
  }

  /** Remove a section's note. The write happens through the normal autosave
   *  path; an Undo notice can put the note back before that matters. */
  private deleteNote(id: string): void {
    const notebook = this.notebook;
    if (!notebook || !notebook.note(id)) return;
    const wasFolded = this.foldedIds.has(id);
    const removed = notebook.removeNote(id);
    if (removed == null) return;
    this.foldedIds.delete(id);
    this.pendingExpansions.delete(id);
    this.render();
    void this.flushSave("delete-note");

    const name = removed.descriptor.title?.trim();
    const notice = new Notice(
      name ? `Note "${name}" deleted` : "Note deleted",
      7000,
    );
    this.addNoticeAction(notice, "Undo", () => {
      if (this.notebook == null) return;
      this.notebook.restoreNote(removed);
      if (wasFolded) this.foldedIds.add(removed.descriptor.id);
      this.render();
      void this.flushSave("undo-delete");
    });
  }

  /** Attach an action button to a notice: the native Notice.addAction when
   *  the runtime has it, otherwise a plain button inside the notice. */
  private addNoticeAction(notice: Notice, title: string, cb: () => void): void {
    const withAction = notice as unknown as {
      addAction?: (
        icon: string,
        title: string,
        cb: (evt: MouseEvent) => unknown,
      ) => HTMLElement;
    };
    if (typeof withAction.addAction === "function") {
      withAction.addAction("undo", title, cb);
      return;
    }
    const btn = notice.noticeEl.createEl("button", {
      text: title,
      cls: "notebook-notice-action",
    });
    btn.addEventListener("click", () => {
      cb();
      notice.hide();
    });
  }

  // ── Saving ──

  /** Saves are chained: two flushes racing (e.g. delete's write still in
   *  flight when Undo fires) must land on disk in trigger order, or the
   *  older snapshot can overwrite the newer one. */
  private saveChain: Promise<void> = Promise.resolve();

  private scheduleSave(): void {
    if (this.saveTimer != null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flushSave();
    }, AUTOSAVE_DELAY);
  }

  private async flushSave(trigger = "autosave"): Promise<void> {
    const run = this.saveChain.then(() => this.writePendingChanges(trigger));
    this.saveChain = run.catch(() => {});
    return run;
  }

  private async writePendingChanges(trigger: string): Promise<void> {
    const notebook = this.notebook;
    const file = this.file;
    if (!notebook || !file) return;
    if (this.saveTimer != null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    for (const handle of this.sections.values()) {
      this.flushSectionToNotebook(handle);
    }
    if (notebook.dirtyNotes.size === 0 && !notebook.structureChanged) {
      this.dirty = false;
      return;
    }

    try {
      await writeUmFile(file, this.app.vault, notebook, trigger);
      notebook.dirtyNotes.clear();
      notebook.structureChanged = false;
      this.dirty = false;
    } catch (err) {
      new Notice(`Failed to save notebook: ${String(err)}`);
    }
  }

  // ── External changes ──

  private onFileMaybeExternallyChanged(): void {
    if (this.externalChangeTimer != null) {
      window.clearTimeout(this.externalChangeTimer);
    }
    this.externalChangeTimer = window.setTimeout(() => {
      this.externalChangeTimer = null;
      void this.processExternalChange();
    }, EXTERNAL_CHANGE_DEBOUNCE);
  }

  /** Decide what an observed file modification means:
   *  - fingerprint matches our last write/load → our own save, no-op;
   *  - no unsaved local edits → silently reload from disk;
   *  - unsaved local edits (conflict) → ask the user which version wins. */
  private async processExternalChange(): Promise<void> {
    const notebook = this.notebook;
    const file = this.file;
    if (!notebook || !file || this.conflictModalOpen) return;

    const fingerprint = await umFingerprint(this.app.vault, file);
    if (fingerprint === notebook.savedFingerprint) return; // our own save

    if (
      notebook.dirtyNotes.size > 0 ||
      notebook.structureChanged ||
      this.dirty
    ) {
      this.conflictModalOpen = true;
      new FileChangedModal(this.app, {
        onKeepLocal: () => {
          void this.writeNow("conflict-keep-local");
        },
        onTakeDisk: () => {
          void this.reloadFromDisk();
        },
        onClose: () => {
          this.conflictModalOpen = false;
        },
      }).open();
      return;
    }

    await this.reloadFromDisk();
  }

  /** Unconditional write (conflict resolution: local version wins). */
  private async writeNow(trigger: string): Promise<void> {
    const notebook = this.notebook;
    const file = this.file;
    if (!notebook || !file) return;
    for (const handle of this.sections.values()) {
      this.flushSectionToNotebook(handle);
    }
    try {
      await writeUmFile(file, this.app.vault, notebook, trigger);
      notebook.dirtyNotes.clear();
      notebook.structureChanged = false;
      this.dirty = false;
    } catch (err) {
      new Notice(`Failed to save notebook: ${String(err)}`);
    }
  }

  /** Replace the in-memory notebook and the UI with the on-disk state. */
  private async reloadFromDisk(): Promise<void> {
    const file = this.file;
    if (!file) return;
    try {
      const fresh = await readUmFile(file, this.app.vault);
      fresh.savedFingerprint = await umFingerprint(this.app.vault, file);
      this.destroyAllSections();
      this.notebook?.destroy();
      this.notebook = fresh;
      this.dirty = false;
      // Keep the user's expansion state across the reload.
      this.render();
    } catch (err) {
      console.error("Failed to reload notebook from disk:", err);
    }
  }
}
