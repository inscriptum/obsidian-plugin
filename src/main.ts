import "./styles/editor.css";
import {
  Notice,
  normalizePath,
  Plugin,
  TFolder,
  WorkspaceLeaf,
} from "obsidian";
import { NoteView, NOTE_VIEW_TYPE } from "./NoteView";
import { installIconSprite } from "./components/icons/iconSprite";
import { createEmptyNote } from "./storage/noteStorage";
import { NewNoteModal } from "./ui/NewNoteModal";
import type { JSONContent } from "./texto/core/@types";

export default class NotesPlugin extends Plugin {
  async onload(): Promise<void> {
    installIconSprite();

    this.registerExtensions(["note"], NOTE_VIEW_TYPE);

    this.registerView(
      NOTE_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new NoteView(leaf),
    );

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
  }

  private createNewNote(initialFolderPath?: string) {
    const activeFile = this.app.workspace.getActiveFile();
    const defaultFolder =
      initialFolderPath !== undefined
        ? this.app.vault.getFolderByPath(initialFolderPath) ??
          this.app.vault.getRoot()
        : activeFile?.parent ??
          this.app.fileManager.getNewFileParent(
            "",
            "Untitled.note",
          );
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
