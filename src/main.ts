import "./styles/editor.css";
import {
  Notice,
  normalizePath,
  Plugin,
  setIcon,
  TFolder,
  WorkspaceLeaf,
} from "obsidian";
import { NoteView, NOTE_VIEW_TYPE } from "./NoteView";
import { installIconSprite } from "./components/icons/iconSprite";
import { createEmptyNote } from "./storage/noteStorage";
import { NewNoteModal } from "./ui/NewNoteModal";
import {
  findCommandsCollidingWith,
  nameToKeyboardEvent,
  type CommandLike,
} from "./tools/isPressedCommand";
import type { JSONContent } from "./texto/core/@types";

/** Runtime shape of the command registry. Obsidian's public typings omit
 *  `App.commands`, but it exists at runtime: `app.commands.commands`
 *  maps command id → Command. */
type CommandRegistry = { commands: Record<string, CommandLike> };

export default class NotesPlugin extends Plugin {
  private fileExplorerObserver: MutationObserver | null = null;
  private patchedCommands: Array<{
    command: CommandLike;
    kind: "checkCallback" | "callback" | "editorCallback";
    original: unknown;
  }> = [];

  async onload(): Promise<void> {
    installIconSprite();

    this.registerExtensions(["note"], NOTE_VIEW_TYPE);

    this.registerView(
      NOTE_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new NoteView(leaf),
    );

    // Obsidian's own command hotkeys (e.g. "Toggle bold" on Mod+b) match by
    // `event.key` and swallow Cmd/Ctrl+letter combos before they reach the
    // editor DOM — on macOS the key under Meta is always Latin, so this hits
    // every layout. Patch the colliding commands: while a NoteView is active
    // they route the combo into our editor, otherwise the original behavior
    // runs. See src/tools/isPressedCommand.ts for the full rationale.
    NoteView.onEditorCreated = (editor) => {
      this.patchCollidingCommands(editor.registeredShortcuts);
    };
    this.register(() => {
      NoteView.onEditorCreated = null;
      this.restorePatchedCommands();
    });

    this.addRibbonIcon("notebook-pen", "New inscriptum", () => {
      this.createNewNote();
    });

    this.addCommand({
      id: "create-new-note",
      name: "New note",
      callback: () => {
        this.createNewNote();
      },
    });

    this.addCommand({
      id: "find-in-note",
      name: "Find in current note",
      icon: "search",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(NoteView);
        if (!view) return false;
        if (!checking) view.openSearch();
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFolder)) return;

        menu.addItem((item) =>
          item
            .setTitle("New inscriptum")
            .setIcon("notebook-pen")
            .onClick(() => this.createNewNote(file.path)),
        );
      }),
    );

    // Add a "New inscriptum" button next to the standard "New note" button in
    // the file explorer (visible on both desktop and mobile). The ribbon icon
    // is hidden inside the left sidebar on mobile, and the folder context-menu
    // item is only reachable by long-pressing a folder, so a direct button is
    // the discoverable entry point.
    this.app.workspace.onLayoutReady(() => {
      this.ensureFileExplorerButton();
      this.observeFileExplorer();
    });
  }

  /** Patch every command whose hotkey physically collides with an editor
   *  shortcut so NoteView can handle the combo (idempotent). */
  private patchCollidingCommands(shortcuts: Set<string>): void {
    if (this.patchedCommands.length) return;
    // "Mod-f" (find in note) and "Mod-k" (link layer) are handled by
    // NoteView.handleEditorShortcut but are not extension shortcuts.
    // Obsidian's public typings omit `App.commands`, but it exists at runtime.
    // NOTE: app.commands is the registry wrapper; the id → Command record is
    // app.commands.commands — do not drop the second `.commands`.
    const registry = (this.app as unknown as { commands: CommandRegistry })
      .commands.commands;
    const collisions = findCommandsCollidingWith(registry, [
      ...shortcuts,
      "Mod-f",
      "Mod-k",
    ]);
    for (const [id, ownedNames] of collisions) {
      const command = registry[id];
      if (!command) continue;

      if (typeof command.checkCallback === "function") {
        const original = command.checkCallback;
        command.checkCallback = (checking: boolean): boolean => {
          if (this.routeToNoteView(ownedNames, checking)) return true;
          return original.call(command, checking);
        };
        this.patchedCommands.push({ command, kind: "checkCallback", original });
      } else if (typeof command.callback === "function") {
        const original = command.callback;
        command.callback = (): void => {
          if (!this.routeToNoteView(ownedNames, false)) original.call(command);
        };
        this.patchedCommands.push({ command, kind: "callback", original });
      } else if (typeof command.editorCallback === "function") {
        const original = command.editorCallback;
        command.editorCallback = (editor: unknown, view: unknown): void => {
          if (!this.routeToNoteView(ownedNames, false))
            original.call(command, editor, view);
        };

        this.patchedCommands.push({
          command,
          kind: "editorCallback",
          original,
        });
      }
    }
  }

  /** Route a colliding command into the active NoteView editor. Returns true
   *  when the combo was consumed (or is claimable while checking). */
  private routeToNoteView(ownedNames: string[], checking: boolean): boolean {
    const view = this.app.workspace.getActiveViewOfType(NoteView);
    if (!view?.hasEditor) return false;
    if (checking) return true;
    for (const name of ownedNames) {
      const event = nameToKeyboardEvent(name);
      if (event) view.handleEditorShortcut(event);
    }
    return true;
  }

  private restorePatchedCommands(): void {
    for (const { command, kind, original } of this.patchedCommands) {
      if (kind === "checkCallback")
        command.checkCallback = original as CommandLike["checkCallback"];
      else if (kind === "callback")
        command.callback = original as CommandLike["callback"];
      else if (kind === "editorCallback")
        command.editorCallback = original as CommandLike["editorCallback"];
    }
    this.patchedCommands = [];
  }

  /** Insert (once) a "New inscriptum" button right after the file explorer's
   *  standard "New note" button. Re-adds itself if Obsidian re-renders the bar. */
  private ensureFileExplorerButton(): void {
    const container = document.querySelector<HTMLElement>(
      '.workspace-leaf-content[data-type="file-explorer"] .nav-buttons-container',
    );
    if (!container) return;
    if (container.querySelector(".inscriptum-nav-new-note")) return;

    const button = document.createElement("div");
    button.className =
      "clickable-icon nav-action-button inscriptum-nav-new-note";
    button.setAttribute("aria-label", "New inscriptum");
    button.setAttribute("type", "button");
    setIcon(button, "notebook-pen");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      this.createNewNote();
    });

    const newNoteBtn =
      container.querySelector<HTMLElement>(".nav-action-button");
    if (newNoteBtn?.nextSibling) {
      container.insertBefore(button, newNoteBtn.nextSibling);
    } else {
      container.appendChild(button);
    }
  }

  /** Re-add the file explorer button whenever Obsidian rebuilds the nav bar. */
  private observeFileExplorer(): void {
    if (this.fileExplorerObserver) return;
    let scheduled = false;
    this.fileExplorerObserver = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        this.ensureFileExplorerButton();
      }, 200);
    });
    this.fileExplorerObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  async onunload(): Promise<void> {
    this.fileExplorerObserver?.disconnect();
    this.fileExplorerObserver = null;
    document.querySelector(".inscriptum-nav-new-note")?.remove();
  }

  private createNewNote(initialFolderPath?: string) {
    const activeFile = this.app.workspace.getActiveFile();
    const defaultFolder =
      initialFolderPath !== undefined
        ? (this.app.vault.getFolderByPath(initialFolderPath) ??
          this.app.vault.getRoot())
        : (activeFile?.parent ??
          this.app.fileManager.getNewFileParent("", "Untitled.note"));
    const defaultFolderPath = defaultFolder?.path ?? "";

    new NewNoteModal(
      this.app,
      this.app.vault.getAllFolders(true),
      defaultFolderPath,
      async (result) => {
        if (!result) return;

        const { name, folderPath } = result;
        const newFilePath = `${name}.note`;

        try {
          const path = normalizePath(
            folderPath ? `${folderPath}/${newFilePath}` : newFilePath,
          );
          const initialContent = JSON.stringify(
            createNoteWithTitle(name),
            null,
            2,
          );
          const file = await this.app.vault.create(path, initialContent);
          await this.app.workspace.getLeaf("tab").openFile(file);
        } catch (error) {
          new Notice(
            `Failed to create note: ${error instanceof Error ? error.message : String(error)}`,
          );
          console.error("Failed to create note:", error);
        }
      },
    ).open();
  }
}

/**
 * Creates a new note document with a filled title (noteTitle),
 * so the file name and the title inside the note stay in sync.
 */
function createNoteWithTitle(name: string): JSONContent {
  const doc = createEmptyNote();
  const title = doc.content?.find((node) => node.type === "noteTitle");
  if (title) {
    title.content = [{ type: "text", text: name }];
  }
  return doc;
}
