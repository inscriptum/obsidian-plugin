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
import {
  createPhysicalShortcutPlugin,
  isForwardedShortcut,
  markForwardedShortcut,
  matchPressedCommand,
  nameToKeyboardEvent,
} from "./tools/isPressedCommand";
import {
  createDocumentSearchPlugin,
  documentSearchKey,
  findDocumentMatches,
} from "./search/documentSearch";
import {
  searchNotepad,
  type NotepadSearchMatch,
} from "./notepad/notepadSearch";
import { getExtensions, type ExtensionHooks } from "./texto/getExtensions";
import {
  createFoldPersistence,
  type FoldPersistence,
} from "./storage/foldPersistence";
import { readUmFile, umFingerprint, writeUmFile } from "./storage/um/umVault";
import { UmNotepad } from "./storage/um/umNotepad";
import { UmError, UM_SCHEMA_TITLE } from "./storage/um/umTypes";
import { FileChangedModal } from "./ui/FileChangedModal";
import { ConfirmModal } from "./ui/ConfirmModal";
import {
  saveAttachmentFile,
  deleteAttachmentFile,
} from "./storage/attachments";
import {
  handleAddImgContainer,
  imageOnSetViewPropsContainer,
} from "./notepad/imageTools";
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
import "./styles/notepad.css";

export const NOTEPAD_VIEW_TYPE = "notepad-view";

/** The strip the open nav drawer occupies: 300px wide including its 1px
 *  right border (box-sizing: border-box in the app theme). Must stay in
 *  sync with the scroller margin-left in notepad.css. */
const NAV_WIDTH = 300;

const AUTOSAVE_DELAY = 500;
/** Coalescing window for vault "modify" events (mirrors NoteView). */
const EXTERNAL_CHANGE_DEBOUNCE = 300;

/** True while a forwarded `editor.commands` dispatch is in flight (see
 *  handleEditorShortcut). */
let dispatchingEditorShortcut = false;

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

/** The blog draft view's ☰ (tabler menu-2: 38×38, hairline stroke 1). */
function menuSvg(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "icon-menu");
  svg.setAttribute("width", "38");
  svg.setAttribute("height", "38");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const y of ["6", "12", "18"]) {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", "4");
    line.setAttribute("y1", y);
    line.setAttribute("x2", "20");
    line.setAttribute("y2", y);
    svg.appendChild(line);
  }
  return svg;
}

/** The ✕ that replaces ☰ while the drawer is open. */
function closeSvg(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "icon-close");
  svg.setAttribute("width", "38");
  svg.setAttribute("height", "38");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const [x1, y1, x2, y2] of [
    ["7", "7", "17", "17"],
    ["17", "7", "7", "17"],
  ]) {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    svg.appendChild(line);
  }
  return svg;
}

/** Chevron toggle icon for a section gutter — copied from the blog draft
 *  view: 44×44 tabler chevron, hairline 0.5 stroke (folded state; CSS
 *  rotates it when expanded). */
function chevronSvg(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "44");
  svg.setAttribute("height", "44");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "0.5");
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
  /** Bordered page frame: holds the content plus the controls row, so the
   *  bottom separator visually groups the controls with their page. */
  body: HTMLElement;
  /** The part that swaps between the collapsed title row and the editor. */
  content: HTMLElement;
  noteEl: NoteElement | null;
  editor: Editor | null;
  editorRef: { current: Editor | null };
  bubbleEls: HTMLElement[];
  /** Device-local persistence of this page's in-document fold state
   *  (headings + task items), created lazily — see foldPersistence.ts. */
  folds: FoldPersistence | null;
}

/**
 * View for `.um` containers (UM spec): a flat document of collapsed
 * sections, one section per note, in manifest order. Sections expand lazily
 * — a ProseMirror editor is created only for the expanded note, and its
 * content is written back into the in-memory notepad on collapse and on
 * save. Images inside notepad notes are packed into the container as
 * assets; other attachments stay external vault files.
 */
export class NotepadView extends FileView {
  /** Called whenever a page editor is created; lets the plugin host sync
   *  the set of physically intercepted shortcut keys (see main.ts and
   *  src/tools/isPressedCommand.ts). */
  static onEditorCreated: ((editor: Editor) => void) | null = null;

  private notepad: UmNotepad | null = null;
  private sections = new Map<string, SectionHandle>();
  /** Expansion state lives on the note descriptors in the manifest
   *  (`expanded`, persisted with the container); a note without the flag is
   *  collapsed — the spec's initial default (section 14). */
  /** Expansion builds in flight, to prevent double editor creation for the
   *  same note. */
  private pendingExpansions = new Set<string>();

  private scrollerEl: HTMLElement | null = null;
  private sectionsEl: HTMLElement | null = null;
  private toolbarHost: HTMLElement | null = null;
  private toolbarEl: ToolbarElement | null = null;

  /** The page editor the user last focused — hotkey routing and the
   *  toolbar target it. */
  private focusedEditorValue: Editor | null = null;

  // ── Notepad-wide search ──
  private searchPanelEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private searchCountEl: HTMLElement | null = null;
  private searchMatches: NotepadSearchMatch[] = [];
  private searchIndex = 0;

  // ── Pages navigation sidebar (blog-style, hidden by default) ──
  private navEl: HTMLElement | null = null;
  private navListEl: HTMLElement | null = null;
  private navOpen = false;
  /** Guards the one-time default-open decision (open when the drawer
   *  fits); later resizes never override the user's own choice. */
  private navBooted = false;
  private navResize: ResizeObserver | null = null;
  /** Settler of the in-flight nav-flip scrollbar guard (see
   *  flipContentLayout); null when no flip is animating. */
  private flipSettle: (() => void) | null = null;

  // ── Drag & drop reorder ──
  private drag: {
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null = null;
  private dropLineEl: HTMLElement | null = null;
  private suppressGutterToggle = false;

  private dirty = false;
  private saveTimer: number | null = null;
  private externalChangeTimer: number | null = null;
  private conflictModalOpen = false;

  /** The page editor the user last focused; hotkey routing and command
   *  patching target it (see main.ts routeToNoteView). */
  get focusedEditor(): Editor | null {
    if (this.focusedEditorValue?.isDestroyed) return null;
    return this.focusedEditorValue;
  }

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return NOTEPAD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Notepad";
  }

  getIcon(): string {
    return "notepad";
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "um";
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((item) =>
      item
        .setTitle("Find in notepad")
        .setIcon("search")
        .onClick(() => this.openNotepadSearch()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Add note")
        .setIcon("plus")
        .onClick(() => this.addNote()),
    );
  }

  /** Hotkey routing into the focused page's editor (see main.ts and
   *  tools/isPressedCommand). Returns false when the event was consumed. */
  handleEditorShortcut(event: KeyboardEvent): false | undefined {
    if (this.app.workspace.getActiveViewOfType(NotepadView) !== this) return;
    if (isForwardedShortcut(event)) return;
    if (dispatchingEditorShortcut) return;
    const editor = this.focusedEditorValue;
    if (!editor) return;

    // Find owns Mod+F (opens the notepad-wide search).
    if (
      event.code === "KeyF" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.openNotepadSearch();
      return false;
    }

    // Mod+K opens the link layer: re-dispatch a Latin-keyed synthetic event
    // so the bubble menu's layout-dependent check works on any layout.
    if (
      event.code === "KeyK" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.forwardLatinShortcut(event);
      return false;
    }

    const shortcut = matchPressedCommand(event, editor.registeredShortcuts);
    if (!shortcut) return;

    event.preventDefault();
    event.stopPropagation();
    dispatchingEditorShortcut = true;
    try {
      const reDispatch = nameToKeyboardEvent(shortcut);
      if (reDispatch) {
        markForwardedShortcut(reDispatch);
        editor.view.someProp("handleKeyDown", (f) =>
          f(editor.view, reDispatch),
        );
      }
    } finally {
      dispatchingEditorShortcut = false;
    }
    return false;
  }

  private forwardLatinShortcut(event: KeyboardEvent): void {
    const forwarded = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      bubbles: true,
      cancelable: true,
    });
    markForwardedShortcut(forwarded);
    document.dispatchEvent(forwarded);
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("notepad-view-container");
    // Mirrors NoteView: the CSS uses the class to scope desktop-only rules
    // (e.g. the fixed page column) away from phones/tablets.
    if (Platform.isMobile) {
      this.contentEl.addClass("is-mobile");
      if (Platform.isPhone) this.contentEl.addClass("is-phone");
    }

    this.toolbarHost = this.contentEl.createDiv("notepad-toolbar-host");
    // Blog-style pages navigation drawer (hidden by default, ☰ toggle).
    this.buildNavSidebar();

    this.scrollerEl = this.contentEl.createDiv("notepad-scroller");
    this.sectionsEl = this.scrollerEl.createDiv("notepad-sections");

    // Overlay case (the column does not fit beside the drawer, and mobile):
    // a click on the content dismisses the open drawer — there the drawer
    // covers the column. Capture phase, so an editor-internal stopPropagation
    // cannot suppress the dismissal.
    this.scrollerEl.addEventListener(
      "click",
      () => {
        if (this.navOpen && !this.navFits())
          this.setNavOpen(false, { animate: true });
      },
      true,
    );

    // The boot decision must see the real view width; the observer's
    // initial callback re-runs it after the view is laid out (a 0-width
    // container at onOpen would measure wrong).
    this.navResize = new ResizeObserver(() => this.updateNavMode());
    this.navResize.observe(this.contentEl);
    this.updateNavMode();

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
    const notepad = await this.readNotepadWithRetries(file);
    if (notepad == null) {
      this.renderUnreadableFileState(file);
      return;
    }
    this.notepad = notepad;
    notepad.savedFingerprint = await umFingerprint(this.app.vault, file);
    // Expansion state comes from the manifest (`expanded` per note); notes
    // without the flag start collapsed (spec section 14).
    this.render();
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    await this.flushSave("unload-file");
    this.destroyAllSections();
  }

  async onClose(): Promise<void> {
    await this.flushSave("close");
    this.navResize?.disconnect();
    this.navResize = null;
    this.destroyAllSections();
    this.contentEl.empty();
    this.notepad?.destroy();
    this.notepad = null;
  }

  // ── Loading ──

  private async readNotepadWithRetries(
    file: TFile,
    attempts = 3,
    delayMs = 400,
  ): Promise<UmNotepad | null> {
    for (let i = 0; i < attempts; i++) {
      try {
        return await readUmFile(file, this.app.vault);
      } catch (err) {
        if (err instanceof UmError) {
          // A container that fails manifest validation stays broken —
          // retrying cannot fix it.
          console.error(`Failed to open notepad "${file.path}":`, err);
          return null;
        }
        console.error(
          `Failed to read notepad "${file.path}" (attempt ${i + 1}/${attempts}):`,
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
      text: "This notepad could not be opened.",
    });
    box.createEl("p", {
      text:
        `The file "${file.path}" is not a valid UM container. ` +
        "Nothing was loaded or saved — the file on disk was not modified.",
    });
  }

  // ── Rendering ──

  private render(): void {
    if (!this.notepad || !this.sectionsEl) return;
    // Keep unsaved editor content before tearing the sections down.
    for (const handle of this.sections.values()) {
      this.flushSectionToNotepad(handle);
    }
    this.destroyAllSections();
    this.sectionsEl.empty();

    for (const descriptor of this.notepad.notes()) {
      this.sectionsEl.appendChild(
        this.buildSection(
          descriptor.id,
          descriptor.title ?? "",
          descriptor.order,
        ),
      );
    }
    // Per-section controls cover add-after everywhere; this row closes the
    // list so the end of the notepad is always a one-click add. Shown even
    // when pages exist — the owner's call (2026-09-27); the empty-notepad
    // dead-end guard is just its first use.
    this.sectionsEl.appendChild(this.buildAddNoteRow());

    // Re-expand notes marked expanded in the manifest (state survives
    // reloads and moves with the file). The title page is the exception
    // (spec 9.1): it is always expanded, whatever the manifest says — and
    // pages this editor cannot open never mount an editor at all.
    for (const descriptor of this.notepad.notes()) {
      if (!this.notepad.isNoteOpenable(descriptor.id)) continue;
      if (descriptor.order === 0 || this.notepad.isExpanded(descriptor.id)) {
        void this.expandSection(descriptor.id, { focus: false });
      }
    }
    this.rebuildNavList();
  }

  private buildSection(id: string, title: string, order: number): HTMLElement {
    const root = createDiv("notepad-section");
    // The title page (order 0) is the fixed cover: no fold chevron, no
    // duplicate/delete, no left frame rule. Pages this editor cannot
    // interpret (newer schema version, unknown family, failed migration)
    // show a notice instead of content and are preserved verbatim.
    const isTitlePage = order === 0;
    const schemaState = this.notepad?.noteSchemaState(id);
    const isUnsupported = schemaState != null && schemaState.kind !== "openable";
    if (isTitlePage) root.addClass("is-title");
    if (isUnsupported) root.addClass("is-unsupported");

    // Left margin: page order (the first page is unlabeled, like the blog
    // draft view) + the fold chevron for foldable pages.
    const margin = root.createDiv("notepad-section-margin");
    const orderLabel = margin.createDiv("notepad-section-order");
    if (order > 0) orderLabel.setText(String(order));
    if (!isTitlePage && !isUnsupported) {
      const gutter = createEl("button", { cls: "notepad-section-gutter" });
      gutter.setAttribute("aria-label", "Toggle note");
      gutter.appendChild(chevronSvg());
      // Click toggles the fold; a pointer drag reorders the page.
      gutter.addEventListener("click", () => {
        if (this.suppressGutterToggle) {
          this.suppressGutterToggle = false;
          return;
        }
        this.toggleSection(id);
      });
      gutter.addEventListener("pointerdown", (event) =>
        this.onGutterPointerDown(event, id),
      );
      margin.appendChild(gutter);
    }

    const body = root.createDiv("notepad-section-body");
    const content = body.createDiv("notepad-section-content");

    // Ghost controls under the section content but INSIDE the page frame
    // (above its bottom separator) — so they visibly belong to this page.
    // The title page carries no duplicate/delete control — it anchors the
    // notepad (spec 9.1); unopenable pages are preserved as-is.
    const controls = body.createDiv("notepad-section-controls");
    const addBtn = createEl("button", { cls: "notepad-section-control" });
    addBtn.setAttribute("aria-label", "Add note after");
    setIcon(addBtn, "plus");
    addBtn.addEventListener("click", () => this.addNoteAfter(id));
    controls.appendChild(addBtn);
    if (!isTitlePage && !isUnsupported) {
      const copyBtn = createEl("button", { cls: "notepad-section-control" });
      copyBtn.setAttribute("aria-label", "Duplicate note");
      setIcon(copyBtn, "copy");
      copyBtn.addEventListener("click", () => this.duplicateNote(id));
      controls.appendChild(copyBtn);
      const delBtn = createEl("button", {
        cls: "notepad-section-control is-danger",
      });
      delBtn.setAttribute("aria-label", "Delete note");
      setIcon(delBtn, "trash-2");
      delBtn.addEventListener("click", () => this.deleteNote(id));
      controls.appendChild(delBtn);
    }

    const handle: SectionHandle = {
      id,
      root,
      body,
      content,
      noteEl: null,
      editor: null,
      editorRef: { current: null },
      bubbleEls: [],
      folds: null,
    };
    this.sections.set(id, handle);

    if (isUnsupported) {
      this.renderUnsupportedNotice(handle, schemaState);
    } else if (!isTitlePage) {
      // The title page is always expanded — its content is built by
      // expandSection right away; no collapsed row exists for it.
      this.renderCollapsedTitle(handle, title);
    }
    return root;
  }

  /** The notice replacing a page this editor cannot open (spec 8.6.2). */
  private renderUnsupportedNotice(
    handle: SectionHandle,
    state: NonNullable<ReturnType<UmNotepad["noteSchemaState"]>>,
  ): void {
    handle.content.empty();
    const box = handle.content.createDiv("notepad-section-unsupported");
    const title = box.createDiv("notepad-section-unsupported-title");
    const text = box.createDiv("notepad-section-unsupported-text");
    if (state.kind === "invalid") {
      title.setText("This page could not be converted for editing");
      text.setText("Its content is kept unchanged in the file.");
    } else {
      title.setText("This page was created in a newer version");
      text.setText(
        "Update Inscriptum to open and edit it. The content is kept unchanged in the file.",
      );
    }
  }

  /** The one-line collapsed representation: the note title, or a muted
   *  placeholder when empty. */
  private renderCollapsedTitle(handle: SectionHandle, title: string): void {
    handle.content.empty();
    const row = handle.content.createDiv("notepad-section-collapsed");
    const label = row.createDiv("notepad-section-title");
    if (title.trim().length > 0) {
      label.setText(title);
    } else {
      label.addClass("is-empty");
      label.setText("Untitled");
    }
    row.addEventListener("click", () =>
      this.toggleSection(handle.id, { expand: true }),
    );
    // No dblclick handler here: the first click expands the section and
    // removes this row synchronously, so a dblclick can never land —
    // renaming goes through the edit glyph only.

    const edit = row.createDiv("notepad-section-edit");
    edit.setAttribute("aria-label", "Rename note");
    edit.setText("✎");
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      this.editTitleInline(handle);
    });
  }

  private editTitleInline(handle: SectionHandle): void {
    const descriptor = this.notepad?.note(handle.id);
    // The title page has no collapsed row and no rename entry point — its
    // title is edited directly in the always-open header (spec 9.1).
    if (!descriptor || descriptor.order === 0) return;
    const row = handle.content.querySelector(".notepad-section-collapsed");
    if (row == null || row.querySelector("input") != null) return;

    const input = document.createElement("input");
    input.addClass("notepad-title-input");
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
      if (save && this.notepad) {
        // Renaming updates the document's first line (source of truth);
        // the manifest title mirror follows.
        this.notepad.setDisplayTitle(handle.id, input.value);
        this.rebuildNavList();
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
    if (this.notepad?.isExpanded(handle.id)) return;
    const descriptor = this.notepad?.note(handle.id);
    this.renderCollapsedTitle(handle, descriptor?.title ?? "");
  }

  /** Non-interactive header row for the title page when its editor could
   *  not be created: no fold toggle, no rename — just the title text. */
  private renderStaticTitleRow(handle: SectionHandle): void {
    handle.content.empty();
    const descriptor = this.notepad?.note(handle.id);
    const title = descriptor?.title ?? "";
    const row = handle.content.createDiv("notepad-section-collapsed is-static");
    const label = row.createDiv("notepad-section-title");
    if (title.trim().length > 0) {
      label.setText(title);
    } else {
      label.addClass("is-empty");
      label.setText("Untitled");
    }
  }

  private buildAddNoteRow(): HTMLElement {
    const row = createEl("button", { cls: "notepad-add-note" });
    row.setText("Add note");
    row.addEventListener("click", () => this.addNote());
    return row;
  }

  // ── Expand / collapse ──

  private toggleSection(id: string, opts?: { expand?: boolean }): void {
    // The title page is the fixed cover: never folded, never expanded by
    // the fold toggle (spec 9.1).
    const descriptor = this.notepad?.note(id);
    if (!descriptor || descriptor.order === 0) return;
    const isFolded = !this.notepad?.isExpanded(id);
    if (!isFolded && opts?.expand === true) return; // already expanded
    if (isFolded) void this.expandSection(id, { focus: true });
    else void this.collapseSection(id);
  }

  private async expandSection(
    id: string,
    opts?: { focus?: boolean; autofocus?: boolean },
  ): Promise<void> {
    const notepad = this.notepad;
    const handle = this.sections.get(id);
    if (!notepad || !handle) return;
    // Pages this editor cannot interpret (newer version, unknown family,
    // failed migration) show a notice instead of an editor (spec 8.6.2).
    if (!notepad.isNoteOpenable(id)) return;
    const content = notepad.noteContent(id);
    if (content == null) return;
    // Already expanded (or expansion in flight) — nothing to build.
    if (handle.editor != null || this.pendingExpansions.has(id)) {
      notepad.setExpanded(id, true);
      this.scheduleSave();
      if (opts?.focus) handle.editor?.view.focus();
      return;
    }

    this.pendingExpansions.add(id);
    try {
      notepad.setExpanded(id, true);
      this.scheduleSave();
      handle.root.addClass("is-expanded");
      handle.content.empty();

      const noteEl = makeNoteElement();
      noteEl.addClass("notepad-note-host");
      handle.content.appendChild(noteEl);
      handle.noteEl = noteEl;

      const editor = await this.createEditorForSection(handle, content, {
        autofocus: opts?.autofocus,
      });
      if (editor == null) {
        handle.noteEl = null;
        noteEl.remove();
        if (notepad.note(handle.id)?.order === 0) {
          // The title page never folds (spec 9.1): keep the section open
          // and show a static header row instead of the collapsed title.
          this.renderStaticTitleRow(handle);
          return;
        }
        // The editor container never rendered — fold the section back
        // instead of showing a dead body.
        handle.root.removeClass("is-expanded");
        notepad.setExpanded(id, false);
        this.scheduleSave();
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
    if (!handle || this.notepad?.isExpanded(id) !== true) return;

    // Flush the editor content into the in-memory notepad first.
    this.flushSectionToNotepad(handle);

    const ownedToolbar = this.toolbarEl?.props.editor === handle.editor;
    if (this.focusedEditorValue === handle.editor) {
      this.focusedEditorValue = null;
    }

    this.notepad.setExpanded(id, false);
    this.scheduleSave();
    handle.root.removeClass("is-expanded");
    for (const el of handle.bubbleEls) el.remove();
    handle.bubbleEls = [];
    // Detach the dying editor before rebinding: the toolbar must not be
    // handed to an editor that is about to be destroyed.
    handle.editor = null;
    handle.editorRef.current = null;
    if (ownedToolbar) this.rebindOrIdleToolbar();
    // Removing the element destroys the editor (NoteElement cleanup).
    handle.noteEl?.remove();
    handle.noteEl = null;
    handle.content.empty();

    const descriptor = this.notepad?.note(id);
    this.renderCollapsedTitle(handle, descriptor?.title ?? "");
  }

  /** Copy the live editor JSON into the notepad model (change-gated, so
   *  idempotent flushes don't mark the notepad dirty). Notes that were
   *  removed from the manifest are skipped — their editor flush must not
   *  resurrect them. */
  private flushSectionToNotepad(handle: SectionHandle): void {
    if (!this.notepad || !handle.editor || handle.editor.isDestroyed) return;
    if (!this.notepad.note(handle.id)) return;
    const json = handle.editor.getJSON();
    const current = this.notepad.noteContent(handle.id);
    if (current != null && JSON.stringify(current) === JSON.stringify(json)) {
      return;
    }
    this.notepad.setNoteContent(handle.id, json);
  }

  private destroyAllSections(): void {
    for (const handle of this.sections.values()) {
      for (const el of handle.bubbleEls) el.remove();
      handle.noteEl?.remove();
    }
    this.sections.clear();
    this.pendingExpansions.clear();
    // Removing the hosts destroys their editors (NoteElement cleanup).
    this.focusedEditorValue = null;
    if (this.sectionsEl) this.sectionsEl.empty();
    this.showIdleToolbar();
  }

  // ── Editor creation ──

  private async createEditorForSection(
    handle: SectionHandle,
    content: JSONContent,
    opts?: { autofocus?: boolean },
  ): Promise<Editor | null> {
    const notepad = this.notepad;
    if (!notepad) return null;

    // The gfc custom element renders its container asynchronously —
    // retry like NoteView does for the main editor host.
    const editorEl = await this.waitForEditorElement(handle.noteEl);
    if (editorEl == null) return null;
    // The section was collapsed or the view torn down while waiting for
    // the container: building now would bind a detached editor to the
    // shared toolbar and resurrect a dead handle.
    if (handle.noteEl == null || this.sections.get(handle.id) !== handle) {
      return null;
    }

    const editorRef = handle.editorRef;
    const ctx: ImageToolContext = {
      app: this.app,
      noteFile: this.file as TFile,
    };
    const isMobile = Platform.isMobile;
    // The schema family picks the editor profile (spec 8.6): title pages
    // get the title/summary header, regular pages a title-less top node.
    const schemaState = notepad.noteSchemaState(handle.id);
    if (schemaState.kind !== "openable") return null;
    const profile = schemaState.family === UM_SCHEMA_TITLE ? "title" : "plain";

    const editor = new Editor({
      element: editorEl,
      content,
      onError: (err) => console.error("Notepad editor creation failed:", err),
      onUpdate: () => {
        this.dirty = true;
        this.scheduleSave();
      },
      onTransaction: () => {
        // In-document fold persistence (headings + task items). Fold toggles
        // carry no doc change, so this never dirties the container.
        if (!isMobile) this.syncSectionFolds(handle);
      },
      extensions: getExtensions(
        this.buildExtensionHooks(notepad, editorRef, ctx),
        { isMobileView: isMobile, profile },
      ),
      // Search jumps mount pages in the background and must not steal
      // focus from the search input.
      autofocus: opts?.autofocus === false ? false : "start",
    });

    if (editor.view == null) {
      console.error("Notepad editor init failed for note", handle.id);
      return null;
    }
    editorRef.current = editor;
    // NoteElement's cleanup destroys props.editor when the host element is
    // removed (collapse, page removal, view close) — without this the
    // editor instance and its plugins outlive the page.
    if (handle.noteEl != null) {
      handle.noteEl.props.editor = editor;
    }

    editor.on("focus", () => {
      this.focusedEditorValue = editor;
      if (!isMobile) this.ensureToolbar(editor);
      this.updateNavActive();
    });

    editor.registerPlugin(createDocumentSearchPlugin());
    // Non-Latin keyboard layouts: resolve Cmd/Ctrl+letter combos by physical
    // key code and route them through the view (see tools/isPressedCommand).
    editor.registerPlugin(
      createPhysicalShortcutPlugin({
        getCommands: () => editor.registeredShortcuts,
        handleShortcut: (event) => this.handleEditorShortcut(event) === false,
      }),
    );

    if (!isMobile) {
      // The toolbar is always visible: bind it to the most recently
      // expanded page right away (focus re-binds it later).
      this.ensureToolbar(editor);
      this.createBubbleMenus(editor, handle);
      // Restore heading/task folds saved for this page (desktop only —
      // folding is disabled on mobile; mirrors NoteView's device-local
      // fold persistence).
      this.sectionFolds(handle).restore(editor);
    }
    NotepadView.onEditorCreated?.(editor);
    return editor;
  }

  /** Device-local fold persistence for a page, created lazily. The scope is
   *  `<containerPath>/<pageId>` — a page has no file of its own, and a file
   *  path can never have a segment below it, so the join is unambiguous;
   *  the container path is resolved live (rename-safe). */
  private sectionFolds(handle: SectionHandle): FoldPersistence {
    if (handle.folds == null) {
      handle.folds = createFoldPersistence(this.app, () =>
        this.file ? `${this.file.path}/${handle.id}` : null,
      );
    }
    return handle.folds;
  }

  /** Persist the page editor's fold positions (no-op before the editor is
   *  fully built — onTransaction can fire during editor construction). */
  private syncSectionFolds(handle: SectionHandle): void {
    const editor = handle.editorRef.current;
    if (!editor || editor.isDestroyed) return;
    this.sectionFolds(handle).sync(editor);
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
    notepad: UmNotepad,
    editorRef: { current: Editor | null },
    ctx: ImageToolContext,
  ): ExtensionHooks {
    const app = this.app;
    return {
      state: {
        onAdd: (node, deco) => {
          if (node.type.name !== "image") return;
          const key = (deco.spec as { id: string }).id;
          handleAddImgContainer({ ...node.attrs, key }, editorRef, notepad);
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
          imageOnSetViewPropsContainer(props, update, ctx, notepad),
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

  // ── Toolbar (always visible; follows the focused section) ──

  private ensureToolbar(editor: Editor): void {
    if (this.toolbarEl != null && this.toolbarEl.props.editor === editor)
      return;
    this.rebuildToolbar(editor);
  }

  private rebuildToolbar(editor: Editor): void {
    this.destroyToolbar();
    if (!this.toolbarHost) return;
    const toolbarEl = makeToolbarElement();
    toolbarEl.addClass("notepad-toolbar");
    toolbarEl.setAttribute("data-ignore-swipe", "true");
    toolbarEl.props.editor = editor;
    this.toolbarEl = toolbarEl;
    this.toolbarHost.appendChild(toolbarEl);
  }

  private destroyToolbar(): void {
    this.toolbarEl?.remove();
    this.toolbarEl = null;
    this.toolbarHost?.querySelector(".note-toolbar--idle")?.remove();
  }

  /** When the section owning the toolbar collapses, hand the toolbar to
   *  another expanded section; with none left, keep the bar visible as an
   *  empty idle strip so the row never disappears. */
  private rebindOrIdleToolbar(): void {
    for (const handle of this.sections.values()) {
      if (handle.editor != null && !handle.editor.isDestroyed) {
        this.rebuildToolbar(handle.editor);
        return;
      }
    }
    this.showIdleToolbar();
  }

  private showIdleToolbar(): void {
    this.destroyToolbar();
    if (!this.toolbarHost) return;
    if (this.toolbarHost.querySelector(".note-toolbar--idle") == null) {
      this.toolbarHost.createDiv("note-toolbar note-toolbar--idle");
    }
  }

  // ── Pages navigation sidebar (blog-style drawer) ──

  private buildNavSidebar(): void {
    const nav = this.contentEl.createDiv("notepad-nav");
    const toggle = nav.createEl("button", { cls: "notepad-nav-toggle" });
    // ☰ when closed, ✕ when open (CSS morphs between the two glyphs).
    toggle.appendChild(menuSvg());
    toggle.appendChild(closeSvg());
    toggle.setAttribute("aria-label", "Pages");
    toggle.addEventListener("click", () => this.toggleNav());
    this.navListEl = nav.createDiv("notepad-nav-list");
    this.navEl = nav;
    this.rebuildNavList();
  }

  private setNavOpen(open: boolean, opts?: { animate?: boolean }): void {
    this.navOpen = open;
    this.applyNavOpen(open, opts?.animate === true);
    if (open) this.rebuildNavList();
  }

  /** Flip the content column's layout spot behind `mutate` with a FLIP:
   *  measure before/after, paint the column at its old spot via a
   *  transient transform, then release it into the CSS transform
   *  transition. Used for the centered ↔ hugging re-anchor, which is an
   *  auto-margin change CSS cannot interpolate. Rapid re-flips retarget
   *  from the current visual spot (the stale transform cancels out of
   *  both measurements). */
  private flipContentLayout(mutate: () => void): void {
    const sections = this.sectionsEl;
    const view = this.contentEl;
    if (!sections || !view || view.clientWidth === 0) {
      mutate();
      return;
    }
    const before = sections.getBoundingClientRect().left;
    mutate();
    const after = sections.getBoundingClientRect().left;
    const delta = before - after;
    if (Math.abs(delta) < 0.5) return;
    // Paint the column at its pre-layout spot (the helper class suspends
    // the transition), then release it into the base transform transition.
    sections.addClass("nav-flip");
    sections.style.setProperty("--nav-flip-x", `${delta}px`);
    void sections.offsetWidth;
    sections.removeClass("nav-flip");
    // While the released transform animates, the fixed-width column pokes
    // past the scroller edge — the is-flipping class pins the horizontal
    // scrollbar away until it settles (see notepad.css).
    const scroller = this.scrollerEl;
    if (scroller) {
      // A fast re-flip supersedes the previous guard: settle it at once
      // (same task — no paint in between, no scrollbar can flash).
      this.flipSettle?.();
      scroller.addClass("is-flipping");
      const sectionsLocal = sections;
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        this.flipSettle = null;
        scroller.removeClass("is-flipping");
        sectionsLocal.removeEventListener("transitionend", onEnd);
      };
      const onEnd = (event: TransitionEvent): void => {
        // transitionend bubbles — only our own transform transition counts.
        if (event.target !== sections || event.propertyName !== "transform") {
          return;
        }
        settle();
      };
      this.flipSettle = settle;
      sections.addEventListener("transitionend", onEnd);
      // transitionend never fires when the tab is hidden or a re-flip
      // cancelled the transform — time out just past the 0.35s CSS.
      window.setTimeout(settle, 400);
    }
  }

  private applyNavOpen(open: boolean, animate: boolean): void {
    const mutate = () => {
      this.navEl?.toggleClass("is-open", open);
      // Container-level mirror of the open state: the push-mode CSS
      // (scroller margin, column re-anchor) applies only while open.
      this.contentEl?.toggleClass("notepad-nav-open", open);
    };
    if (animate) this.flipContentLayout(mutate);
    else mutate();
    if (open) this.rebuildNavList();
  }

  private toggleNav(): void {
    this.setNavOpen(!this.navOpen, { animate: true });
  }

  /** True when the whole content column fits right of the OPEN drawer —
   *  drives push-vs-overlay, the boot default-open decision and the
   *  click-on-content dismissal. Mobile never fits. The check counts only
   *  the LEFT scroller padding (the visual gap to the drawer): the right
   *  padding is empty while pushed (styles/notepad.css drops it) and must
   *  not steal the fit. The vertical scrollbar is measured and subtracted —
   *  it eats the pushed scroller's content box, and a fit that ignores it
   *  shrinks the column. The column itself never shrinks for the drawer's
   *  sake: when it would not fit, the drawer overlays it instead (shadow),
   *  per the owner's call (2026-09-26). */
  private navFits(): boolean {
    if (Platform.isMobile) return false;
    const scroller = this.scrollerEl;
    const sections = this.sectionsEl;
    if (!scroller || !sections) return false;
    const max = parseFloat(getComputedStyle(sections).maxWidth);
    if (!Number.isFinite(max)) return false;
    const pad = getComputedStyle(scroller);
    const padLeft = parseFloat(pad.paddingLeft) || 0;
    // The container itself must not hold side padding either — it is zeroed
    // in styles/notepad.css, but the check reads the live value so a future
    // theme change cannot silently skew the fit.
    const container = getComputedStyle(this.contentEl);
    const containerPadX =
      (parseFloat(container.paddingLeft) || 0) +
      (parseFloat(container.paddingRight) || 0);
    return (
      this.contentEl.clientWidth -
      containerPadX -
      NAV_WIDTH -
      padLeft -
      this.scrollbarWidth() >=
      max
    );
  }

  /** Layout width of a vertical scrollbar in this renderer (0 for overlay
   *  scrollbars). The live scroller only shows it once its content
   *  overflows — which is exactly what the fit check must predict: pushing
   *  narrows the column, the reflow grows taller, the scrollbar appears and
   *  eats the width it was not reserved. Measured on a hidden probe inside
   *  the scroller, so any scoped scrollbar styling is inherited. */
  private scrollbarWidth(): number {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;top:0;left:0;height:100px;width:100px;overflow-y:scroll;visibility:hidden;pointer-events:none;";
    this.scrollerEl.appendChild(probe);
    const width = probe.offsetWidth - probe.clientWidth;
    probe.remove();
    return width;
  }

  /** Keep push vs overlay in step with the live view width (window
   *  resizes, leaf splits); the observer's initial callback re-runs this
   *  after layout, so the boot decision never sees a 0-width container.
   *  The first call also applies the default state: open when the column
   *  fits, closed otherwise. Later resizes never override the user's
   *  choice — but an open drawer switching modes glides its column. */
  private updateNavMode(): void {
    const fits = this.navFits();
    if (
      this.navOpen &&
      this.contentEl?.hasClass("notepad-nav-push") !== fits
    ) {
      this.flipContentLayout(() =>
        this.contentEl?.toggleClass("notepad-nav-push", fits),
      );
    } else {
      this.contentEl?.toggleClass("notepad-nav-push", fits);
    }
    if (!this.navBooted) {
      this.navBooted = true;
      if (fits) this.setNavOpen(true);
    }
  }

  private rebuildNavList(): void {
    if (!this.navListEl || !this.notepad) return;
    this.navListEl.empty();
    for (const descriptor of this.notepad.notes()) {
      const item = this.navListEl.createDiv("notepad-nav-item");
      item.setAttribute("data-id", descriptor.id);
      const numb = item.createDiv("notepad-nav-numb");
      if (descriptor.order > 0) numb.setText(String(descriptor.order));
      const header = item.createDiv("notepad-nav-header");
      const title = (descriptor.title ?? "").trim();
      if (title) header.setText(title);
      else {
        header.addClass("is-empty");
        header.setText("Untitled");
      }
      if (!this.notepad.isNoteOpenable(descriptor.id)) {
        item.addClass("is-unsupported");
      }
      if (this.isNavActive(descriptor.id)) item.addClass("is-active");
      item.addEventListener("click", () => this.jumpToPage(descriptor.id));
    }
  }

  private isNavActive(id: string): boolean {
    const focused = this.focusedEditorValue;
    if (focused == null) return false;
    for (const handle of this.sections.values()) {
      if (handle.editor === focused) return handle.id === id;
    }
    return false;
  }

  private updateNavActive(): void {
    const items = this.navListEl?.querySelectorAll(".notepad-nav-item");
    if (!items) return;
    for (const item of items) {
      const id = item.getAttribute("data-id");
      item.classList.toggle("is-active", id != null && this.isNavActive(id));
    }
  }

  /** Programmatic jumps (toc clicks, search matches) glide like the blog's
   *  toc; users who prefer reduced motion get instant jumps. */
  private scrollBehavior(): ScrollBehavior {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
  }

  /** Open (if needed) a page and scroll its frame to the top of the view. */
  private jumpToPage(id: string): void {
    const handle = this.sections.get(id);
    if (!handle || !this.notepad) return;
    if (handle.editor == null) {
      // No mount autofocus: the smooth scroll below must own the movement —
      // an editor scrolling itself into view would snap the jump.
      void this.expandSection(id, { focus: false, autofocus: false });
    }
    window.setTimeout(() => {
      const scroller = this.scrollerEl;
      const root = handle.root;
      if (!scroller || !root.isConnected) return;
      const sRect = scroller.getBoundingClientRect();
      const rRect = root.getBoundingClientRect();
      scroller.scrollTo({
        top: scroller.scrollTop + rRect.top - sRect.top - 12,
        behavior: this.scrollBehavior(),
      });
      this.updateNavActive();
    }, 60);
    // Focus the page once the glide has settled: an immediate focus()
    // scrolls instantly and kills the animation. The glide ends with the
    // page frame at the top of the view, so this focus scrolls nothing.
    window.setTimeout(() => {
      const editor = handle.editor;
      if (editor && !editor.isDestroyed) editor.view.focus();
    }, 680);
  }

  private scrollContainerTo(container: Element, docTop: number): void {
    const rect = container.getBoundingClientRect();
    container.scrollTo({
      top: container.scrollTop + docTop - (rect.top + rect.height / 3),
      behavior: this.scrollBehavior(),
    });
  }

  // ── Drag & drop reorder (pointer drag on the section gutter) ──

  private onGutterPointerDown(event: PointerEvent, id: string): void {
    if (event.button !== 0) return;
    this.drag = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    window.addEventListener("pointermove", this.onDragPointerMove);
    window.addEventListener("pointerup", this.onDragPointerUp);
  }

  private onDragPointerMove = (event: PointerEvent): void => {
    if (!this.drag) return;
    const handle = this.sections.get(this.drag.id);
    if (!handle) return;

    if (!this.drag.active) {
      const moved = Math.hypot(
        event.clientX - this.drag.startX,
        event.clientY - this.drag.startY,
      );
      if (moved < 6) return;
      this.drag.active = true;
      handle.root.addClass("is-dragging");
      this.dropLineEl = this.sectionsEl?.createDiv("notepad-drop-line");
    }
    this.updateDropLine(event.clientY);
  };

  private onDragPointerUp = (event: PointerEvent): void => {
    window.removeEventListener("pointermove", this.onDragPointerMove);
    window.removeEventListener("pointerup", this.onDragPointerUp);
    const drag = this.drag;
    this.drag = null;
    this.dropLineEl?.remove();
    this.dropLineEl = null;
    if (!drag) return;

    const handle = this.sections.get(drag.id);
    handle?.root.removeClass("is-dragging");
    if (!drag.active) return; // plain click — the gutter click toggles
    // Swallow the click that follows a completed drag.
    this.suppressGutterToggle = true;
    window.setTimeout(() => {
      this.suppressGutterToggle = false;
    }, 0);

    const dropIndex = this.computeDropIndex(event.clientY, drag.id);
    if (dropIndex == null) return;
    if (this.notepad?.moveNote(drag.id, dropIndex)) {
      this.render();
      void this.flushSave("drag-reorder");
    }
  };

  /** The title page's note id (order 0) — excluded from drag geometry. */
  private titleSectionId(): string | null {
    return this.notepad?.notes().find((d) => d.order === 0)?.id ?? null;
  }

  private computeDropIndex(clientY: number, dragId: string): number | null {
    const titleId = this.titleSectionId();
    const others = [...this.sections.values()]
      .filter((h) => h.id !== dragId && h.id !== titleId)
      .map((h) => ({ id: h.id, rect: h.root.getBoundingClientRect() }))
      .sort((a, b) => a.rect.top - b.rect.top);
    if (others.length === 0) return null;
    let index = 0;
    for (const other of others) {
      if (clientY > other.rect.top + other.rect.height / 2) index++;
    }
    // The title page is fixed at index 0 — a drop never lands above page 1
    // (spec 9.1: the cover cannot be reordered).
    return Math.max(index, 1);
  }

  private updateDropLine(clientY: number): void {
    if (!this.dropLineEl || !this.drag || !this.sectionsEl) return;
    const titleId = this.titleSectionId();
    const others = [...this.sections.values()]
      .filter((h) => h.id !== this.drag.id && h.id !== titleId)
      .map((h) => ({ root: h.root }))
      .sort((a, b) => a.root.offsetTop - b.root.offsetTop);
    let top: number | null = null;
    for (const other of others) {
      const rect = other.root.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        top = other.root.offsetTop - 4;
        break;
      }
    }
    if (top == null) {
      const last = others[others.length - 1];
      top = last ? last.root.offsetTop + last.root.offsetHeight - 2 : 0;
    }
    this.dropLineEl.style.top = `${top}px`;
  }

  // ── Notepad-wide search ──

  openNotepadSearch(): void {
    this.buildSearchPanel();
    const input = this.searchInputEl;
    if (!input) return;
    input.focus();
    input.select();
    if (input.value) this.recomputeSearch();
  }

  private closeNotepadSearch(): void {
    this.searchPanelEl?.remove();
    this.searchPanelEl = null;
    this.searchInputEl = null;
    this.searchCountEl = null;
    this.searchMatches = [];
    this.setSearchQueryOnExpandedEditors(null);
  }

  private buildSearchPanel(): void {
    if (this.searchPanelEl) return;
    const panel = this.contentEl.createDiv("notepad-search");
    this.searchPanelEl = panel;

    const input = panel.createEl("input", {
      cls: "notepad-search-input",
      attr: {
        type: "text",
        placeholder: "Search notepad",
        spellcheck: "false",
      },
    });
    this.searchInputEl = input;
    input.addEventListener("input", () => this.recomputeSearch());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.moveSearchMatch(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeNotepadSearch();
      }
    });

    this.searchCountEl = panel.createDiv("notepad-search-count");

    const prev = panel.createEl("button", { cls: "notepad-search-btn" });
    setIcon(prev, "chevron-up");
    prev.setAttribute("aria-label", "Previous match");
    prev.addEventListener("click", () => this.moveSearchMatch(-1));

    const next = panel.createEl("button", { cls: "notepad-search-btn" });
    setIcon(next, "chevron-down");
    next.setAttribute("aria-label", "Next match");
    next.addEventListener("click", () => this.moveSearchMatch(1));

    const close = panel.createEl("button", { cls: "notepad-search-btn" });
    setIcon(close, "x");
    close.setAttribute("aria-label", "Close search");
    close.addEventListener("click", () => this.closeNotepadSearch());
  }

  private recomputeSearch(): void {
    const notepad = this.notepad;
    const query = this.searchInputEl?.value ?? "";
    if (!notepad) return;
    // Unsaved editor changes must be visible to the search.
    for (const handle of this.sections.values()) {
      this.flushSectionToNotepad(handle);
    }
    this.searchMatches = searchNotepad(
      notepad
        .notes()
        // Pages this editor cannot interpret keep their content verbatim —
        // searching raw unknown-schema JSON would only produce junk jumps.
        .filter((descriptor) => notepad.isNoteOpenable(descriptor.id))
        .map((descriptor) => ({
          id: descriptor.id,
          title: descriptor.title ?? "",
          doc: notepad.noteContent(descriptor.id) ?? {
            type: "noteDoc" as const,
          },
        })),
      query,
    );
    this.searchIndex = 0;
    this.updateSearchCount();
    this.setSearchQueryOnExpandedEditors(query || null);
    this.jumpToCurrentMatch();
  }

  private setSearchQueryOnExpandedEditors(query: string | null): void {
    for (const handle of this.sections.values()) {
      const editor = handle.editor;
      if (!editor || editor.isDestroyed) continue;
      editor.view.dispatch(
        editor.state.tr.setMeta(
          documentSearchKey,
          query ? { query, activeIndex: 0 } : { clear: true },
        ),
      );
    }
  }

  private updateSearchCount(): void {
    if (!this.searchCountEl) return;
    this.searchCountEl.setText(
      this.searchMatches.length > 0
        ? `${this.searchIndex + 1}/${this.searchMatches.length}`
        : "0 results",
    );
  }

  private moveSearchMatch(direction: number): void {
    if (this.searchMatches.length === 0) return;
    this.searchIndex =
      (this.searchIndex + direction + this.searchMatches.length) %
      this.searchMatches.length;
    this.updateSearchCount();
    this.jumpToCurrentMatch();
  }

  private jumpToCurrentMatch(): void {
    const match = this.searchMatches[this.searchIndex];
    if (!match) return;
    const handle = this.sections.get(match.noteId);
    if (!handle) return;
    if (handle.editor != null) {
      this.revealSearchMatch(match);
      return;
    }
    // Mount the page quietly (no autofocus): the search input keeps focus.
    void this.expandSection(match.noteId, {
      focus: false,
      autofocus: false,
    }).then(() => this.revealSearchMatch(match));
  }

  /** Browser-search behavior: scroll to the match and mark it with the
   *  active highlight. NO selection and NO focus change — the search input
   *  keeps the focus so the user can keep typing / navigating. */
  private revealSearchMatch(match: NotepadSearchMatch): void {
    const handle = this.sections.get(match.noteId);
    const editor = handle?.editor;
    if (!editor || editor.isDestroyed) return;

    // The ordinal of this match among its page's matches drives the
    // active-decoration of the page's search plugin.
    let localIndex = 0;
    for (let i = 0; i < this.searchIndex; i++) {
      if (this.searchMatches[i].noteId === match.noteId) localIndex++;
    }
    const query = this.searchInputEl?.value ?? "";
    editor.view.dispatch(
      editor.state.tr.setMeta(documentSearchKey, {
        query,
        activeIndex: localIndex,
      }),
    );

    try {
      const coords = editor.view.coordsAtPos(match.from);
      const editorScroller = editor.view.dom.closest(".texto-editor");
      if (editorScroller) this.scrollContainerTo(editorScroller, coords.top);
      if (this.scrollerEl) this.scrollContainerTo(this.scrollerEl, coords.top);
    } catch (err) {
      // Position drift after edits — the highlight set stays as-is.
      console.error("Failed to scroll to search match:", err);
    }
  }

  /** Scroll a scrollable ancestor so the viewport coordinate `docTop` sits
   *  about a third from the container's top. */
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
    // Required prop of the media menu (open/delete actions route through
    // the app); without it the element's generator never starts.
    mediaBubbleMenuEl.props.app = this.app;

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
    const notepad = this.notepad;
    if (!notepad) return;
    const notes = notepad.notes();
    const lastId = notes[notes.length - 1]?.id;
    const added = notepad.addNote(lastId, "");
    // Open the new page for editing right away and remember it expanded.
    notepad.setExpanded(added.id, true);
    this.render();
    void this.flushSave("add-note");
  }

  /** Insert a new note right after the given section (per-section + control). */
  private addNoteAfter(id: string): void {
    const notepad = this.notepad;
    if (!notepad || !notepad.note(id)) return;
    const added = notepad.addNote(id, "");
    notepad.setExpanded(added.id, true);
    this.render();
    void this.flushSave("add-note");
  }

  /** Deep-copy a page right after the original (image assets stay shared).
   *  The title page cannot be duplicated (spec 9.1); neither can a page
   *  this editor cannot interpret — its content is preserved as-is. */
  private duplicateNote(id: string): void {
    const notepad = this.notepad;
    const descriptor = notepad?.note(id);
    if (!notepad || !descriptor) return;
    if (descriptor.order === 0 || !notepad.isNoteOpenable(id)) return;
    const copy = notepad.duplicateNote(id);
    if (!copy) return;
    this.render();
    void this.flushSave("duplicate-note");
  }

  /** Remove a section's note after an explicit confirmation. Right after the
   *  deletion an Undo notice offers to put it back (the save chain keeps the
   *  delete and undo writes in order). The title page cannot be deleted
   *  (spec 9.1); neither can a page this editor cannot interpret. */
  private deleteNote(id: string): void {
    const notepad = this.notepad;
    const descriptor = notepad?.note(id);
    if (!notepad || !descriptor) return;
    if (descriptor.order === 0 || !notepad.isNoteOpenable(id)) return;

    new ConfirmModal(this.app, {
      title: "Delete note",
      message: "The page will be deleted. Continue?",
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: () => {
        if (this.notepad == null || this.notepad.note(id) == null) return;
        const removed = this.notepad.removeNote(id);
        if (removed == null) return;
        this.pendingExpansions.delete(id);
        this.render();
        void this.flushSave("delete-note");

        const name = removed.descriptor.title?.trim();
        const notice = new Notice(
          name ? `Note "${name}" deleted` : "Note deleted",
          7000,
        );
        this.addNoticeAction(notice, "Undo", () => {
          if (this.notepad == null) return;
          // The restored descriptor carries its persisted expanded flag.
          this.notepad.restoreNote(removed);
          this.render();
          void this.flushSave("undo-delete");
        });
      },
    }).open();
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
      cls: "notepad-notice-action",
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

  private async flushSave(trigger = "autosave", force = false): Promise<void> {
    const run = this.saveChain.then(() =>
      this.writePendingChanges(trigger, force),
    );
    this.saveChain = run.catch(() => {});
    return run;
  }

  private async writePendingChanges(
    trigger: string,
    force = false,
  ): Promise<void> {
    const notepad = this.notepad;
    const file = this.file;
    if (!notepad || !file) return;
    if (this.saveTimer != null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    for (const handle of this.sections.values()) {
      this.flushSectionToNotepad(handle);
    }
    if (!force && notepad.dirtyNotes.size === 0 && !notepad.structureChanged) {
      this.dirty = false;
      return;
    }

    // Clear the flags before the write, not after: writeUmFile serializes
    // synchronously, so the snapshot covers exactly this dirty state, while
    // an edit landing during the disk wait (e.g. flushed by a collapse)
    // keeps its flag and is written by the next save.
    const dirtySnapshot = new Set(notepad.dirtyNotes);
    const structureSnapshot = notepad.structureChanged;
    notepad.dirtyNotes.clear();
    notepad.structureChanged = false;
    this.dirty = false;

    try {
      await writeUmFile(file, this.app.vault, notepad, trigger);
    } catch (err) {
      // Nothing reached the disk — restore the flags so the next flush
      // retries the same content.
      for (const id of dirtySnapshot) notepad.dirtyNotes.add(id);
      notepad.structureChanged = structureSnapshot || notepad.structureChanged;
      this.dirty = true;
      new Notice(`Failed to save notepad: ${String(err)}`);
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
    const notepad = this.notepad;
    const file = this.file;
    if (!notepad || !file || this.conflictModalOpen) return;

    const fingerprint = await umFingerprint(this.app.vault, file);
    if (fingerprint === notepad.savedFingerprint) return; // our own save

    if (
      notepad.dirtyNotes.size > 0 ||
      notepad.structureChanged ||
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

  /** Unconditional write (conflict resolution: local version wins). Chained
   *  like every other save: an in-flight autosave must not land after it
   *  and overwrite the chosen version. */
  private writeNow(trigger: string): Promise<void> {
    return this.flushSave(trigger, true);
  }

  /** Replace the in-memory notepad and the UI with the on-disk state. */
  private async reloadFromDisk(): Promise<void> {
    const file = this.file;
    if (!file) return;
    try {
      const fresh = await readUmFile(file, this.app.vault);
      fresh.savedFingerprint = await umFingerprint(this.app.vault, file);
      this.destroyAllSections();
      this.notepad?.destroy();
      this.notepad = fresh;
      this.dirty = false;
      // Keep the user's expansion state across the reload.
      this.render();
    } catch (err) {
      console.error("Failed to reload notepad from disk:", err);
    }
  }
}
