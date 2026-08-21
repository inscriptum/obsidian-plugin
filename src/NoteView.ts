import { FileView, WorkspaceLeaf, TFile, Notice, Platform } from "obsidian";
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
  type PhoneNavMode,
  NAV_MODE_STORAGE_KEY,
  DEFAULT_PHONE_NAV_MODE,
  nextPhoneNavMode,
  parsePhoneNavMode,
} from "./components/toolbar/phoneNavMode";
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

  // ── Phone navbar integration (reuse Obsidian's native mobile navbar) ──
  // On phones Obsidian renders a fixed `.mobile-navbar.mod-raised`. We reuse it
  // as the container for our editor toolbar: a toggle injected into the navbar
  // swaps between Obsidian's native controls (`native` mode) and our editor
  // toolbar docked inside the same navbar (`our` mode). On iPad (no navbar)
  // our toolbar stays a separate docked bar (flex layout in mobile.css).
  private currentToolbarEl: HTMLElement | null = null;
  private navbarToggleEl: HTMLElement | null = null;
  private phoneNavIntegrated = false;
  private phoneNavMode: PhoneNavMode = DEFAULT_PHONE_NAV_MODE;
  private scrollShadowCleanup: (() => void) | null = null;

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

  /** Mobile layout is gated on Platform.isMobile ("UI is in mobile mode").
      It is true on real mobile and also when Obsidian runs in mobile emulation
      (`app.emulateMobile(true)`), so it reflects the actual UI mode. */
  private isMobileView(): boolean {
    return Platform.isMobile;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("note-view-container");

    if (this.isMobileView()) {
      this.setupMobileNavbarOffset();
    }

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", async (leaf) => {
        if (leaf?.view === this) {
          await this.reloadFromDisk();
        }
      }),
    );
  }

  private mobileNavbarObserver: MutationObserver | null = null;

  /** Keep our bottom toolbar clear of Obsidian's native mobile navbar by
      reserving its height as bottom padding on our container. */
  private setupMobileNavbarOffset(): void {
    const update = () => {
      this.syncMobileNavbarOffset();
      // Integrate our toolbar into the navbar once both exist. Idempotent.
      this.setupPhoneNavbar();
    };
    update();

    // The native navbar may appear after the view opens, so watch the DOM
    // and re-measure when it is added.
    const observer = new MutationObserver(() => update());
    observer.observe(document.body, { childList: true, subtree: true });
    this.mobileNavbarObserver = observer;

    // Belt-and-suspenders: retry for a few seconds after open.
    for (const delay of [120, 300, 600, 1000, 1800, 3000]) {
      window.setTimeout(update, delay);
    }

    this.registerEvent(this.app.workspace.on("resize", update));
    this.registerDomEvent(window, "resize", update);
    this.registerDomEvent(window, "orientationchange", update);
    if (window.visualViewport) {
      this.registerDomEvent(window.visualViewport, "resize", update);
      this.registerDomEvent(window.visualViewport, "scroll", update);
    }
  }

  private syncMobileNavbarOffset(): void {
    const navbar = document.querySelector<HTMLElement>(
      ".mobile-navbar, .mobile-navbar.mod-raised",
    );
    if (!navbar) {
      this.contentEl.style.paddingBottom = "";
      return;
    }
    const rect = navbar.getBoundingClientRect();
    // Ignore a navbar that exists in the DOM but isn't actually rendered
    // (zero size) — e.g. the desktop Obsidian shell keeps the element while
    // showing its desktop UI. Reserving its "height" here would collapse the
    // whole note view (the container is height:100% + border-box). Only
    // reserve when the bar is genuinely laid out with a real size.
    if (rect.width === 0 || rect.height === 0) {
      this.contentEl.style.paddingBottom = "";
      return;
    }
    this.contentEl.style.paddingBottom = `${rect.height}px`;
  }

  // ── Phone navbar: toggle + reuse as our toolbar container ──

  /** The phone navbar, if present and actually laid out (non-zero size).
      On desktop Obsidian keeps a zero-size `.mobile-navbar` in the DOM; we
      ignore those and return the first genuinely laid-out one (there is
      normally exactly one on a phone). */
  private getPhoneNavbar(): HTMLElement | null {
    const navbars = document.querySelectorAll<HTMLElement>(
      ".mobile-navbar.mod-raised",
    );
    for (const navbar of Array.from(navbars)) {
      const rect = navbar.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return navbar;
    }
    return null;
  }

  private loadPhoneNavMode(): PhoneNavMode {
    try {
      return parsePhoneNavMode(window.localStorage.getItem(NAV_MODE_STORAGE_KEY));
    } catch {
      return DEFAULT_PHONE_NAV_MODE;
    }
  }

  private savePhoneNavMode(mode: PhoneNavMode): void {
    try {
      window.localStorage.setItem(NAV_MODE_STORAGE_KEY, mode);
    } catch {
      /* storage unavailable — non-fatal */
    }
  }

  /** Build the toggle button injected into the native navbar. */
  private createNavbarToggle(): HTMLElement {
    const btn = createEl("button");
    btn.className = "inscriptum-nav-toggle";
    btn.type = "button";
    btn.setAttribute("aria-label", "Toggle editor toolbar");
    btn.title = "Toggle editor toolbar";
    const svg = createSvg("svg", {
      attr: {
        viewBox: "0 0 24 24",
        width: "22",
        height: "22",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.8",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
    });
    const rect = createSvg("rect", {
      attr: { x: "3", y: "7", width: "18", height: "10", rx: "3" },
    });
    const circle = createSvg("circle", {
      attr: { cx: "9", cy: "12", r: "2.2", fill: "currentColor", stroke: "none" },
    });
    svg.append(rect, circle);
    btn.appendChild(svg);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.flipPhoneNavMode();
    });
    return btn;
  }

  /** Reflect the current mode on the navbar + toggle (CSS does the rest). */
  private applyPhoneNavMode(): void {
    const navbar = this.getPhoneNavbar();
    if (!navbar) return;
    navbar.classList.toggle("mod-our-menu", this.phoneNavMode === "our");
    if (this.navbarToggleEl) {
      const isOur = this.phoneNavMode === "our";
      this.navbarToggleEl.setAttribute("aria-pressed", String(isOur));
      this.navbarToggleEl.classList.toggle("is-active", isOur);
    }
    // The navbar height may change between modes — re-reserve space.
    this.syncMobileNavbarOffset();
  }

  private flipPhoneNavMode(): void {
    this.phoneNavMode = nextPhoneNavMode(this.phoneNavMode);
    this.savePhoneNavMode(this.phoneNavMode);
    this.applyPhoneNavMode();
  }

  /** Move our toolbar into the navbar and inject the toggle. Idempotent. */
  private setupPhoneNavbar(): void {
    if (this.phoneNavIntegrated) return;
    const navbar = this.getPhoneNavbar();
    if (!navbar || !this.currentToolbarEl) return;
    // Don't connect the toolbar element until its required `editor` prop is
    // set. If we append it earlier, the web component's connectedCallback
    // bails (required prop missing) and never creates a render generation,
    // so the toolbar stays empty even after `editor` arrives later.
    const tb = this.currentToolbarEl as unknown as { props?: { editor?: unknown } };
    if (!tb.props || !tb.props.editor) return;

    // Relocate our toolbar inside the reused navbar (appendChild moves it).
    navbar.appendChild(this.currentToolbarEl);

    if (!this.navbarToggleEl) {
      this.navbarToggleEl = this.createNavbarToggle();
    }
    navbar.appendChild(this.navbarToggleEl);

    this.phoneNavMode = this.loadPhoneNavMode();
    this.phoneNavIntegrated = true;
    this.applyPhoneNavMode();

    // Fade the scrollable toolbar/selection-bar edges when more items are
    // reachable in that direction (see scrollShadow.ts).
    this.scrollShadowCleanup?.();
    this.scrollShadowCleanup = setupScrollShadows(navbar);
  }

  /** Remove our toggle + toolbar from the navbar and reset state. */
  private teardownPhoneNavbar(): void {
    this.scrollShadowCleanup?.();
    this.scrollShadowCleanup = null;
    const navbar = this.getPhoneNavbar();
    if (navbar) {
      navbar.classList.remove("mod-our-menu");
      this.navbarToggleEl?.remove();
    }
    this.currentToolbarEl?.remove();
    this.currentToolbarEl = null;
    this.navbarToggleEl = null;
    this.phoneNavIntegrated = false;
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.destroyEditor();
    this.contentEl.empty();
    // Clear any navbar integration left over from the previous file.
    this.teardownPhoneNavbar();

    const content = await readNote(file, this.app.vault);
    const noteEl = new NoteElement();
    noteEl.addClass("texto-editor-host");
    const toolbarEl = new ToolbarElement();
    toolbarEl.addClass("note-toolbar-host");
    this.currentToolbarEl = toolbarEl;
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
        this.syncMobileNavbarOffset();
        window.setTimeout(() => this.syncMobileNavbarOffset(), 350);
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
            this.mountMobileToolbar(toolbarEl);
          }, 100);
        });
      }
    });

    this.contentEl.appendChild(noteEl);
  }

  /** Decide where our toolbar lives on mobile.
      iPad (no navbar): dock as a flex sibling in the content.
      Phone (navbar present): relocate it inside the native navbar and wire
      the toggle. If the navbar appears later, the navbar observer triggers
      the same integration. */
  private mountMobileToolbar(toolbarEl: HTMLElement): void {
    if (!this.isMobileView()) {
      this.contentEl.insertAdjacentElement("afterbegin", toolbarEl);
      return;
    }
    if (this.getPhoneNavbar()) {
      this.setupPhoneNavbar();
    } else {
      this.contentEl.insertAdjacentElement("afterbegin", toolbarEl);
    }
  }

  async onUnloadFile(file: TFile): Promise<void> {
    await this.flushSave();
    this.destroyEditor();
    this.teardownPhoneNavbar();
    this.contentEl.empty();
  }

  async onClose(): Promise<void> {
    this.mobileNavbarObserver?.disconnect();
    this.mobileNavbarObserver = null;
    this.teardownPhoneNavbar();
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
